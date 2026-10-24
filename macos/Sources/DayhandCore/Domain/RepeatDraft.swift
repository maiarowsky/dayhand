import Foundation

/**
 * The repeat editor's choices, as the Android app's `RepeatDialog`: no repeat, or every [interval] days, weeks (on
 * [weekdays], or the anchor's weekday when none is picked), months ([monthDay]) or years; counted from the due date
 * or from completion; ending never, on a day or after a number of times. [rule] is what Save stores, and [isValid]
 * holds it to the backend's checks (`TaskRules.isValid`), so the editor never queues a rule the server would refuse.
 */
public struct RepeatDraft: Hashable, Sendable {
    /// Which day of the month a monthly rule falls on.
    public enum MonthDay: Hashable, Sendable {
        case sameDay
        case lastDay
        /// A fixed day 1 to 31, set elsewhere (`dayhand edit --repeat`); kept when the editor opens.
        case day(Int)
        case weekday(WeekdayOfMonth)

        init(_ rule: RepeatRule?) {
            if let day = rule?.monthDay {
                self = day == -1 ? .lastDay : .day(day)
            } else if let w = rule?.weekdayOfMonth {
                self = .weekday(w)
            } else {
                self = .sameDay
            }
        }
    }

    public enum End: String, Hashable, Sendable, CaseIterable {
        case never, until, count
    }

    /// The count a new "after a number of times" starts with.
    public static let defaultCount = 10

    /// Nil: the task does not repeat.
    public var every: RepeatEvery?
    public var interval: Int
    public var weekdays: Set<Int>
    public var monthDay: MonthDay
    public var fromCompletion: Bool
    public var end: End
    /// The last date (YYYY-MM-DD) when [end] is `until`; nil until one is picked.
    public var until: String?
    public var count: Int

    public init(_ rule: RepeatRule?) {
        every = rule?.every
        interval = rule?.interval ?? 1
        weekdays = Set(rule?.weekdays ?? [])
        monthDay = MonthDay(rule)
        fromCompletion = rule?.fromCompletion ?? false
        end = rule?.until != nil ? .until : rule?.count != nil ? .count : .never
        until = rule?.until
        count = rule?.count ?? Self.defaultCount
    }

    /// The rule the choices make; nil when the task does not repeat.
    public var rule: RepeatRule? {
        guard let every else { return nil }
        var rule = RepeatRule(
            every: every,
            interval: interval,
            weekdays: every == .week && !weekdays.isEmpty ? weekdays.sorted() : nil,
            from: fromCompletion ? .completion : nil,
            until: end == .until ? until : nil,
            count: end == .count ? count : nil
        )
        if every == .month {
            switch monthDay {
            case .sameDay: break
            case .lastDay: rule.monthDay = -1
            case .day(let day): rule.monthDay = day
            case .weekday(let w): rule.weekdayOfMonth = w
            }
        }
        return rule
    }

    /// True when Save may store [rule]: no repeat, or a rule the backend accepts with its end day picked.
    public var isValid: Bool {
        guard let rule else { return true }
        return TaskRules.isValid(rule) && (end != .until || until != nil)
    }

    /// The interval is outside what the backend accepts.
    public var intervalInvalid: Bool { !(1...TaskRules.maxRepeatInterval).contains(interval) }

    /// The count is outside what the backend accepts.
    public var countInvalid: Bool { end == .count && !(1...TaskRules.maxRepeatCount).contains(count) }

    /// The end day a new "on a day" starts with: a month after the later of the due date and today.
    public static func defaultUntil(due: CivilDate, today: CivilDate) -> String {
        max(due, today).adding(months: 1).description
    }

    /**
     * The month choices for a task due on [due]: its day, the last day, its nth weekday and, in the month's last week,
     * the last such weekday; a choice [current] holds that is none of these (set elsewhere) is kept at the end.
     */
    public static func monthDays(due: CivilDate, current: RepeatRule?) -> [MonthDay] {
        var choices: [MonthDay] = [.sameDay, .lastDay, .weekday(WeekdayOfMonth(nth: nthOfMonth(due), weekday: due.weekday))]
        if isLastWeekOfMonth(due) { choices.append(.weekday(WeekdayOfMonth(nth: -1, weekday: due.weekday))) }
        let kept = MonthDay(current)
        if current?.every == .month, !choices.contains(kept) { choices.append(kept) }
        return choices
    }

    /// Which of its weekday [date] is in its month: 1 for days 1 to 7, 5 for days 29 to 31.
    public static func nthOfMonth(_ date: CivilDate) -> Int { (date.day - 1) / 7 + 1 }

    /// True when [date] is in the last seven days of its month, so it is also "the last" of its weekday.
    public static func isLastWeekOfMonth(_ date: CivilDate) -> Bool { date.day + 7 > date.lengthOfMonth }
}
