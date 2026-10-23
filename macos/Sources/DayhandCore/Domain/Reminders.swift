import Foundation

/**
 * One ring at instant [at] (Unix ms): [minutesBefore] minutes before a timed task's due time, or (with [minutesBefore]
 * nil) at a time of day on the due day or [daysBefore] days earlier, from the task's own reminders.
 */
public struct Reminder: Hashable, Sendable {
    public let taskLocalId: String
    public let title: String
    public let dueDate: String
    public let dueTime: String?
    public let minutesBefore: Int?
    public let at: Int64
    public let daysBefore: Int
}

/// The morning notification: how much is on today, how much is overdue and where to start.
public struct MorningSummary: Hashable, Sendable {
    public let today: Int
    public let overdue: Int
    public let startWith: String?
}

/// The server settings that decide when the Mac rings (`getSettings`), with the backend's defaults.
public struct ReminderSettings: Hashable, Sendable {
    public var timezone: String
    public var summaryTime: String
    public var reminderMinutes: [Int]

    public init(
        timezone: String = HelmDates.defaultTimezone,
        summaryTime: String = ReminderRules.defaultSummaryTime,
        reminderMinutes: [Int] = ReminderRules.defaultReminderMinutes
    ) {
        self.timezone = timezone
        self.summaryTime = summaryTime
        self.reminderMinutes = reminderMinutes
    }
}

/**
 * When the Mac rings, as the Android app's `ReminderRules`. Everything is computed from the local database, in the
 * user's time zone from the server settings (the same zone that decides "today"), so no server is needed.
 *
 * Only open tasks with a day ring. Overdue tasks never ring: they wait at the top of Today.
 */
public enum ReminderRules {
    /// Backend defaults (`DEFAULT_SETTINGS` in `backend/convex/lib/core.ts`).
    public static let defaultSummaryTime = "05:00"
    public static let defaultReminderMinutes = [0]

    /// A reminder that would fire later than this (a Mac asleep or off) is dropped instead of ringing late.
    public static let lateLimitMs: Int64 = 15 * 60_000

    static let minuteMs: Int64 = 60_000

    /// The due instant of a timed task; a time skipped by a clock change moves forward by the gap.
    public static func dueAt(_ task: TaskItem, _ timezone: String?) -> Int64? {
        guard let date = task.dueDate.flatMap(CivilDate.init), let time = task.dueTime.flatMap(ClockTime.init) else { return nil }
        return HelmDates.instantOf(LocalMoment(date: date, time: time), timezone)
    }

    /**
     * Every reminder of the open tasks with a due day, earliest first: a task's own reminders, or the default
     * [minutesBefore] when it has none of its own (nil). Minutes before ring only for timed tasks; a time of day rings
     * for any task with a day. A reminder whose moment had already passed when the task was last changed is left out:
     * setting a task for 13:15 at 13:10 does not ring the 30-minute reminder.
     */
    public static func reminders(_ tasks: [TaskItem], minutesBefore: [Int], timezone: String?) -> [Reminder] {
        tasks
            .filter { $0.status != .done && $0.isActive && $0.dueDate != nil }
            .flatMap { task -> [Reminder] in
                let own = task.reminders ?? minutesBefore.map(TaskReminder.before)
                var seen = Set<TaskReminder>()
                return own
                    .filter { seen.insert($0).inserted }
                    .compactMap { reminderOf(task, $0, timezone) }
                    .filter { $0.at > task.updatedAt }
            }
            .sorted { $0.at != $1.at ? $0.at < $1.at : $0.taskLocalId < $1.taskLocalId }
    }

    private static func reminderOf(_ task: TaskItem, _ reminder: TaskReminder, _ timezone: String?) -> Reminder? {
        guard let dueDate = task.dueDate, let date = CivilDate(dueDate) else { return nil }
        if let minutes = reminder.minutesBefore {
            guard let due = dueAt(task, timezone) else { return nil }
            return Reminder(
                taskLocalId: task.localId, title: task.title, dueDate: dueDate, dueTime: task.dueTime,
                minutesBefore: minutes, at: due - Int64(minutes) * minuteMs, daysBefore: 0
            )
        }
        guard let time = reminder.time.flatMap(ClockTime.init) else { return nil }
        let days = reminder.daysBefore ?? 0
        let at = HelmDates.instantOf(LocalMoment(date: date.adding(days: -days), time: time), timezone)
        return Reminder(
            taskLocalId: task.localId, title: task.title, dueDate: dueDate, dueTime: task.dueTime,
            minutesBefore: nil, at: at, daysBefore: days
        )
    }

    /// When the reminder alarm should fire next: the first reminder not handled yet and not too late.
    public static func nextAlarm(_ reminders: [Reminder], now: Int64, handledUntil: Int64) -> Int64? {
        let after = max(handledUntil, now - lateLimitMs)
        return reminders.first { $0.at > after }?.at
    }

    /**
     * What to show when the alarm fires at [now]: reminders since the last check that are not too late and whose
     * task is not overdue, the latest one per task.
     */
    public static func due(_ reminders: [Reminder], now: Int64, handledUntil: Int64, timezone: String?) -> [Reminder] {
        let today = HelmDates.localDate(now, timezone)
        let candidates = reminders.filter {
            $0.at > handledUntil && $0.at <= now && now - $0.at <= lateLimitMs && $0.dueDate >= today
        }
        let latest = Dictionary(grouping: candidates, by: \.taskLocalId).compactMap { $0.value.max { $0.at < $1.at } }
        return latest.sorted { $0.at != $1.at ? $0.at < $1.at : $0.taskLocalId < $1.taskLocalId }
    }

    /// The next moment strictly after [now] when the clock in [timezone] shows [summaryTime].
    public static func nextSummaryAt(now: Int64, summaryTime: String, timezone: String?) -> Int64 {
        let time = ClockTime(summaryTime) ?? ClockTime(defaultSummaryTime)!
        var day = HelmDates.today(now, timezone)
        while true {
            let at = HelmDates.instantOf(LocalMoment(date: day, time: time), timezone)
            if at > now { return at }
            day = day.adding(days: 1)
        }
    }
}

/// The morning summary from the same sections as the Today screen; the "now" task counts as today's.
public func morningSummary(_ tasks: [TaskItem], nowMs: Int64, timezone: String?) -> MorningSummary {
    let sections = todaySections(tasks, nowMs: nowMs, timezone: timezone)
    let start = sections.now ?? sections.overdue.first ?? sections.today.first
    return MorningSummary(
        today: sections.today.count + (sections.now == nil ? 0 : 1),
        overdue: sections.overdue.count,
        startWith: start?.title
    )
}
