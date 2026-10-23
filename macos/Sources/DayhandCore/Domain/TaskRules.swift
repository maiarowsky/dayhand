import Foundation

/**
 * The backend's input checks (`backend/convex/lib/core.ts`, `repeat.ts`), applied before a change enters the outbox,
 * as the Android app's `TaskRules`: a change the server would refuse is never queued, so the user sees the problem at
 * once instead of the change silently disappearing later.
 */
public enum TaskRules {
    public static let maxTitle = 500
    public static let maxNote = 20_000
    public static let maxResumeNote = 2_000
    public static let maxLabel = 50
    public static let maxLabels = 20
    public static let maxLinks = 20
    public static let maxURL = 2_048
    public static let maxRepeatInterval = 366
    public static let maxRepeatCount = 1000
    public static let maxChecklist = 100
    public static let maxReminders = 5
    public static let maxReminderMinutes = 7 * 24 * 60
    public static let maxReminderDays = 30

    /// A trimmed, non-empty title within the limit, or nil.
    public static func title(_ input: String) -> String? {
        let clean = input.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty || clean.jsLength > maxTitle ? nil : clean
    }

    /// Trimmed, without blanks and duplicates, as the backend stores them; nil when over a limit.
    public static func labels(_ input: [String]) -> [String]? {
        var seen = Set<String>()
        let cleaned = input
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
        if cleaned.count > maxLabels || cleaned.contains(where: { $0.jsLength > maxLabel }) { return nil }
        return cleaned
    }

    /// True for an absolute http(s) address the backend accepts.
    public static func isLinkURL(_ url: String) -> Bool {
        guard !url.isEmpty, url.jsLength <= maxURL, url == url.trimmingCharacters(in: .whitespacesAndNewlines),
              let components = URLComponents(string: url), let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https", let host = components.host, !host.isEmpty else { return false }
        return true
    }

    /// The link as the backend stores it (blank title dropped), or nil when the address is not accepted.
    public static func link(url: String, title: String?) -> TaskLink? {
        let cleanUrl = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isLinkURL(cleanUrl) else { return nil }
        let cleanTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        return TaskLink(url: cleanUrl, title: cleanTitle?.isEmpty == false ? cleanTitle : nil)
    }

    /// The backend's `validateRepeat`.
    public static func isValid(_ rule: RepeatRule) -> Bool {
        guard (1...maxRepeatInterval).contains(rule.interval) else { return false }
        if let days = rule.weekdays {
            if rule.every != .week || days.isEmpty || Set(days).count != days.count || days.contains(where: { !(1...7).contains($0) }) {
                return false
            }
        }
        if let day = rule.monthDay, rule.every != .month || (day != -1 && !(1...31).contains(day)) { return false }
        if let w = rule.weekdayOfMonth {
            if rule.every != .month || rule.monthDay != nil || w.nth == 0 || !(-5...5).contains(w.nth) || !(1...7).contains(w.weekday) {
                return false
            }
        }
        if let until = rule.until, rule.count != nil || CivilDate(until) == nil { return false }
        if let count = rule.count { return (1...maxRepeatCount).contains(count) }
        return true
    }

    /// Reminders as the backend keeps them (checked, without duplicates); nil when one is invalid or there are too many.
    public static func reminders(_ input: [TaskReminder]) -> [TaskReminder]? {
        var seen = Set<TaskReminder>()
        let cleaned = input.filter { seen.insert($0).inserted }
        guard cleaned.count <= maxReminders, cleaned.allSatisfy(isValid) else { return nil }
        return cleaned
    }

    public static func isValid(_ reminder: TaskReminder) -> Bool {
        if let minutes = reminder.minutesBefore {
            return reminder.time == nil && reminder.daysBefore == nil && (0...maxReminderMinutes).contains(minutes)
        }
        guard let time = reminder.time else { return false }
        if let days = reminder.daysBefore, !(1...maxReminderDays).contains(days) { return false }
        return ClockTime(time) != nil
    }

    /// The checklist as the backend stores it: trimmed titles, blank items dropped; nil when over a limit.
    public static func checklist(_ items: [ChecklistItem]) -> [ChecklistItem]? {
        let cleaned = items
            .map { ChecklistItem(id: $0.id, title: $0.title.trimmingCharacters(in: .whitespacesAndNewlines), done: $0.done) }
            .filter { !$0.title.isEmpty }
        if cleaned.count > maxChecklist || cleaned.contains(where: { $0.title.jsLength > maxTitle }) { return nil }
        if Set(cleaned.map(\.id)).count != cleaned.count { return nil }
        return cleaned
    }
}

extension String {
    /// The length the backend measures (JavaScript's `length`: UTF-16 code units).
    public var jsLength: Int { utf16.count }
}
