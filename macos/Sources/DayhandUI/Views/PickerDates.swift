import DayhandCore
import Foundation

/**
 * Plain calendar days and clock times as the `Date` values SwiftUI's pickers take. The pickers are shown in UTC
 * (`.environment(\.timeZone, PickerDates.zone)`), so a day or a time never moves with the Mac's zone or a clock change.
 */
enum PickerDates {
    static let zone = TimeZone(identifier: "UTC") ?? .current

    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar
    }()

    /// Midnight UTC of a YYYY-MM-DD day; the Unix epoch for anything else.
    static func date(_ day: String) -> Date {
        guard let civil = CivilDate(day) else { return Date(timeIntervalSince1970: 0) }
        return Date(timeIntervalSince1970: TimeInterval(civil.dayNumber) * 86_400)
    }

    static func day(_ date: Date) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return CivilDate(year: parts.year ?? 1970, month: parts.month ?? 1, day: parts.day ?? 1)?.description ?? "1970-01-01"
    }

    /// An HH:MM time on the first day of the epoch, UTC.
    static func time(_ hhmm: String) -> Date {
        let minutes = ClockTime(hhmm)?.minutesOfDay ?? 9 * 60
        return Date(timeIntervalSince1970: TimeInterval(minutes * 60))
    }

    static func hhmm(_ date: Date) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return ClockTime(hour: parts.hour ?? 0, minute: parts.minute ?? 0)?.description ?? "00:00"
    }
}
