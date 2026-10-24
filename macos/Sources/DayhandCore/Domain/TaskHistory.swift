import Foundation

/// Who made a change, as the backend records it (`actorValidator`): the app, a person with `dayhand`, or an agent.
public enum HistoryActor: Hashable, Sendable {
    case app
    case cli
    /// An agent, with the name of its key or connection when the server knows it ("claude").
    case agent(name: String?)

    /// Anything the app does not know is not shown as the app's own change, as on the phone.
    public static func fromWire(_ actor: String, name: String?) -> HistoryActor {
        switch actor {
        case "app": return .app
        case "cli": return .cli
        default: return .agent(name: name.flatMap { $0.isEmpty ? nil : $0 })
        }
    }
}

/// Task fields a history entry can show, in the order they are listed (the Android app's `HistoryField`).
public enum HistoryField: String, CaseIterable, Hashable, Sendable {
    case title
    case status
    case now = "isNow"
    case dueDate
    case dueTime
    case `repeat`
    case labels
    case links
    case checklist
    case reminders
    case note
    case resumeNote
}

public struct FieldChange: Hashable, Sendable {
    public let field: HistoryField
    public let before: JSONValue
    public let after: JSONValue

    public init(field: HistoryField, before: JSONValue, after: JSONValue) {
        self.field = field
        self.before = before
        self.after = after
    }
}

public struct HistoryEntry: Hashable, Sendable {
    public let at: Int64
    public let actor: HistoryActor
    /// The backend's action: `create`, `update`, `complete`, `delete`, …
    public let action: String
    public let changes: [FieldChange]
}

/**
 * One event of a task's change history as `app:getTask` returns it, cached in the database so the details show who
 * changed what also offline. [before] and [after] hold only the fields the change touched, as JSON objects.
 */
public struct TaskEvent: Hashable, Sendable {
    public var taskServerId: String
    public var at: Int64
    public var actor: String
    public var actorName: String?
    public var action: String
    public var beforeJson: String?
    public var afterJson: String?

    public init(
        taskServerId: String, at: Int64, actor: String, actorName: String? = nil, action: String,
        beforeJson: String? = nil, afterJson: String? = nil
    ) {
        self.taskServerId = taskServerId
        self.at = at
        self.actor = actor
        self.actorName = actorName
        self.action = action
        self.beforeJson = beforeJson
        self.afterJson = afterJson
    }

    /**
     * Who, when, which action and the changed fields worth showing, as the Android app's `historyEntry`. Timestamps
     * (`completedAt`, `deletedAt`, …) are left out; the action already says it.
     */
    public var entry: HistoryEntry {
        let before = Self.fields(beforeJson)
        let after = Self.fields(afterJson)
        let changes = HistoryField.allCases.compactMap { field -> FieldChange? in
            let key = field.rawValue
            guard before[key] != nil || after[key] != nil else { return nil }
            let old = before[key] ?? .null
            let new = after[key] ?? .null
            // A new task lists every field; only the ones it actually set are worth showing.
            if before[key] == nil, Self.isUnset(new) { return nil }
            return old == new ? nil : FieldChange(field: field, before: old, after: new)
        }
        return HistoryEntry(at: at, actor: HistoryActor.fromWire(actor, name: actorName), action: action, changes: changes)
    }

    private static func fields(_ json: String?) -> [String: JSONValue] {
        json.flatMap(JSONValue.decode)?.object ?? [:]
    }

    private static func isUnset(_ value: JSONValue) -> Bool {
        value == .null || value == .bool(false) || value.array?.isEmpty == true
    }
}

/// Whether the details show a fresh history or the last cached copy (the Android app's `HistoryState`).
public enum HistoryState: Hashable, Sendable {
    case loading
    case fresh
    /// No server, or it did not answer: the copy from the last connection.
    case cached
    /// The task was made offline and its `add` has not reached the server yet.
    case notOnServerYet
}
