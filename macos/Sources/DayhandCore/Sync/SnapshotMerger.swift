import Foundation

/// Groups of task fields that one kind of change touches.
public enum Field: CaseIterable, Hashable, Sendable {
    case title, note, due, status, now, resume, archived, `repeat`, labels, links, deleted, checklist, reminders, project
}

public struct MergePlan: Hashable, Sendable {
    public let upserts: [TaskItem]
    public let deletes: [String]
}

/**
 * Merges a server snapshot into the local rows, last write wins per field, as the Android app's `SnapshotMerger`:
 *
 * - A field changed by a change still in the outbox keeps its local value. That change reaches the server after
 *   everything already there, so the server will end up with it too.
 * - Every other field takes the server value, but only from a server copy newer than the one merged before
 *   (`updatedAt`), so a late snapshot never undoes a newer state.
 * - A task missing from the snapshot was purged (or never reached the server) and goes, unless it still has changes
 *   waiting or is too fresh to be in any snapshot yet. Tasks in the trash are part of the snapshot, with `deletedAt`.
 * - The server's `projectId` reads as the project's `localId` on this Mac ([projects]).
 */
public enum SnapshotMerger {
    /// How long a task the server has not shown yet is kept (a snapshot may predate it).
    public static let unseenGraceMs: Int64 = 2 * 60 * 1000

    public static func merge(
        local: [TaskItem], pending: [OutboxOp], remote: [RemoteTask], nowMs: Int64, projects: ProjectMapping = ProjectMapping()
    ) -> MergePlan {
        let dirty = DirtyFields(pending)
        var byServerId: [String: TaskItem] = [:]
        var byClientId: [String: TaskItem] = [:]
        for task in local {
            if let id = task.serverId { byServerId[id] = task }
            if let id = task.clientId { byClientId[id] = task }
        }
        var seen = Set<String>()
        var upserts: [TaskItem] = []
        for r in remote {
            let row = byServerId[r.id] ?? r.clientId.flatMap { byClientId[$0] }
            if let row { seen.insert(row.localId) }
            if let row, let known = row.serverUpdatedAt, r.updatedAt <= known { continue }
            let merged = mergeRow(row, r, row.map { dirty.forTask($0.localId) } ?? [], projects)
            if merged != row { upserts.append(merged) }
        }
        let deletes = local
            .filter { !seen.contains($0.localId) && !dirty.hasChanges($0.localId) }
            .filter { $0.serverUpdatedAt != nil || nowMs - $0.updatedAt > unseenGraceMs }
            .map(\.localId)
        return MergePlan(upserts: upserts, deletes: deletes)
    }

    /**
     * The server's settings, except the fields a settings change still in the outbox sets: they keep the local value,
     * which reaches the server after everything already there, as the tasks' fields do.
     */
    public static func settings(local: ReminderSettings, pending: [OutboxOp], remote: ReminderSettings) -> ReminderSettings {
        var merged = remote
        for op in pending where op.mutation == Mutations.updateSettings {
            let keys = Set((JSONValue.decode(op.argsJson)?.object ?? [:]).keys)
            if keys.contains("timezone") { merged.timezone = local.timezone }
            if keys.contains("summaryTime") { merged.summaryTime = local.summaryTime }
            if keys.contains("defaultReminderMinutes") { merged.reminderMinutes = local.reminderMinutes }
        }
        return merged
    }

