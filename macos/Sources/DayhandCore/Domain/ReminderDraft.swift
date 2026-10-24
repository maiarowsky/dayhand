import Foundation

/**
 * The reminder editor's choices, as the Android app's `RemindersDialog`: the defaults from the settings, none, or the
 * task's own (minutes before the due time and times of day on the due day or earlier). [reminders] is what Save
 * stores, and [isValid] holds it to the backend's checks (`TaskRules.reminders`: at most five, each valid), so the
 * editor never queues reminders the server would refuse. Times set elsewhere further ahead are kept.
 */
public struct ReminderDraft: Hashable, Sendable {
    public enum Mode: String, Hashable, Sendable, CaseIterable {
        case defaults, none, custom
    }

    /// The minutes-before choices always offered (as the Android app's `REMINDER_OPTIONS`).
    public static let beforeOptions = [0, 5, 10, 15, 30, 60, 120, 1440]

    public var mode: Mode
    public var minutes: Set<Int>
    /// Reminders at a time of day, in the order they were added.
    public var times: [TaskReminder]

    /// [reminders] as the task has them: nil for the defaults, which a switch to Custom starts from.
    public init(_ reminders: [TaskReminder]?, defaults: [Int]) {
        mode = reminders == nil ? .defaults : reminders?.isEmpty == true ? .none : .custom
        minutes = Set(reminders.map { $0.compactMap(\.minutesBefore) } ?? defaults)
        times = (reminders ?? []).filter { $0.minutesBefore == nil }
    }

    /// What Save stores: nil for the defaults, an empty list for none.
    public var reminders: [TaskReminder]? {
        switch mode {
        case .defaults: return nil
        case .none: return []
        case .custom: return minutes.sorted().map(TaskReminder.before) + times
        }
    }

    public var isValid: Bool { reminders.map { TaskRules.reminders($0) != nil } ?? true }

    /// The minutes-before choices: the usual ones and any other the task already has.
    public var beforeChoices: [Int] { Set(Self.beforeOptions).union(minutes).sorted() }

    public mutating func toggle(minutes value: Int) {
        if minutes.contains(value) { minutes.remove(value) } else { minutes.insert(value) }
    }

    /// Adds a time of day ([daysBefore] 0 = the due day); the same reminder twice is one.
    public mutating func addTime(_ time: String, daysBefore: Int) {
        let reminder = TaskReminder.at(time, daysBefore: daysBefore)
        if !times.contains(reminder) { times.append(reminder) }
    }

    public mutating func removeTime(_ reminder: TaskReminder) {
        times.removeAll { $0 == reminder }
    }
}
