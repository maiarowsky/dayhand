import Foundation
import GRDB

/**
 * The local SQLite database (GRDB): the tasks as the screens see them, the outbox of changes waiting for the server,
 * the cached change history of each task and a small key-value table for the server settings and the last plan
 * health report. The screens read only from here, never from the network.
 */
public final class AppDatabase: Sendable {
    public let writer: DatabaseQueue

    public init(_ writer: DatabaseQueue) throws {
        self.writer = writer
        try migrator.migrate(writer)
    }

    /// The database file at [url], created with its folder when missing.
    public static func onDisk(at url: URL) throws -> AppDatabase {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        return try AppDatabase(DatabaseQueue(path: url.path))
    }

    /// An empty database in memory, for tests and previews.
    public static func inMemory() throws -> AppDatabase {
        try AppDatabase(DatabaseQueue())
    }

    var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        migrator.registerMigration("v1") { db in
            try db.create(table: "task") { t in
                t.primaryKey("localId", .text)
                t.column("serverId", .text).unique()
                t.column("clientId", .text).indexed()
                t.column("title", .text).notNull()
                t.column("note", .text)
                t.column("dueDate", .text)
                t.column("dueTime", .text)
                t.column("status", .text).notNull()
                t.column("isNow", .boolean).notNull().defaults(to: false)
                t.column("resumeNote", .text)
                t.column("completedAt", .integer)
                t.column("archivedAt", .integer)
                t.column("createdAt", .integer).notNull()
                t.column("updatedAt", .integer).notNull()
                t.column("serverUpdatedAt", .integer)
                t.column("repeat", .text)
                t.column("labels", .text).notNull().defaults(to: "[]")
                t.column("links", .text).notNull().defaults(to: "[]")
                t.column("deletedAt", .integer)
                t.column("checklist", .text).notNull().defaults(to: "[]")
                t.column("reminders", .text)
            }
            try db.create(table: "outbox") { t in
                t.autoIncrementedPrimaryKey("seq")
                t.column("opId", .text).notNull().unique()
                t.column("mutation", .text).notNull()
                t.column("argsJson", .text).notNull()
                t.column("taskLocalId", .text).indexed()
                t.column("clientId", .text).notNull()
                t.column("createdAt", .integer).notNull()
                t.column("attempts", .integer).notNull().defaults(to: 0)
                t.column("lastError", .text)
            }
            try db.create(table: "meta") { t in
                t.primaryKey("key", .text)
                t.column("value", .text).notNull()
            }
        }
        // 0.3.0: the change history of each task, as `app:getTask` last sent it (replaced, never merged).
        migrator.registerMigration("v2") { db in
            try db.create(table: "taskEvent") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("taskServerId", .text).notNull().indexed()
                t.column("at", .integer).notNull()
                t.column("actor", .text).notNull()
                t.column("actorName", .text)
                t.column("action", .text).notNull()
                t.column("beforeJson", .text)
                t.column("afterJson", .text)
            }
        }
        // 0.3.0: the task's number and agent work, as the snapshot sends them (read-only on the Mac). List and object
        // fields are JSON, as in v1; rows from before stay valid with no criteria, dependencies or claim.
        migrator.registerMigration("v3") { db in
            try db.alter(table: "task") { t in
                t.add(column: "ref", .integer)
                t.add(column: "acceptance", .text).notNull().defaults(to: "[]")
                t.add(column: "plan", .text)
                t.add(column: "proof", .text)
                t.add(column: "dependsOn", .text).notNull().defaults(to: "[]")
                t.add(column: "blockedReason", .text)
                t.add(column: "claimedBy", .text)
                t.add(column: "claimExpiresAt", .integer)
            }
            try db.execute(sql: "UPDATE task SET serverUpdatedAt = NULL")
        }
        return migrator
    }
}

// MARK: - Records

extension TaskItem: FetchableRecord, PersistableRecord {
    public static let databaseTableName = "task"

    public init(row: Row) throws {
        self.init(
            localId: row["localId"],
            serverId: row["serverId"],
            clientId: row["clientId"],
            title: row["title"],
            note: row["note"],
            dueDate: row["dueDate"],
            dueTime: row["dueTime"],
            status: TaskStatus.fromWire(row["status"]),
            isNow: row["isNow"],
            resumeNote: row["resumeNote"],
            completedAt: row["completedAt"],
            archivedAt: row["archivedAt"],
            createdAt: row["createdAt"],
            updatedAt: row["updatedAt"],
            serverUpdatedAt: row["serverUpdatedAt"],
            repeat: FieldJSON.decode(RepeatRule.self, row["repeat"]),
            labels: FieldJSON.decode([String].self, row["labels"]) ?? [],
            links: FieldJSON.decode([TaskLink].self, row["links"]) ?? [],
            deletedAt: row["deletedAt"],
            checklist: FieldJSON.decode([ChecklistItem].self, row["checklist"]) ?? [],
            reminders: FieldJSON.decode([TaskReminder].self, row["reminders"]),
            ref: row["ref"],
            acceptance: FieldJSON.decode([AcceptanceItem].self, row["acceptance"]) ?? [],
            plan: row["plan"],
            proof: FieldJSON.decode(TaskProof.self, row["proof"]),
            dependsOn: FieldJSON.decode([String].self, row["dependsOn"]) ?? [],
            blockedReason: row["blockedReason"],
            claimedBy: row["claimedBy"],
            claimExpiresAt: row["claimExpiresAt"]
        )
    }