    private static func mergeRow(_ row: TaskItem?, _ r: RemoteTask, _ keepLocal: Set<Field>, _ projects: ProjectMapping) -> TaskItem {
        var task = TaskItem(
            localId: row?.localId ?? r.clientId ?? r.id,
            serverId: r.id,
            clientId: r.clientId,
            title: r.title,
            note: r.note,
            dueDate: r.dueDate,
            dueTime: r.dueTime,
            status: TaskStatus.fromWire(r.status),
            isNow: r.isNow,
            resumeNote: r.resumeNote,
            completedAt: r.completedAt,
            archivedAt: r.archivedAt,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            serverUpdatedAt: r.updatedAt,
            repeat: r.repeat,
            labels: r.labels,
            links: r.links,
            deletedAt: r.deletedAt,
            checklist: r.checklist,
            reminders: r.reminders,
            // Agent work is read-only on the Mac, so the server's copy always wins.
            ref: r.ref,
            acceptance: r.acceptance,
            plan: r.plan,
            proof: r.proof,
            dependsOn: r.dependsOn,
            blockedReason: r.blockedReason,
            claimedBy: r.claimedBy,
            claimExpiresAt: r.claimExpiresAt,
            projectLocalId: projects.localId(r.projectId)
        )
        if projects.preservesLocalMembership, let row { task.projectLocalId = row.projectLocalId }
        guard let row, !keepLocal.isEmpty else { return task }
        if keepLocal.contains(.title) { task.title = row.title }
        if keepLocal.contains(.note) { task.note = row.note }
        if keepLocal.contains(.due) { task.dueDate = row.dueDate; task.dueTime = row.dueTime }
        if keepLocal.contains(.status) { task.status = row.status; task.completedAt = row.completedAt }
        if keepLocal.contains(.now) { task.isNow = row.isNow }
        if keepLocal.contains(.resume) { task.resumeNote = row.resumeNote }
        if keepLocal.contains(.archived) { task.archivedAt = row.archivedAt }
        if keepLocal.contains(.repeat) { task.repeat = row.repeat }
        if keepLocal.contains(.labels) { task.labels = row.labels }
        if keepLocal.contains(.links) { task.links = row.links }
        if keepLocal.contains(.deleted) { task.deletedAt = row.deletedAt }
        if keepLocal.contains(.checklist) { task.checklist = row.checklist }
        if keepLocal.contains(.reminders) { task.reminders = row.reminders }
        if keepLocal.contains(.project) { task.projectLocalId = row.projectLocalId }
        task.updatedAt = max(row.updatedAt, r.updatedAt)
        return task
    }
}

/// Which fields of which tasks have changes still waiting in the outbox.
public struct DirtyFields: Sendable {
    private var byTask: [String: Set<Field>] = [:]
    /// `setNow` moves the "now" flag off every other task too.
    private var nowEverywhere = false

    public init(_ pending: [OutboxOp]) {
        for op in pending {
            if op.mutation == Mutations.setNow { nowEverywhere = true }
            guard let localId = op.taskLocalId else { continue }
            var fields = DirtyFields.fields(of: op)
            // Refused for its project, the change goes again without it: the server's project stands.
            if op.lastError.map(RemoteJSON.refusesProject) == true { fields.remove(.project) }
            byTask[localId, default: []].formUnion(fields)
        }
    }

    public func hasChanges(_ localId: String) -> Bool { byTask[localId] != nil }

    public func forTask(_ localId: String) -> Set<Field> {
        var fields = byTask[localId] ?? []
        if nowEverywhere { fields.insert(.now) }
        return fields
    }

    static func fields(of op: OutboxOp) -> Set<Field> {
        switch op.mutation {
        case Mutations.add: return Set(Field.allCases)
        case Mutations.complete, Mutations.setStatus: return [.status, .now]
        case Mutations.reschedule: return [.due]
        case Mutations.archive: return [.archived, .now]
        case Mutations.setNow: return [.status, .now, .resume]
        case Mutations.softDelete: return [.deleted, .now]
        // `restore` clears the trash, or the archive when the task is not in the trash.
        case Mutations.restore: return [.deleted, .archived]
        case Mutations.update: return updatedFields(op.argsJson)
        default: return Set(Field.allCases)
        }
    }

    private static func updatedFields(_ argsJson: String) -> Set<Field> {
        guard let keys = JSONValue.decode(argsJson)?.object?.keys else { return Set(Field.allCases) }
        var fields = Set<Field>()
        if keys.contains("title") { fields.insert(.title) }
        if keys.contains("note") { fields.insert(.note) }
        if keys.contains("dueDate") || keys.contains("dueTime") { fields.insert(.due) }
        if keys.contains("resumeNote") { fields.insert(.resume) }
        if keys.contains("repeat") { fields.insert(.repeat) }
        if keys.contains("labels") { fields.insert(.labels) }
        if keys.contains("links") { fields.insert(.links) }
        if keys.contains("checklist") { fields.insert(.checklist) }
        if keys.contains("reminders") { fields.insert(.reminders) }
        if keys.contains("projectId") { fields.insert(.project) }
        return fields
    }
}
