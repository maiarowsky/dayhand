import DayhandCore
import Foundation
import SwiftUI

/// How days, times and the connection read on screen.
enum Formatting {
    /// "Today", "Tomorrow", "Yesterday", or "Fri 23 Oct" (with the year when it is not this year).
    static func day(_ date: String, today: String) -> String {
        guard let civil = CivilDate(date), let now = CivilDate(today) else { return date }
        switch now.days(until: civil) {
        case 0: return "Today"
        case 1: return "Tomorrow"
        case -1: return "Yesterday"
        default:
            let formatter = DateFormatter()
            formatter.timeZone = TimeZone(identifier: "UTC")
            // The screens are in English only so far; dates follow them instead of the Mac's language.
            formatter.locale = Locale(identifier: "en_GB")
            formatter.setLocalizedDateFormatFromTemplate(civil.year == now.year ? "EEE d MMM" : "EEE d MMM yyyy")
            let instant = Date(timeIntervalSince1970: TimeInterval(civil.dayNumber) * 86_400)
            return formatter.string(from: instant)
        }
    }

    /// "Today, 14:00", "Fri 23 Oct", or nil for a task without a day.
    static func due(_ task: TaskItem, today: String) -> String? {
        guard let date = task.dueDate else { return nil }
        let dayText = day(date, today: today)
        guard let time = task.dueTime else { return dayText }
        return "\(dayText), \(time)"
    }

    static func when(_ when: When, today: String) -> String {
        var text = day(when.date, today: today)
        if let time = when.time { text += ", \(time)" }
        if let shifted = when.shiftedFrom { text += " (\(shifted) does not exist that day)" }
        return text
    }

    /// The repeat rule in a few words: "Every 2 weeks on Mon, Thu", "Monthly on the last day".
    static func repeatRule(_ rule: RepeatRule) -> String {
        let unit: String
        switch rule.every {
        case .day: unit = rule.interval == 1 ? "Daily" : "Every \(rule.interval) days"
        case .week: unit = rule.interval == 1 ? "Weekly" : "Every \(rule.interval) weeks"
        case .month: unit = rule.interval == 1 ? "Monthly" : "Every \(rule.interval) months"
        case .year: unit = rule.interval == 1 ? "Yearly" : "Every \(rule.interval) years"
        }
        var parts = [unit]
        let names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        if let days = rule.weekdays, !days.isEmpty {
            parts.append("on " + days.sorted().compactMap { (1...7).contains($0) ? names[$0 - 1] : nil }.joined(separator: ", "))
        }
        if let day = rule.monthDay { parts.append(day == -1 ? "on the last day" : "on day \(day)") }
        if let w = rule.weekdayOfMonth, (1...7).contains(w.weekday) {
            let nth = w.nth == -1 ? "last" : (w.nth < 0 ? "\(-w.nth)th from the end" : ["1st", "2nd", "3rd", "4th", "5th"][min(w.nth, 5) - 1])
            parts.append("on the \(nth) \(names[w.weekday - 1])")
        }
        if rule.fromCompletion { parts.append("after completion") }
        if let until = rule.until { parts.append("until \(until)") }
        if let count = rule.count { parts.append(count == 1 ? "1 more time" : "\(count) more times") }
        return parts.joined(separator: " ")
    }

    static func reminders(_ reminders: [TaskReminder]?, defaults: [Int]) -> String {
        guard let reminders else { return "As in settings (" + defaults.map(minutes).joined(separator: ", ") + ")" }
        if reminders.isEmpty { return "None" }
        return reminders.map { reminder in
            if let minutes = reminder.minutesBefore { return Self.minutes(minutes) }
            let days = reminder.daysBefore ?? 0
            let time = reminder.time ?? "?"
            return days == 0 ? "\(time) on the day" : (days == 1 ? "\(time) the day before" : "\(time), \(days) days before")
        }.joined(separator: ", ")
    }

    static func minutes(_ minutes: Int) -> String {
        if minutes == 0 { return "at the due time" }
        if minutes % 1440 == 0 { return minutes == 1440 ? "1 day before" : "\(minutes / 1440) days before" }
        if minutes % 60 == 0 { return minutes == 60 ? "1 h before" : "\(minutes / 60) h before" }
        return "\(minutes) min before"
    }

    /// The connection in words, for the status line and Settings.
    static func status(_ status: SyncStatus, pending: Int, useOffline: Bool) -> String? {
        let waiting = pending == 1 ? "1 change waits" : "\(pending) changes wait"
        switch status {
        case .notConnected:
            return useOffline ? "Not connected to a server; tasks stay on this Mac." : "No server connected."
        case .connecting:
            return "Connecting…"
        case .synced:
            return pending > 0 ? "Sending \(pending == 1 ? "1 change" : "\(pending) changes")…" : nil
        case .signedOut:
            return "The server signed this Mac out. Connect again with a new code; your tasks stay here."
        case .offline(let reason):
            let base = pending > 0 ? "Offline: \(waiting) for the server." : "Cannot reach the server."
            return reason.hasPrefix("HTTP 5") ? base + " The server has a problem." : base
        }
    }
}

extension Color {
    static let overdue = Color.red
}
