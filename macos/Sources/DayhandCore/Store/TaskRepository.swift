import DayhandLocalization
import Foundation
import GRDB

public enum RepositoryError: Error, Hashable, Sendable {
    case invalid(String)
}

/**
 * Every user action changes the local row and appends its server mutation to the outbox in one transaction, as the
 * Android app's `TaskRepository`, so the screen updates at once and the change cannot be lost or sent without being
 * shown. [onOutboxChanged] wakes the sync engine.
 */
public final class TaskRepository: Sendable {
    public let database: AppDatabase
    private let clock: @Sendable () -> Int64
    private let newId: @Sendable () -> String
    private let onOutboxChanged: @Sendable () -> Void
    private let localTimezone: @Sendable () -> String
    private let repeatsOnMac: @Sendable () -> Bool

    /// [repeatsOnMac] is true while the Mac has no server, which then makes a repeating task's next occurrence itself;
    /// with a server, `complete` does it there.
    public init(
        database: AppDatabase,
        clock: @escaping @Sendable () -> Int64 = Clock.nowMs,
        newId: @escaping @Sendable () -> String = { UUID().uuidString.lowercased() },
        onOutboxChanged: @escaping @Sendable () -> Void = {},
        localTimezone: @escaping @Sendable () -> String = { TimeZone.current.identifier },
        repeatsOnMac: @escaping @Sendable () -> Bool = { false }
    ) {
        self.database = database
        self.clock = clock
        self.newId = newId
        self.onOutboxChanged = onOutboxChanged
        self.localTimezone = localTimezone
        self.repeatsOnMac = repeatsOnMac
    }

    private var writer: DatabaseQueue { database.writer }

    // MARK: Reading

    public func allTasks() async throws -> [TaskItem] {
        try await writer.read { db in try TaskItem.fetchAll(db) }
    }

    public func task(_ localId: String) async throws -> TaskItem? {
        try await writer.read { db in try TaskItem.fetchOne(db, key: localId) }
    }

    public func pendingOps() async throws -> [OutboxOp] {
        try await writer.read { db in try OutboxOp.order(Column("seq")).fetchAll(db) }
    }

    /// Every task, again after each change.
    public func observeTasks() -> AsyncValueObservation<[TaskItem]> {
        ValueObservation.tracking { db in try TaskItem.fetchAll(db) }.values(in: writer)
    }

    /// The number of changes waiting for the server, again after each change.
    public func observePendingCount() -> AsyncValueObservation<Int> {
        ValueObservation.tracking { db in try OutboxOp.fetchCount(db) }.values(in: writer)
    }

    /// The cached change history of a task the server knows, newest first.
    public func history(_ serverId: String) async throws -> [TaskEvent] {
        try await writer.read { db in try Self.history(db, serverId) }
    }

    /// The cached change history of [serverId], newest first, again after each change.
    public func observeHistory(_ serverId: String) -> AsyncValueObservation<[TaskEvent]> {
        ValueObservation.tracking { db in try Self.history(db, serverId) }.values(in: writer)
    }

    private static func history(_ db: Database, _ serverId: String) throws -> [TaskEvent] {
        try TaskEvent.filter(Column("taskServerId") == serverId).order(Column("at").desc, Column("id")).fetchAll(db)
    }

    // MARK: Changes

    /// Adds a task; [dueTime] is kept only together with [dueDate], as the backend requires.
    @discardableResult
    public func add(title: String, dueDate: String?, dueTime: String?, note: String? = nil) async throws -> TaskItem {
        guard let cleanTitle = TaskRules.title(title) else { throw RepositoryError.invalid(tr("The title must be 1 to \(TaskRules.maxTitle) characters.")) }
        let cleanNote = note.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
        guard (cleanNote?.jsLength ?? 0) <= TaskRules.maxNote else { throw RepositoryError.invalid(tr("The note is too long.")) }
        let date = dueDate.flatMap { CivilDate($0) == nil ? nil : $0 }
        let time = date == nil ? nil : dueTime.flatMap { ClockTime($0) == nil ? nil : $0 }
        let now = clock()
        let localId = newId()
        let task = TaskItem(
            localId: localId, clientId: localId, title: cleanTitle, note: cleanNote, dueDate: date, dueTime: time,
            createdAt: now, updatedAt: now
        )
        var args: [String: JSONValue] = ["title": .string(cleanTitle)]
        if let cleanNote { args["note"] = .string(cleanNote) }
        if let date { args["dueDate"] = .string(date) }
        if let time { args["dueTime"] = .string(time) }
        let op = makeOp(Mutations.add, localId, args, now: now, clientId: localId)
        try await writer.write { db in
            try task.save(db)
            var op = op
            try op.insert(db)
        }
        onOutboxChanged()
        return task
    }

