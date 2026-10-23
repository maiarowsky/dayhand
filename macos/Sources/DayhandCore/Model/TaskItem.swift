import Foundation

/// Task status, spelled as the backend spells it (`convex/lib/validators.ts`).
public enum TaskStatus: String, Sendable, Codable, CaseIterable {
    case todo, doing, done

    public static func fromWire(_ value: String?) -> TaskStatus { value.flatMap(TaskStatus.init(rawValue:)) ?? .todo }
}

/// Repeat unit, spelled as the backend spells it (`repeatValidator`).
public enum RepeatEvery: String, Sendable, Codable, CaseIterable {
    case day, week, month, year
}

/// Where the next date of a repeating task is counted from (`repeatValidator.from`).
public enum RepeatFrom: String, Sendable, Codable {
    case due, completion
}

/// The [nth] (1 to 5, or -1 = last to -5) [weekday] (1 = Monday) of a month: "the 2nd Tuesday".
public struct WeekdayOfMonth: Hashable, Sendable, Codable {
    public var nth: Int
    public var weekday: Int

    public init(nth: Int, weekday: Int) {
        self.nth = nth
        self.weekday = weekday
    }
}

/**
 * Repeat every [interval] units; for weekly rules [weekdays] (1 = Monday ... 7 = Sunday) picks the days. Monthly rules
 * may pin [monthDay] (1 to 31, -1 = the last day) or [weekdayOfMonth]. [from] counts the next date from the due date
 * (nil or due) or from the day the task is done; [until] (the last date) or [count] (occurrences left, this one
 * included) end the series. The backend's `repeatValidator`; the dates are in `Recurrence`.
 */
public struct RepeatRule: Hashable, Sendable, Codable {
    public var every: RepeatEvery
    public var interval: Int
    public var weekdays: [Int]?
    public var from: RepeatFrom?
    public var monthDay: Int?
    public var weekdayOfMonth: WeekdayOfMonth?
    public var until: String?
    public var count: Int?

    public init(
        every: RepeatEvery, interval: Int = 1, weekdays: [Int]? = nil, from: RepeatFrom? = nil, monthDay: Int? = nil,
        weekdayOfMonth: WeekdayOfMonth? = nil, until: String? = nil, count: Int? = nil
    ) {
        self.every = every
        self.interval = interval
        self.weekdays = weekdays
        self.from = from
        self.monthDay = monthDay
        self.weekdayOfMonth = weekdayOfMonth
        self.until = until
        self.count = count
    }

    public var fromCompletion: Bool { from == .completion }

    /// A rule as the server sends it (numbers may come as `1.0`); anything else is nil.
    public static func parse(_ value: JSONValue?) -> RepeatRule? {
        guard let o = value?.object, let every = o["every"]?.string.flatMap(RepeatEvery.init(rawValue:)),
              let interval = o["interval"]?.int else { return nil }
        var weekdays: [Int]?
        if let days = o["weekdays"], !days.isNull {
            guard let list = days.array else { return nil }
            let parsed = list.compactMap(\.int)
            guard parsed.count == list.count else { return nil }
            weekdays = parsed
        }
        var weekdayOfMonth: WeekdayOfMonth?
        if let w = o["weekdayOfMonth"]?.object {
            guard let nth = w["nth"]?.int, let weekday = w["weekday"]?.int else { return nil }
            weekdayOfMonth = WeekdayOfMonth(nth: nth, weekday: weekday)
        }
        return RepeatRule(
            every: every,
            interval: interval,
            weekdays: weekdays,
            from: o["from"]?.string.flatMap(RepeatFrom.init(rawValue:)),
            monthDay: o["monthDay"]?.int,
            weekdayOfMonth: weekdayOfMonth,
            until: o["until"]?.string,
            count: o["count"]?.int
        )
    }

    /// The rule as a mutation argument: required fields always, unset optional ones left out.
    public var wire: JSONValue {
        var o: [String: JSONValue] = ["every": .string(every.rawValue), "interval": .of(interval)]
        if let weekdays { o["weekdays"] = .array(weekdays.map(JSONValue.of)) }
        if let from { o["from"] = .string(from.rawValue) }
        if let monthDay { o["monthDay"] = .of(monthDay) }
        if let weekdayOfMonth { o["weekdayOfMonth"] = ["nth": .of(weekdayOfMonth.nth), "weekday": .of(weekdayOfMonth.weekday)] }
        if let until { o["until"] = .string(until) }
        if let count { o["count"] = .of(count) }
        return .object(o)
    }
}

/// One checklist item; the list's order is the order shown. [id] stays with the item across edits.
public struct ChecklistItem: Hashable, Sendable, Codable, Identifiable {
    public var id: String
    public var title: String
    public var done: Bool

    public init(id: String, title: String, done: Bool = false) {
        self.id = id
        self.title = title
        self.done = done
    }

    static func parse(_ value: JSONValue) -> ChecklistItem? {
        guard let id = value["id"]?.string, let title = value["title"]?.string else { return nil }
        return ChecklistItem(id: id, title: title, done: value["done"]?.bool ?? false)
    }

