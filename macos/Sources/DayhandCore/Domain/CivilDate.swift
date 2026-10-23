import Foundation

/**
 * A calendar day with no time zone, the YYYY-MM-DD of the backend (`convex/lib/dates.ts`). Adding days or months
 * never shifts by an hour; only instants go through a zone (`HelmDates`). The arithmetic is Howard Hinnant's
 * days-from-civil, so it does not depend on the machine's calendar or locale.
 */
public struct CivilDate: Hashable, Comparable, Sendable, CustomStringConvertible {
    public let year: Int
    public let month: Int
    public let day: Int

    /// A real day of the Gregorian calendar, or nil (30 Feb, month 13).
    public init?(year: Int, month: Int, day: Int) {
        guard (1...12).contains(month), day >= 1, day <= CivilDate.daysIn(year: year, month: month) else { return nil }
        self.year = year
        self.month = month
        self.day = day
    }

    /// Exactly `YYYY-MM-DD` naming a real day, or nil.
    public init?(_ iso: String) {
        let parts = iso.split(separator: "-", omittingEmptySubsequences: false)
        guard iso.count == 10, parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              parts.allSatisfy({ $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) }),
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]) else { return nil }
        self.init(year: y, month: m, day: d)
    }

    /// The day [dayNumber] days after 1970-01-01.
    public init(dayNumber: Int) {
        let z = dayNumber + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        year = yoe + era * 400 + (m <= 2 ? 1 : 0)
        month = m
        day = d
    }

    /// Days since 1970-01-01.
    public var dayNumber: Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (month > 2 ? month - 3 : month + 9) + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    public var description: String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    /// ISO weekday: Monday = 1 … Sunday = 7 (1970-01-01 was a Thursday).
    public var weekday: Int { ((dayNumber % 7) + 7 + 3) % 7 + 1 }

    public var lengthOfMonth: Int { CivilDate.daysIn(year: year, month: month) }

    public var firstOfMonth: CivilDate { CivilDate(uncheckedYear: year, month: month, day: 1) }

    public var lastOfMonth: CivilDate { CivilDate(uncheckedYear: year, month: month, day: lengthOfMonth) }

    public func adding(days: Int) -> CivilDate { CivilDate(dayNumber: dayNumber + days) }

    /// Same day of the month, clamped to the target month's last day (31 Jan + 1 month = 28 Feb), as `plusMonths`.
    public func adding(months: Int) -> CivilDate {
        let index = year * 12 + (month - 1) + months
        let y = index >= 0 ? index / 12 : (index - 11) / 12
        let m = index - y * 12 + 1
        return CivilDate(uncheckedYear: y, month: m, day: min(day, CivilDate.daysIn(year: y, month: m)))
    }

    public func adding(years: Int) -> CivilDate { adding(months: 12 * years) }

    /// This month's [day], which must exist.
    public func withDay(_ day: Int) -> CivilDate { CivilDate(uncheckedYear: year, month: month, day: day) }

    public func days(until other: CivilDate) -> Int { other.dayNumber - dayNumber }

    public static func < (a: CivilDate, b: CivilDate) -> Bool { a.dayNumber < b.dayNumber }

    public static func daysIn(year: Int, month: Int) -> Int {
        switch month {
        case 2: return isLeap(year) ? 29 : 28
        case 4, 6, 9, 11: return 30
        default: return 31
        }
    }

    public static func isLeap(_ year: Int) -> Bool { (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 }

    private init(uncheckedYear: Int, month: Int, day: Int) {
        year = uncheckedYear
        self.month = month
        self.day = day
    }
}

/// A wall-clock time `HH:MM` (00:00 to 23:59).
public struct ClockTime: Hashable, Comparable, Sendable, CustomStringConvertible {
    public let hour: Int
    public let minute: Int

    public init?(hour: Int, minute: Int) {
        guard (0...23).contains(hour), (0...59).contains(minute) else { return nil }
        self.hour = hour
        self.minute = minute
    }

    /// Exactly `HH:MM`, or nil.
    public init?(_ text: String) {
        let parts = text.split(separator: ":", omittingEmptySubsequences: false)
        guard text.count == 5, parts.count == 2, parts.allSatisfy({ $0.count == 2 && $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) }),
              let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
        self.init(hour: h, minute: m)
    }

    public var minutesOfDay: Int { hour * 60 + minute }

    public var description: String { String(format: "%02d:%02d", hour, minute) }

    public static func < (a: ClockTime, b: ClockTime) -> Bool { a.minutesOfDay < b.minutesOfDay }
}