    /**
     * Marks a task done. Without a server the Mac adds a repeating task's next occurrence itself (as the backend's
     * `complete` would) and queues it as a task of its own; the done task loses its rule first, so the server, once
     * connected, does not add another one. The Android app's `TaskRepository.complete`.
     */
    public func complete(_ localId: String) async throws {
        let onMac = repeatsOnMac()
        let zone = localTimezone()
        let now = clock()
        let completeOp = makeOp(Mutations.complete, localId, [:], now: now)
        let changed = try await writer.write { db -> Bool in
            guard var task = try TaskItem.fetchOne(db, key: localId), !task.inTrash else { return false }
            let rule = task.repeat
            let wasDone = task.status == .done
            task.status = .done
            task.completedAt = now
            task.isNow = false
            task.updatedAt = now
            var complete = completeOp
            guard onMac, let rule, !wasDone else {
                try task.save(db)
                try complete.insert(db)
                return true
            }
            let today = HelmDates.localDate(now, try Meta.settings(db, localTimezone: zone).timezone)
            task.repeat = nil
            try task.save(db)
            var stopRepeating = self.makeOp(Mutations.update, localId, ["repeat": .null], now: now)
            try stopRepeating.insert(db)
            try complete.insert(db)
            if let occurrence = Recurrence.advance(rule, dueDate: task.dueDate, today: today) {
                let next = self.nextOccurrence(of: task, occurrence, now: now)
                try next.save(db)
                var add = self.makeOp(Mutations.add, next.localId, Self.addArgs(next), now: now, clientId: next.localId)
                try add.insert(db)
            }
            return true
        }
        if changed { onOutboxChanged() }
    }

    /// Back from done to the to-do list.
    public func reopen(_ localId: String) async throws {
        try await edit(localId, Mutations.setStatus, ["status": "todo"]) { task, _ in
            task.status = .todo
            task.completedAt = nil
            task.isNow = false
        }
    }

    /// To do and in progress through `setStatus`, done through `complete` (which also creates a repeating task's
    /// next occurrence, on the server or, without one, on the Mac). Leaving "in progress" ends the "now" flag, as on the server.
    public func move(_ localId: String, to status: TaskStatus) async throws {
        guard let current = try await task(localId), current.status != status else { return }
        switch status {
        case .done: try await complete(localId)
        case .todo: try await reopen(localId)
        case .doing:
            try await edit(localId, Mutations.setStatus, ["status": "doing"]) { task, _ in
                task.status = .doing
                task.completedAt = nil
            }
        }
    }

    public func rename(_ localId: String, to title: String) async throws {
        guard let clean = TaskRules.title(title) else { throw RepositoryError.invalid(tr("The title must be 1 to \(TaskRules.maxTitle) characters.")) }
        try await edit(localId, Mutations.update, ["title": .string(clean)]) { task, _ in task.title = clean }
    }

    /// Sets the note; a blank note clears it.
    public func setNote(_ localId: String, _ note: String) async throws {
        let clean = note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : note
        guard (clean?.jsLength ?? 0) <= TaskRules.maxNote else { throw RepositoryError.invalid(tr("The note is too long.")) }
        try await edit(localId, Mutations.update, ["note": .of(clean)]) { task, _ in task.note = clean }
    }

    /// Sets the day (YYYY-MM-DD) and the optional time (HH:MM); no day clears both.
    public func setDue(_ localId: String, date: String?, time: String?) async throws {
        if let date, CivilDate(date) == nil { throw RepositoryError.invalid(tr("That is not a date.")) }
        if let time, ClockTime(time) == nil { throw RepositoryError.invalid(tr("That is not a time.")) }
        let cleanTime = date == nil ? nil : time
        try await edit(localId, Mutations.update, ["dueDate": .of(date), "dueTime": .of(cleanTime)]) { task, _ in
            task.dueDate = date
            task.dueTime = cleanTime
        }
    }

    /// Moves a task to [date] (YYYY-MM-DD), keeping its time.
    public func reschedule(_ localId: String, to date: String) async throws {
        guard CivilDate(date) != nil else { throw RepositoryError.invalid(tr("That is not a date.")) }
        try await edit(localId, Mutations.reschedule, ["dueDate": .string(date)]) { task, _ in task.dueDate = date }
    }

