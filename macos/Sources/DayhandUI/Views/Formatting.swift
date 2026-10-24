import DayhandCore
import DayhandLocalization
import Foundation
import SwiftUI

/// How days, times and the connection read on screen, in the current language.
enum Formatting {
    /// "Today", "Tomorrow", "Yesterday", or "Fri 23 Oct" (with the year when it is not this year).
    static func day(_ date: String, today: String) -> String {
        guard let civil = CivilDate(date), let now = CivilDate(today) else { return date }
        switch now.days(until: civil) {
        case 0: return tr("Today")
        case 1: return tr("Tomorrow")
        case -1: return tr("Yesterday")
        default: return DateText.day(date, withYear: civil.year != now.year) ?? date
        }
    }

    /// "Today, 14:00", "Fri 23 Oct", or nil for a task without a day.
    static func due(_ task: TaskItem, today: String) -> String? {
        guard let date = task.dueDate else { return nil }
        let dayText = day(date, today: today)
        guard let time = task.dueTime else { return dayText }
        return pair(dayText, DateText.time(time))
    }

    static func when(_ when: When, today: String) -> String {
        var text = day(when.date, today: today)
        if let time = when.time { text = pair(text, DateText.time(time)) }
        if let shifted = when.shiftedFrom { text = tr("\(text) (\(DateText.time(shifted)) does not exist that day)") }
        return text
    }

    /// "Today, 14:00": two parts of one line.
    static func pair(_ first: String, _ second: String) -> String {
        tr("\(first), \(second)")
    }

    /// The repeat rule in a few words: "Every 2 weeks on Mon, Thu", "Monthly on the last day".
    static func repeatRule(_ rule: RepeatRule) -> String {
        let n = rule.interval
        var parts: [String]
        switch rule.every {
        case .day: parts = [n == 1 ? tr("Daily") : tr("Every \(n) days")]
        case .week: parts = [n == 1 ? tr("Weekly") : tr("Every \(n) weeks")]
        case .month: parts = [n == 1 ? tr("Monthly") : tr("Every \(n) months")]
        case .year: parts = [n == 1 ? tr("Yearly") : tr("Every \(n) years")]
        }
        if let days = rule.weekdays, !days.isEmpty {
            parts.append(tr("on \(days.sorted().compactMap(DateText.shortWeekday).joined(separator: DateText.listSeparator))"))
        }
        if let monthDay = rule.monthDay { parts.append(monthDay == -1 ? tr("on the last day") : tr("on day \(monthDay)")) }
        if let w = rule.weekdayOfMonth, (1...7).contains(w.weekday) {
            parts.append(weekdayOfMonth(nth: w.nth, weekday: w.weekday))
        }
        if rule.fromCompletion { parts.append(tr("after completion")) }
        if let until = rule.until { parts.append(tr("until \(DateText.day(until, withYear: true) ?? until)")) }
        if let count = rule.count { parts.append(tr("\(count) more times")) }
        return parts.joined(separator: " ")
    }

    /// "on the first Monday", "on the last Friday": whole phrases, because in some languages the word for "first"
    /// changes with the weekday.
    static func weekdayOfMonth(nth: Int, weekday: Int) -> String {
        switch (nth, weekday) {
        case (1, 1): return tr("on the first Monday")
        case (1, 2): return tr("on the first Tuesday")
        case (1, 3): return tr("on the first Wednesday")
        case (1, 4): return tr("on the first Thursday")
        case (1, 5): return tr("on the first Friday")
        case (1, 6): return tr("on the first Saturday")
        case (1, 7): return tr("on the first Sunday")
        case (2, 1): return tr("on the second Monday")
        case (2, 2): return tr("on the second Tuesday")
        case (2, 3): return tr("on the second Wednesday")
        case (2, 4): return tr("on the second Thursday")
        case (2, 5): return tr("on the second Friday")
        case (2, 6): return tr("on the second Saturday")
        case (2, 7): return tr("on the second Sunday")
        case (3, 1): return tr("on the third Monday")
        case (3, 2): return tr("on the third Tuesday")
        case (3, 3): return tr("on the third Wednesday")
        case (3, 4): return tr("on the third Thursday")
        case (3, 5): return tr("on the third Friday")
        case (3, 6): return tr("on the third Saturday")
        case (3, 7): return tr("on the third Sunday")
        case (4, 1): return tr("on the fourth Monday")
        case (4, 2): return tr("on the fourth Tuesday")
        case (4, 3): return tr("on the fourth Wednesday")
        case (4, 4): return tr("on the fourth Thursday")
        case (4, 5): return tr("on the fourth Friday")
        case (4, 6): return tr("on the fourth Saturday")
        case (4, 7): return tr("on the fourth Sunday")
        case (5, 1): return tr("on the fifth Monday")
        case (5, 2): return tr("on the fifth Tuesday")
        case (5, 3): return tr("on the fifth Wednesday")
        case (5, 4): return tr("on the fifth Thursday")
        case (5, 5): return tr("on the fifth Friday")
        case (5, 6): return tr("on the fifth Saturday")
        case (5, 7): return tr("on the fifth Sunday")
        case (-1, 1): return tr("on the last Monday")
        case (-1, 2): return tr("on the last Tuesday")
        case (-1, 3): return tr("on the last Wednesday")
        case (-1, 4): return tr("on the last Thursday")
        case (-1, 5): return tr("on the last Friday")
        case (-1, 6): return tr("on the last Saturday")
        case (-1, 7): return tr("on the last Sunday")
        default:
            let name = DateText.shortWeekday(weekday) ?? "\(weekday)"
            return tr("on \(name) number \(abs(nth)) from the end")
        }
    }

    static func reminders(_ reminders: [TaskReminder]?, defaults: [Int]) -> String {
        let separator = DateText.listSeparator
        guard let reminders else { return tr("As in settings (\(defaults.map(minutes).joined(separator: separator)))") }
        if reminders.isEmpty { return tr("None") }
        return reminders.map { reminder in
            if let minutes = reminder.minutesBefore { return Self.minutes(minutes) }
            let days = reminder.daysBefore ?? 0
            let time = reminder.time.map(DateText.time) ?? "?"
            switch days {
            case 0: return tr("\(time) on the day")
            case 1: return tr("\(time) the day before")
            default: return pair(time, tr("\(days) days before"))
            }
        }.joined(separator: separator)
    }

    static func minutes(_ minutes: Int) -> String {
        if minutes == 0 { return tr("at the due time") }
        if minutes % 1440 == 0 { return tr("\(minutes / 1440) days before") }
        if minutes % 60 == 0 { return tr("\(minutes / 60) h before") }
        return tr("\(minutes) min before")
    }

    /// The connection in words, for the status line and Settings.
    static func status(_ status: SyncStatus, pending: Int, useOffline: Bool) -> String? {
        switch status {
        case .notConnected:
            return useOffline ? tr("Not connected to a server; tasks stay on this Mac.") : tr("No server connected.")
        case .connecting:
            return tr("Connecting…")
        case .synced:
            return pending > 0 ? tr("Sending \(pending) changes…") : nil
        case .signedOut:
            return tr("The server signed this Mac out. Connect again with a new code; your tasks stay here.")
        case .offline(let reason):
            let base = pending > 0 ? tr("Offline: \(pending) changes wait for the server.") : tr("Cannot reach the server.")
            return reason.hasPrefix("HTTP 5") ? base + " " + tr("The server has a problem.") : base
        }
    }
}

extension Color {
    static let overdue = Color.red
}