    public func encode(to container: inout PersistenceContainer) throws {
        container["localId"] = localId
        container["serverId"] = serverId
        container["clientId"] = clientId
        container["title"] = title
        container["note"] = note
        container["dueDate"] = dueDate
        container["dueTime"] = dueTime
        container["status"] = status.rawValue
        container["isNow"] = isNow
        container["resumeNote"] = resumeNote
        container["completedAt"] = completedAt
        container["archivedAt"] = archivedAt
        container["createdAt"] = createdAt
        container["updatedAt"] = updatedAt
        container["serverUpdatedAt"] = serverUpdatedAt
        container["repeat"] = FieldJSON.encode(self.repeat)
        container["labels"] = FieldJSON.encode(labels)
        container["links"] = FieldJSON.encode(links)
        container["deletedAt"] = deletedAt
        container["checklist"] = FieldJSON.encode(checklist)
        container["reminders"] = FieldJSON.encode(reminders)
        container["ref"] = ref
        container["acceptance"] = FieldJSON.encode(acceptance)
        container["plan"] = plan
        container["proof"] = FieldJSON.encode(proof)
        container["dependsOn"] = FieldJSON.encode(dependsOn)
        container["blockedReason"] = blockedReason
        container["claimedBy"] = claimedBy
        container["claimExpiresAt"] = claimExpiresAt
    }
}

extension TaskEvent: FetchableRecord, PersistableRecord {
    public static let databaseTableName = "taskEvent"

    public init(row: Row) throws {
        self.init(
            taskServerId: row["taskServerId"],
            at: row["at"],
            actor: row["actor"],
            actorName: row["actorName"],
            action: row["action"],
            beforeJson: row["beforeJson"],
            afterJson: row["afterJson"]
        )
    }

    public func encode(to container: inout PersistenceContainer) throws {
        container["taskServerId"] = taskServerId
        container["at"] = at
        container["actor"] = actor
        container["actorName"] = actorName
        container["action"] = action
        container["beforeJson"] = beforeJson
        container["afterJson"] = afterJson
    }
}

/**
 * One local change waiting for the server. Rows are sent strictly in [seq] order and deleted only after the server
 * answered, so they survive the app being quit and the Mac restarting.
 *
 * [argsJson] holds the mutation arguments without `taskId`: the task is named by [taskLocalId] and its server id is
 * filled in at send time, because a task created offline has none yet. [clientId] is also inside [argsJson]; the
 * backend applies an operation with a known `clientId` only once, so resending after a lost answer is safe.
 */
public struct OutboxOp: Hashable, Sendable, FetchableRecord, MutablePersistableRecord, Codable {
    public static let databaseTableName = "outbox"

    public var seq: Int64?
    public var opId: String
    /// Convex function name, e.g. `app:add`.
    public var mutation: String
    public var argsJson: String
    public var taskLocalId: String?
    public var clientId: String
    public var createdAt: Int64
    public var attempts: Int
    public var lastError: String?

    public init(
        seq: Int64? = nil, opId: String, mutation: String, argsJson: String, taskLocalId: String?, clientId: String,
        createdAt: Int64, attempts: Int = 0, lastError: String? = nil
    ) {
        self.seq = seq
        self.opId = opId
        self.mutation = mutation
        self.argsJson = argsJson
        self.taskLocalId = taskLocalId
        self.clientId = clientId
        self.createdAt = createdAt
        self.attempts = attempts
        self.lastError = lastError
    }

    public mutating func didInsert(_ inserted: InsertionSuccess) {
        seq = inserted.rowID
    }
}

/// Mutations of the app layer (`backend/convex/app.ts`) that the outbox sends.
public enum Mutations {
    public static let add = "app:add"
    public static let complete = "app:complete"
    public static let setStatus = "app:setStatus"
    public static let reschedule = "app:reschedule"
    public static let archive = "app:archive"
    public static let setNow = "app:setNow"
    public static let update = "app:update"
    public static let softDelete = "app:softDelete"
    public static let restore = "app:restore"
    public static let updateSettings = "app:updateSettings"
}

/// How list and object fields of a task are stored in columns: JSON, as the backend sends them.
enum FieldJSON {
    static func encode<T: Encodable>(_ value: T?) -> String? {
        guard let value else { return nil }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return (try? encoder.encode(value)).map { String(decoding: $0, as: UTF8.self) }
    }

    static func decode<T: Decodable>(_ type: T.Type, _ text: String?) -> T? {
        guard let text else { return nil }
        return try? JSONDecoder().decode(type, from: Data(text.utf8))
    }
}