    /// Sets the labels (which also serve as projects), cleaned as the backend cleans them.
    public func setLabels(_ localId: String, _ labels: [String]) async throws {
        guard let clean = TaskRules.labels(labels) else { throw RepositoryError.invalid(tr("There are too many labels, or one is too long.")) }
        try await edit(localId, Mutations.update, ["labels": .array(clean.map(JSONValue.string))]) { task, _ in task.labels = clean }
    }

    /// Sets the repeat rule; nil stops repeating.
    public func setRepeat(_ localId: String, _ rule: RepeatRule?) async throws {
        if let rule, !TaskRules.isValid(rule) { throw RepositoryError.invalid(tr("The repeat rule is not valid.")) }
        try await edit(localId, Mutations.update, ["repeat": rule?.wire ?? .null]) { task, _ in task.repeat = rule }
    }

    /// The task's own reminders instead of the defaults; nil goes back to the defaults, an empty list means none.
    public func setReminders(_ localId: String, _ reminders: [TaskReminder]?) async throws {
        let clean: [TaskReminder]?
        if let reminders {
            guard let checked = TaskRules.reminders(reminders) else { throw RepositoryError.invalid(tr("The reminders are not valid.")) }
            clean = checked
        } else {
            clean = nil
        }
        try await edit(localId, Mutations.update, ["reminders": clean.map { .array($0.map(\.wire)) } ?? .null]) { task, _ in
            task.reminders = clean
        }
    }

    /// Ticks or unticks one checklist item; the backend replaces the list as a whole.
    public func toggleItem(_ localId: String, _ itemId: String) async throws {
        try await editChecklist(localId) { items in items.map { $0.id == itemId ? ChecklistItem(id: $0.id, title: $0.title, done: !$0.done) : $0 } }
    }

    public func addItem(_ localId: String, _ title: String) async throws {
        let id = newId()
        try await editChecklist(localId) { items in items + [ChecklistItem(id: id, title: title)] }
    }

    public func removeItem(_ localId: String, _ itemId: String) async throws {
        try await editChecklist(localId) { items in items.filter { $0.id != itemId } }
    }

    public func setResumeNote(_ localId: String, _ note: String) async throws {
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let clean = trimmed.isEmpty ? nil : trimmed
        guard (clean?.jsLength ?? 0) <= TaskRules.maxResumeNote else { throw RepositoryError.invalid(tr("The note is too long.")) }
        try await edit(localId, Mutations.update, ["resumeNote": .of(clean)]) { task, _ in task.resumeNote = clean }
    }

    public func archive(_ localId: String) async throws {
        try await edit(localId, Mutations.archive) { task, now in
            task.archivedAt = now
            task.isNow = false
        }
    }

    /// Moves a task to the trash; the server keeps it there for 30 days.
    public func moveToTrash(_ localId: String) async throws {
        try await edit(localId, Mutations.softDelete) { task, now in
            task.deletedAt = now
            task.isNow = false
        }
    }

    /// Brings a task back from the trash, or from the archive when it is not in the trash (backend `restore`).
    public func restore(_ localId: String) async throws {
        try await edit(localId, Mutations.restore) { task, _ in
            if task.deletedAt != nil { task.deletedAt = nil } else { task.archivedAt = nil }
        }
    }

    /// Makes [localId] the single "now" task (status doing), as the backend's `setNow` does.
    public func setNow(_ localId: String) async throws {
        let now = clock()
        let op = makeOp(Mutations.setNow, localId, [:], now: now)
        let changed = try await writer.write { db -> Bool in
            guard var target = try TaskItem.fetchOne(db, key: localId), !target.inTrash else { return false }
            for var other in try TaskItem.filter(Column("isNow") == true && Column("localId") != localId).fetchAll(db) {
                other.isNow = false
                other.updatedAt = now
                try other.save(db)
            }
            target.isNow = true
            target.status = .doing
            target.completedAt = nil
            target.updatedAt = now
            try target.save(db)
            var op = op
            try op.insert(db)
            return true
        }
        if changed { onOutboxChanged() }
    }

    /// No task is "now" any more.
    public func clearNow() async throws {
        let now = clock()
        let op = makeOp(Mutations.setNow, nil, ["taskId": .null], now: now)
        try await writer.write { db in
            for var task in try TaskItem.filter(Column("isNow") == true).fetchAll(db) {
                task.isNow = false
                task.updatedAt = now
                try task.save(db)
            }
            var op = op
            try op.insert(db)
        }
        onOutboxChanged()
    }

