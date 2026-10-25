import Foundation

/// Days, times and weekday names in the current language, in the style of the Mac's region.
public enum DateText {
    /// "Fri 23 Oct" ("ven. 23 oct.", "10月23日(金)") for a civil date "YYYY-MM-DD", with the year when asked; nil when
    /// `date` is not one.
    public static func day(_ date: String, withYear: Bool) -> String? {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, let instant = utcCalendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return nil }
        return formatter(withYear ? "EEEdMMMyyyy" : "EEEdMMM").string(from: instant)
    }

    /// "Sunday, 25 October 2026" ("niedziela, 25 października 2026", "2026年10月25日 日曜日") for a civil date
    /// "YYYY-MM-DD"; the date as it is when it is not one.
    public static func longDay(_ date: String) -> String {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, let instant = utcCalendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return date }
        return formatter("EEEEdMMMMyyyy").string(from: instant)
    }

    /// "26 October" ("26 października", "10月26日") for a civil date "YYYY-MM-DD"; the date as it is when it is not one.
    public static func dayAndMonth(_ date: String) -> String {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, let instant = utcCalendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return date }
        return formatter("dMMMM").string(from: instant)
    }

    /// A wall-clock time "HH:mm" as the region writes it: "14:00", or "2:00 PM" where clocks have 12 hours. Anything
    /// else is returned as it is.
    public static func time(_ time: String) -> String {
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, let instant = utcCalendar.date(from: DateComponents(year: 2000, month: 1, day: 1, hour: parts[0], minute: parts[1])) else {
            return time
        }
        return formatter("jmm").string(from: instant)
    }

    /// The short name of an ISO weekday (1 Monday … 7 Sunday): "Mon", "pon.", "月".
    public static func shortWeekday(_ isoWeekday: Int) -> String? {
        guard (1...7).contains(isoWeekday) else { return nil }
        let symbols = formatter("EEE").shortStandaloneWeekdaySymbols ?? []
        // The formatter's symbols start on Sunday.
        return symbols.count == 7 ? symbols[isoWeekday % 7] : nil
    }

    /// Between the items of a short list such as weekdays: ", ", or "、" in Japanese and Chinese.
    public static var listSeparator: String {
        ["ja", "zh-Hans"].contains(Localization.current.language) ? "、" : ", "
    }

    private static let utcCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    private static func formatter(_ template: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = utcCalendar
        formatter.timeZone = utcCalendar.timeZone
        formatter.locale = Localization.current.locale
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter
    }
}
