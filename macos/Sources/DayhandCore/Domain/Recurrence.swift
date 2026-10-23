import Foundation

/**
 * The dates a repeating task falls on, exactly as `backend/convex/lib/repeat.ts` and the Android app's
 * `domain/Recurrence.kt` compute them: [advance] is what completing a task creates on the server, [occurrences] lists
 * a series ahead. Both walk the same [step], so listing ahead gives the dates that completing each occurrence on its
 * day would create. Pure: plain calendar dates, no time zone.
 */
public enum Recurrence {
    /// Months searched for an nth weekday a month may lack (a 5th Monday).
    static let maxMonthSearch = 120

    /// Safety net for a due date far in the past; one step per occurrence.
    static let maxSteps = 100_000

    /// A date of a series and the rule that continues from it.
    public struct Position: Hashable, Sendable {
        public let date: CivilDate
        public let rule: RepeatRule
    }

    /// The next occurrence after completing a task: its due date and the rule it carries on with.
    public struct Next: Hashable, Sendable {
        public let dueDate: String
        public let `repeat`: RepeatRule

        public init(dueDate: String, repeat: RepeatRule) {
            self.dueDate = dueDate
            self.repeat = `repeat`
        }
    }

    /// Day [monthDay] (-1 = the last) of the month of [month]; a day the month lacks becomes its last day.
    public static func monthDayIn(_ month: CivilDate, _ monthDay: Int) -> CivilDate {
        let last = month.lengthOfMonth
        return month.withDay(monthDay == -1 ? last : min(monthDay, last))
    }

    /// The [nth] [weekday] (1 = Monday) of the month of [month], negative from its end, or nil when it has none.
    public static func nthWeekdayIn(_ month: CivilDate, _ nth: Int, _ weekday: Int) -> CivilDate? {
        let first = month.firstOfMonth
        let last = month.lengthOfMonth
        if nth > 0 {
            let day = 1 + mod(weekday - first.weekday, 7) + 7 * (nth - 1)
            return day <= last ? first.withDay(day) : nil
        }
        let lastDay = first.withDay(last)
        let day = last - mod(lastDay.weekday - weekday, 7) - 7 * (-nth - 1)
        return day >= 1 ? first.withDay(day) : nil
    }

    /**
     * The next date of a series after [date], the series running from [date]. A plain monthly rule that had to move a
     * 29-31 to a shorter month's last day keeps the intended day from then on (`monthDay`), so 31 Jan, 28 Feb, 31 Mar.
     * Nil when no later date exists.
     */
    public static func step(_ rule: RepeatRule, _ date: CivilDate) -> Position? {
        switch rule.every {
        case .day:
            return Position(date: date.adding(days: rule.interval), rule: rule)
        case .year:
            // Keeps the day where the month allows it (29 Feb -> 28 Feb), as the backend's addMonths.
            return Position(date: date.adding(years: rule.interval), rule: rule)
        case .week:
            guard let days = rule.weekdays?.sorted(), let firstDay = days.first else {
                return Position(date: date.adding(days: 7 * rule.interval), rule: rule)
            }
            let current = date.weekday
            if let later = days.first(where: { $0 > current }) {
                return Position(date: date.adding(days: later - current), rule: rule)
            }
            let monday = date.adding(days: -(current - 1))
            return Position(date: monday.adding(days: 7 * rule.interval + firstDay - 1), rule: rule)
        case .month:
            return monthStep(rule, date)
        }
    }

    private static func monthStep(_ rule: RepeatRule, _ date: CivilDate) -> Position? {
        if let day = rule.monthDay {
            let sameMonth = monthDayIn(date, day)
            let next = sameMonth > date ? sameMonth : monthDayIn(date.firstOfMonth.adding(months: rule.interval), day)
            return Position(date: next, rule: rule)
        }
        if let w = rule.weekdayOfMonth {
            let start = date.firstOfMonth
            var k = 0
            while k <= maxMonthSearch {
                if let found = nthWeekdayIn(start.adding(months: k), w.nth, w.weekday), found > date {
                    return Position(date: found, rule: rule)
                }
                k += rule.interval
            }
            return nil
        }
        let next = date.adding(months: rule.interval)
        var carried = rule
        if next.day < date.day { carried.monthDay = date.day }
        return Position(date: next, rule: carried)
    }

    /**
     * The next occurrence when a task of [rule] is completed on [today] (YYYY-MM-DD in the user's zone). Counted from
     * the due date, the first date of the series after today: a late completion skips the dates it missed, and they
     * count against `count`. Counted from completion (or without a due date), the first date after today. Nil when
     * the series has ended.
     */
    public static func advance(_ rule: RepeatRule, dueDate: String?, today: String) -> Next? {
        guard let day = CivilDate(today) else { return nil }
        let start = rule.fromCompletion ? day : (dueDate.flatMap(CivilDate.init) ?? day)
        var position = Position(date: start, rule: rule)
        var steps = 0
        repeat {
            guard let next = step(position.rule, position.date) else { return nil }
            position = next
            steps += 1
            if steps > maxSteps { return nil }
        } while position.date <= day
        if let until = rule.until, position.date.description > until { return nil }
        guard let count = rule.count else { return Next(dueDate: position.date.description, repeat: position.rule) }
        let left = count - steps
        guard left >= 1 else { return nil }
        var carried = position.rule
        carried.count = left
        return Next(dueDate: position.date.description, repeat: carried)
    }

    /**
     * Dates of a series whose first occurrence is [start], from [from] to [to] (both included), at most [limit]. A
     * rule counted from completion is shown as if each occurrence were done on its day.
     */
    public static func occurrences(_ rule: RepeatRule, start: String, from: String, to: String, limit: Int = 500) -> [String] {
        guard let first = CivilDate(from), let last = CivilDate(to), let startDate = CivilDate(start) else { return [] }
        var dates: [String] = []
        var position: Position? = Position(date: startDate, rule: rule)
        var left = rule.count ?? Int.max
        while let current = position, current.date <= last, dates.count < limit {
            if let until = rule.until, current.date.description > until { break }
            if current.date >= first { dates.append(current.date.description) }
            left -= 1
            if left < 1 { break }
            position = step(current.rule, current.date)
        }
        return dates
    }

    private static func mod(_ a: Int, _ n: Int) -> Int { ((a % n) + n) % n }
}