    // MARK: Server snapshots

    /// Writes a server snapshot into the database (see `SnapshotMerger`) and keeps its settings.
    public func apply(_ snapshot: Snapshot) async throws {
        let now = clock()
        try await writer.write { db in
            let local = try TaskItem.fetchAll(db)
            let pending = try OutboxOp.order(Column("seq")).fetchAll(db)
            let plan = SnapshotMerger.merge(local: local, pending: pending, remote: snapshot.tasks, nowMs: now)
            for task in plan.upserts { try task.save(db) }
            if !plan.deletes.isEmpty { _ = try TaskItem.deleteAll(db, keys: plan.deletes) }
            // History of tasks that no longer exist on the Mac (purged from the trash on the server).
            try db.execute(sql: "DELETE FROM taskEvent WHERE taskServerId NOT IN (SELECT serverId FROM task WHERE serverId IS NOT NULL)")
            try Meta.write(db, snapshot.settings)
        }
    }

    /// Replaces the cached history of [serverId] with the server's copy: the server's history is the whole truth.
    public func saveHistory(_ serverId: String, _ events: [TaskEvent]) async throws {
        try await writer.write { db in
            _ = try TaskEvent.filter(Column("taskServerId") == serverId).deleteAll(db)
            for event in events { try event.insert(db) }
        }
    }

    /// The server's settings; until a server has sent them (no server yet, or Not now), the day and the reminders
    /// follow this Mac's time zone, as the Android app's on this phone only.
    public func settings() async throws -> ReminderSettings {
        let zone = localTimezone()
        return try await writer.read { db in try Meta.settings(db, localTimezone: zone) }
    }

    public func observeSettings() -> AsyncValueObservation<ReminderSettings> {
        let zone = localTimezone()
        return ValueObservation.tracking { db in try Meta.settings(db, localTimezone: zone) }.values(in: writer)
    }

    /// Forgets every task, its history and every waiting change (Disconnect and pairing with another account).
    public func eraseAll() async throws {
        try await writer.write { db in
            _ = try TaskItem.deleteAll(db)
            _ = try TaskEvent.deleteAll(db)
            _ = try OutboxOp.deleteAll(db)
            _ = try db.execute(sql: "DELETE FROM meta")
        }
    }

    // MARK: Helpers

    private func edit(
        _ localId: String, _ mutation: String, _ args: [String: JSONValue] = [:],
        change: @escaping @Sendable (inout TaskItem, Int64) -> Void
    ) async throws {
        let now = clock()
        let op = makeOp(mutation, localId, args, now: now)
        let changed = try await writer.write { db -> Bool in
            guard var task = try TaskItem.fetchOne(db, key: localId) else { return false }
            // The server refuses every other change to a task in the trash; restore it first.
            if task.inTrash, mutation != Mutations.restore { return false }
            change(&task, now)
            task.updatedAt = now
            try task.save(db)
            var op = op
            try op.insert(db)
            return true
        }
        if changed { onOutboxChanged() }
    }

    private func editChecklist(_ localId: String, change: @escaping @Sendable ([ChecklistItem]) -> [ChecklistItem]) async throws {
        let now = clock()
        let opTemplate = makeOp(Mutations.update, localId, [:], now: now)
        let changed = try await writer.write { db -> Bool in
            guard var task = try TaskItem.fetchOne(db, key: localId), !task.inTrash else { return false }
            guard let items = TaskRules.checklist(change(task.checklist)) else {
                throw RepositoryError.invalid(tr("There are too many checklist items, or one is too long."))
            }
            if items == task.checklist { return false }
            task.checklist = items
            task.updatedAt = now
            try task.save(db)
            var op = opTemplate
            var args = JSONValue.decode(op.argsJson)?.object ?? [:]
            args["checklist"] = .array(items.map(\.wire))
            op.argsJson = JSONValue.object(args).encoded()
            try op.insert(db)
            return true
        }
        if changed { onOutboxChanged() }
    }

    /// The task the completion of [task] creates, as the backend's `complete`: the same fields on the next date, the
    /// checklist unticked.
    private func nextOccurrence(of task: TaskItem, _ occurrence: Recurrence.Next, now: Int64) -> TaskItem {
        let id = newId()
        return TaskItem(
            localId: id, clientId: id, title: task.title, note: task.note, dueDate: occurrence.dueDate,
            dueTime: task.dueTime, createdAt: now, updatedAt: now, repeat: occurrence.repeat, labels: task.labels,
            links: task.links, checklist: task.checklist.map { ChecklistItem(id: $0.id, title: $0.title) },
            reminders: task.reminders
        )
    }

