import Foundation

/// A wall-clock moment in a zone: a day and an `HH:MM` time.
public struct LocalMoment: Hashable, Sendable {
    public let date: CivilDate
    public let time: ClockTime

    public init(date: CivilDate, time: ClockTime) {
        self.date = date
        self.time = time
    }
}

/**
 * Calendar dates are plain YYYY-MM-DD strings in the user's time zone, exactly as in `backend/convex/lib/dates.ts`
 * and the Android app's `HelmDates`. Everything that decides "today" or "overdue" goes through here. Instants are
 * Unix milliseconds, as the server sends them.
 */
public enum HelmDates {
    /// The backend's default when the user has not set a zone (`DEFAULT_SETTINGS.timezone`).
    public static let defaultTimezone = "Europe/London"

    static let dayMs: Int64 = 86_400_000

    public static func zone(_ timezone: String?) -> TimeZone {
        TimeZone(identifier: timezone ?? defaultTimezone) ?? TimeZone(identifier: defaultTimezone)!
    }

    public static func isTimezone(_ timezone: String) -> Bool { TimeZone(identifier: timezone) != nil }

    /// The wall clock in [timezone] at instant [epochMs], seconds dropped.
    public static func localAt(_ epochMs: Int64, _ timezone: String?) -> LocalMoment {
        let zone = zone(timezone)
        let seconds = floorDiv(epochMs, 1000)
        let offset = Int64(zone.secondsFromGMT(for: Date(timeIntervalSince1970: TimeInterval(seconds))))
        let local = seconds + offset
        let days = floorDiv(local, 86_400)
        let secondOfDay = local - days * 86_400
        return LocalMoment(
            date: CivilDate(dayNumber: Int(days)),
            time: ClockTime(hour: Int(secondOfDay / 3600), minute: Int(secondOfDay % 3600 / 60))!
        )
    }

    /// The calendar date at instant [epochMs] in [timezone] (backend `localDate`).
    public static func localDate(_ epochMs: Int64, _ timezone: String?) -> String {
        localAt(epochMs, timezone).date.description
    }

    public static func today(_ epochMs: Int64, _ timezone: String?) -> CivilDate { localAt(epochMs, timezone).date }

    /**
     * The instant of a wall-clock time, like Temporal's "compatible" choice and Java's `ZonedDateTime`: a time that
     * happens twice (clocks going back) is the earlier one; a time that does not exist (clocks going forward) moves
     * forward by the gap. The same as `instantOf` in `cli/src/when/calendar.ts`.
     */
    public static func instantOf(_ local: LocalMoment, _ timezone: String?) -> Int64 {
        let naive = naiveMs(local)
        let before = naive - offsetMs(naive - dayMs, timezone)
        let after = naive - offsetMs(naive + dayMs, timezone)
        let valid = [before, after].filter { localAt($0, timezone) == local }
        return valid.min() ?? before
    }

    public static func addDays(_ date: String, _ days: Int) -> String? {
        CivilDate(date)?.adding(days: days).description
    }

    /// Overdue = not done, still active, and due before today in the user's zone (backend `isOverdue`).
    public static func isOverdue(_ task: TaskItem, today: String) -> Bool {
        guard task.status != .done, task.archivedAt == nil, task.deletedAt == nil, let due = task.dueDate else { return false }
        return due < today
    }

    /// Unix ms of the next local midnight after [epochMs], when "today" changes.
    public static func nextMidnight(_ epochMs: Int64, _ timezone: String?) -> Int64 {
        let tomorrow = today(epochMs, timezone).adding(days: 1)
        return instantOf(LocalMoment(date: tomorrow, time: ClockTime(hour: 0, minute: 0)!), timezone)
    }

    static func naiveMs(_ local: LocalMoment) -> Int64 {
        Int64(local.date.dayNumber) * dayMs + Int64(local.time.minutesOfDay) * 60_000
    }

    static func offsetMs(_ epochMs: Int64, _ timezone: String?) -> Int64 {
        let date = Date(timeIntervalSince1970: TimeInterval(floorDiv(epochMs, 1000)))
        return Int64(zone(timezone).secondsFromGMT(for: date)) * 1000
    }

    static func floorDiv(_ a: Int64, _ b: Int64) -> Int64 {
        let q = a / b
        return (a % b != 0 && (a < 0) != (b < 0)) ? q - 1 : q
    }
}
