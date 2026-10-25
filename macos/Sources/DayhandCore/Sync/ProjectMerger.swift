import Foundation

/// Groups of project fields that one kind of change touches.
public enum ProjectField: CaseIterable, Hashable, Sendable {
    case name, color, icon, note, position, archived
}

public struct ProjectMergePlan: Hashable, Sendable {
    public let upserts: [Project]
    public let deletes: [String]
}

/**
 * Merges the server's projects into the local rows the way `SnapshotMerger` merges tasks: a field changed by a change
 * still in the outbox keeps its local value, every other field takes the value of a newer server copy, and a project
 * missing from the server goes unless it still has changes waiting or is too fresh.
 *
 * A project made here whose `addProject` was refused because the name was taken (another device made one with the
 * same name while both were offline) joins the server's project of that name: the row takes its server id, so its
 * tasks and later changes go to that project.
 */
public enum ProjectMerger {
    public static func merge(local: [Project], pending: [OutboxOp], remote: [RemoteProject], nowMs: Int64) -> ProjectMergePlan {
        let dirty = DirtyProjects(pending)
        var byServerId: [String: Project] = [:]
        var byClientId: [String: Project] = [:]
        for project in local {
            if let id = project.serverId { byServerId[id] = project }
            if let id = project.clientId { byClientId[id] = project }
        }
        var joinable = local.filter { $0.serverId == nil && !$0.removing && !dirty.adding.contains($0.localId) }
        var seen = Set<String>()
        var upserts: [Project] = []
        for r in remote {
            var row = byServerId[r.id] ?? r.clientId.flatMap { byClientId[$0] }
            if row == nil, r.archivedAt == nil,
               let index = joinable.firstIndex(where: { ProjectRules.nameKey($0.name) == ProjectRules.nameKey(r.name) }) {
                row = joinable.remove(at: index)
            }
            if let row { seen.insert(row.localId) }
            // Deleted here, the deletion still on its way: the row stays hidden as it is.
            if let row, row.removing { continue }
            if let row, row.serverId == r.id, let known = row.serverUpdatedAt, r.updatedAt <= known { continue }
            let merged = mergeRow(row, r, row.map { dirty.fields($0.localId) } ?? [])
            if merged != row { upserts.append(merged) }
        }
        let deletes = local
            .filter { !seen.contains($0.localId) && !dirty.hasChanges($0.localId) }
            .filter { $0.serverUpdatedAt != nil || $0.removing || nowMs - $0.updatedAt > SnapshotMerger.unseenGraceMs }
            .map(\.localId)
        return ProjectMergePlan(upserts: upserts, deletes: deletes)
    }

    private static func mergeRow(_ row: Project?, _ r: RemoteProject, _ keepLocal: Set<ProjectField>) -> Project {
        var project = Project(
            localId: row?.localId ?? r.clientId ?? r.id,
            serverId: r.id,
            clientId: r.clientId,
            name: r.name,
            color: r.color,
            icon: r.icon,
            note: r.note,
            position: r.position,
            archivedAt: r.archivedAt,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            serverUpdatedAt: r.updatedAt
        )
        guard let row, !keepLocal.isEmpty else { return project }
        if keepLocal.contains(.name) { project.name = row.name }
        if keepLocal.contains(.color) { project.color = row.color }
        if keepLocal.contains(.icon) { project.icon = row.icon }
        if keepLocal.contains(.note) { project.note = row.note }
        if keepLocal.contains(.position) { project.position = row.position }
        if keepLocal.contains(.archived) { project.archivedAt = row.archivedAt }
        project.updatedAt = max(row.updatedAt, r.updatedAt)
        return project
    }
}

/// Which fields of which projects have changes still waiting in the outbox, by the project's `localId`.
struct DirtyProjects {
    private(set) var adding = Set<String>()
    private var byProject: [String: Set<ProjectField>] = [:]

    init(_ pending: [OutboxOp]) {
        for op in pending where Mutations.projectChanges.contains(op.mutation) {
            let args = JSONValue.decode(op.argsJson)?.object ?? [:]
            switch op.mutation {
            case Mutations.addProject:
                adding.insert(op.clientId)
                byProject[op.clientId] = Set(ProjectField.allCases)
            case Mutations.updateProject:
                guard let id = args["projectId"]?.string else { continue }
                byProject[id, default: []].formUnion(Self.fields(Set(args.keys)))
            default:
                guard let id = args["projectId"]?.string else { continue }
                byProject[id] = Set(ProjectField.allCases)
            }
        }
    }

    func hasChanges(_ localId: String) -> Bool { byProject[localId] != nil }

    func fields(_ localId: String) -> Set<ProjectField> { byProject[localId] ?? [] }

    private static func fields(_ keys: Set<String>) -> Set<ProjectField> {
        var fields = Set<ProjectField>()
        if keys.contains("name") { fields.insert(.name) }
        if keys.contains("color") { fields.insert(.color) }
        if keys.contains("icon") { fields.insert(.icon) }
        if keys.contains("note") { fields.insert(.note) }
        if keys.contains("position") { fields.insert(.position) }
        if keys.contains("archived") { fields.insert(.archived) }
        return fields
    }
}

/**
 * How a task's server `projectId` reads on this Mac: the `localId` of the project with that server id (the server id
 * itself for a project not merged yet, which is the `localId` it gets when it arrives). A project whose deletion is
 * still in the outbox reads as the project that deletion moves its tasks to, as the server will have it.
 */
public struct ProjectMapping: Sendable {
    private var localIdByServerId: [String: String] = [:]
    private var movedTo: [String: String?] = [:]

    let preservesLocalMembership: Bool

    public init(preservingLocalMembership: Bool = false) {
        preservesLocalMembership = preservingLocalMembership
    }

    public init(projects: [Project], pending: [OutboxOp]) {
        preservesLocalMembership = false
        for project in projects {
            if let id = project.serverId { localIdByServerId[id] = project.localId }
        }
        for op in pending where op.mutation == Mutations.deleteProject {
            guard let args = JSONValue.decode(op.argsJson), let id = args["projectId"]?.string else { continue }
            let target = args["moveTasksTo"]?.string
            movedTo[id] = .some(target == ProjectRules.noProject ? nil : target)
        }
    }

    public func localId(_ serverId: String?) -> String? {
        guard let serverId else { return nil }
        var local = localIdByServerId[serverId] ?? serverId
        var visited = Set<String>()
        while let moved = movedTo[local] {
            guard visited.insert(local).inserted, let moved else { return nil }
            local = moved
        }
        return local
    }
}