    /// The `add` arguments of a whole task, unset fields left out.
    private static func addArgs(_ task: TaskItem) -> [String: JSONValue] {
        var args: [String: JSONValue] = ["title": .string(task.title)]
        if let note = task.note { args["note"] = .string(note) }
        if let dueDate = task.dueDate { args["dueDate"] = .string(dueDate) }
        if let dueTime = task.dueTime { args["dueTime"] = .string(dueTime) }
        if let rule = task.repeat { args["repeat"] = rule.wire }
        if !task.labels.isEmpty { args["labels"] = .array(task.labels.map(JSONValue.string)) }
        if !task.links.isEmpty { args["links"] = .array(task.links.map(\.wire)) }
        if !task.checklist.isEmpty { args["checklist"] = .array(task.checklist.map(\.wire)) }
        if let reminders = task.reminders { args["reminders"] = .array(reminders.map(\.wire)) }
        return args
    }

    /// A change with its own `clientId`, which makes the server apply it once however often it is sent.
    private func makeOp(_ mutation: String, _ taskLocalId: String?, _ args: [String: JSONValue], now: Int64, clientId: String? = nil) -> OutboxOp {
        let clientId = clientId ?? newId()
        var withClientId = args
        withClientId["clientId"] = .string(clientId)
        return OutboxOp(
            opId: mutation == Mutations.add ? newId() : clientId,
            mutation: mutation,
            argsJson: JSONValue.object(withClientId).encoded(),
            taskLocalId: taskLocalId,
            clientId: clientId,
            createdAt: now
        )
    }
}

// MARK: - Outbox store

extension TaskRepository: OutboxStore {
    public func next() async throws -> OutboxOp? {
        try await writer.read { db in try OutboxOp.order(Column("seq")).fetchOne(db) }
    }

    public func serverIdOf(_ taskLocalId: String) async throws -> String? {
        try await writer.read { db in try TaskItem.fetchOne(db, key: taskLocalId)?.serverId }
    }

    public func acknowledge(_ op: OutboxOp, value: JSONValue) async throws {
        try await writer.write { db in
            _ = try OutboxOp.deleteOne(db, key: op.seq)
            if op.mutation == Mutations.add, let localId = op.taskLocalId, let serverId = value["id"]?.string,
               var task = try TaskItem.fetchOne(db, key: localId) {
                task.serverId = serverId
                try task.save(db)
            }
        }
    }

    public func reject(_ op: OutboxOp, reason: String) async throws {
        try await writer.write { db in
            _ = try OutboxOp.deleteOne(db, key: op.seq)
            guard let localId = op.taskLocalId else { return }
            if op.mutation == Mutations.add {
                // The task never existed on the server: drop it and every change made to it since.
                _ = try OutboxOp.filter(Column("taskLocalId") == localId).deleteAll(db)
                _ = try TaskItem.deleteOne(db, key: localId)
            } else if var task = try TaskItem.fetchOne(db, key: localId) {
                // Forget the server version so the next snapshot overwrites the refused local change.
                task.serverUpdatedAt = nil
                try task.save(db)
            }
        }
    }

    public func recordFailure(_ op: OutboxOp, reason: String) async throws {
        try await writer.write { db in
            try db.execute(
                sql: "UPDATE outbox SET attempts = attempts + 1, lastError = ? WHERE seq = ?",
                arguments: [reason, op.seq]
            )
        }
    }
}

/// The server settings, kept as JSON in the key-value table.
enum Meta {
    static let settingsKey = "settings"

    static func settings(_ db: Database, localTimezone: String) throws -> ReminderSettings {
        guard let text = try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = ?", arguments: [settingsKey]),
              let value = JSONValue.decode(text) else { return ReminderSettings(timezone: localTimezone) }
        return RemoteJSON.settings(value)
    }

    static func write(_ db: Database, _ settings: ReminderSettings) throws {
        let value: JSONValue = [
            "timezone": .string(settings.timezone),
            "summaryTime": .string(settings.summaryTime),
            "defaultReminderMinutes": .array(settings.reminderMinutes.map(JSONValue.of)),
        ]
        try db.execute(
            sql: "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            arguments: [settingsKey, value.encoded()]
        )
    }
}