    var wire: JSONValue { ["id": .string(id), "title": .string(title), "done": .bool(done)] }
}

/**
 * One reminder of a task (`reminderValidator`): [minutesBefore] its due time (timed tasks only), or [time] (HH:MM) on
 * the due day or [daysBefore] days earlier. Exactly one of [minutesBefore] and [time] is set.
 */
public struct TaskReminder: Hashable, Sendable, Codable {
    public var minutesBefore: Int?
    public var time: String?
    public var daysBefore: Int?

    public init(minutesBefore: Int? = nil, time: String? = nil, daysBefore: Int? = nil) {
        self.minutesBefore = minutesBefore
        self.time = time
        self.daysBefore = daysBefore
    }

    public static func before(_ minutes: Int) -> TaskReminder { TaskReminder(minutesBefore: minutes) }

    public static func at(_ time: String, daysBefore: Int = 0) -> TaskReminder {
        TaskReminder(time: time, daysBefore: daysBefore > 0 ? daysBefore : nil)
    }

    /// A reminder as the server sends it; anything else is nil.
    static func parse(_ value: JSONValue) -> TaskReminder? {
        if let minutes = value["minutesBefore"]?.int { return .before(minutes) }
        guard let time = value["time"]?.string else { return nil }
        return .at(time, daysBefore: value["daysBefore"]?.int ?? 0)
    }

    var wire: JSONValue {
        var o: [String: JSONValue] = [:]
        if let minutesBefore { o["minutesBefore"] = .of(minutesBefore) }
        if let time { o["time"] = .string(time) }
        if let daysBefore { o["daysBefore"] = .of(daysBefore) }
        return .object(o)
    }
}

/// A link attached to a task (version 1 has links only, no files).
public struct TaskLink: Hashable, Sendable, Codable {
    public var url: String
    public var title: String?

    public init(url: String, title: String? = nil) {
        self.url = url
        self.title = title
    }

    static func parse(_ value: JSONValue) -> TaskLink? {
        guard let url = value["url"]?.string else { return nil }
        return TaskLink(url: url, title: value["title"]?.string)
    }

    var wire: JSONValue {
        var o: [String: JSONValue] = ["url": .string(url)]
        if let title { o["title"] = .string(title) }
        return .object(o)
    }
}

/**
 * A task as the screens see it. The local database is the source of truth for the UI; the server copy arrives
 * through sync and local changes leave through the outbox.
 *
 * [localId] is stable from the moment the task exists on this Mac: the `clientId` of the `add` mutation for tasks
 * created here, the server id for tasks created elsewhere.
 */
public struct TaskItem: Hashable, Sendable, Identifiable {
    public var localId: String
    public var serverId: String?
    public var clientId: String?
    public var title: String
    public var note: String?
    /// Calendar day in the user's time zone, YYYY-MM-DD.
    public var dueDate: String?
    /// Local wall-clock time, HH:MM.
    public var dueTime: String?
    public var status: TaskStatus
    public var isNow: Bool
    /// "Where I stopped / next step".
    public var resumeNote: String?
    public var completedAt: Int64?
    public var archivedAt: Int64?
    public var createdAt: Int64
    public var updatedAt: Int64
    /// `updatedAt` of the last server copy merged into this row; nil until the server has it.
    public var serverUpdatedAt: Int64?
    public var `repeat`: RepeatRule?
    /// Labels, which also serve as projects (the backend has one list for both).
    public var labels: [String]
    public var links: [TaskLink]
    /// In the trash since then; the server purges it 30 days later unless restored.
    public var deletedAt: Int64?
    public var checklist: [ChecklistItem]
    /// This task's own reminders; nil = the default reminders from the settings, empty = none.
    public var reminders: [TaskReminder]?

    public init(
        localId: String, serverId: String? = nil, clientId: String? = nil, title: String, note: String? = nil,
        dueDate: String? = nil, dueTime: String? = nil, status: TaskStatus = .todo, isNow: Bool = false,
        resumeNote: String? = nil, completedAt: Int64? = nil, archivedAt: Int64? = nil, createdAt: Int64,
        updatedAt: Int64, serverUpdatedAt: Int64? = nil, repeat: RepeatRule? = nil, labels: [String] = [],
        links: [TaskLink] = [], deletedAt: Int64? = nil, checklist: [ChecklistItem] = [], reminders: [TaskReminder]? = nil
    ) {
        self.localId = localId
        self.serverId = serverId
        self.clientId = clientId
        self.title = title
        self.note = note
        self.dueDate = dueDate
        self.dueTime = dueTime
        self.status = status
        self.isNow = isNow
        self.resumeNote = resumeNote
        self.completedAt = completedAt
        self.archivedAt = archivedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.serverUpdatedAt = serverUpdatedAt
        self.repeat = `repeat`
        self.labels = labels
        self.links = links
        self.deletedAt = deletedAt
        self.checklist = checklist
        self.reminders = reminders
    }

    public var id: String { localId }

    public var inTrash: Bool { deletedAt != nil }

    /// Shown on Today: neither archived nor in the trash.
    public var isActive: Bool { archivedAt == nil && deletedAt == nil }
}
