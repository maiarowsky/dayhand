import Foundation

/// One notification to leave with the system, to ring at [at] (Unix ms) even while Dayhand is not running.
public struct PlannedNotification: Hashable, Sendable {
    public enum Kind: Hashable, Sendable {
        case reminder(taskLocalId: String)
        case summary
    }

    /// Stable for the same ring, so planning again keeps what is already scheduled.
    public let id: String
    public let at: Int64
    public let title: String
    public let body: String
    public let kind: Kind
}

/**
 * The reminders and morning summaries ahead, computed from the local database with the Android app's rules
 * (`ReminderRules`, `morningSummary`). Android keeps two alarms and works out what to show when one fires; macOS
 * delivers notifications left with it in advance, so the plan is the next [limit] rings, each with its text, made
 * again after every change of tasks or settings. Overdue tasks never ring, and each summary is worked out for its own
 * morning from today's tasks.
 */
public enum ReminderPlanner {
    /// macOS keeps at most 64 pending notifications per app.
    public static let limit = 60
    /// Summaries planned ahead, so mornings ring even if Dayhand is not opened for a while.
    public static let summaryDays = 7
    public static let idPrefix = "dayhand."

    public static func plan(_ tasks: [TaskItem], settings: ReminderSettings, now: Int64, limit: Int = limit) -> [PlannedNotification] {
        let zone = settings.timezone
        let reminders = ReminderRules.reminders(tasks, minutesBefore: settings.reminderMinutes, timezone: zone)
            .filter { $0.at > now && $0.dueDate >= HelmDates.localDate($0.at, zone) }
        var summaries: [PlannedNotification] = []
        var after = now
        for _ in 0..<summaryDays {
            let at = ReminderRules.nextSummaryAt(now: after, summaryTime: settings.summaryTime, timezone: zone)
            let summary = morningSummary(tasks, nowMs: at, timezone: zone)
            let day = HelmDates.localDate(at, zone)
            summaries.append(PlannedNotification(
                id: "\(idPrefix)summary.\(day)", at: at, title: summaryTitle(summary), body: summaryBody(summary), kind: .summary
            ))
            after = at
        }
        let rings = reminders.map { reminder in
            PlannedNotification(
                id: "\(idPrefix)reminder.\(reminder.taskLocalId).\(reminder.at)",
                at: reminder.at,
                title: reminder.title,
                body: reminderBody(reminder, timezone: zone),
                kind: .reminder(taskLocalId: reminder.taskLocalId)
            )
        }
        return Array((rings + summaries).sorted { $0.at != $1.at ? $0.at < $1.at : $0.id < $1.id }.prefix(limit))
    }

    static func reminderBody(_ reminder: Reminder, timezone: String) -> String {
        let ringDay = HelmDates.localDate(reminder.at, timezone)
        let day = reminder.dueDate == ringDay ? "Today" : (HelmDates.addDays(ringDay, 1) == reminder.dueDate ? "Tomorrow" : reminder.dueDate)
        guard let time = reminder.dueTime else { return day }
        if reminder.minutesBefore == 0 { return "Now, \(time)" }
        return "\(day) at \(time)"
    }

    static func summaryTitle(_ summary: MorningSummary) -> String {
        let today = summary.today == 1 ? "1 task today" : "\(summary.today) tasks today"
        return summary.overdue == 0 ? today : "\(today), \(summary.overdue) overdue"
    }

    static func summaryBody(_ summary: MorningSummary) -> String {
        guard let start = summary.startWith else { return "Nothing planned. Add a task with the quick add shortcut." }
        return "Start with: \(start)"
    }
}
