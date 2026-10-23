import Foundation

/// A day, and a time when the phrase named one.
public struct When: Hashable, Sendable {
    public let date: String
    public let time: String?
    /// The typed time does not exist that day (clocks go forward) and was moved forward to [time].
    public let shiftedFrom: String?

    public init(date: String, time: String? = nil, shiftedFrom: String? = nil) {
        self.date = date
        self.time = time
        self.shiftedFrom = shiftedFrom
    }
}

public struct WhenError: Error, Hashable, Sendable {
    public let message: String
}

/**
 * Dates in plain English, the grammar of `hlm` (`cli/src/when/parse.ts`), case for case: "tomorrow", "fri 2pm",
 * "next mon", "in 3 days", "23 oct", "2026-10-23". A small deterministic grammar (no NLP): the same phrase at the
 * same moment in the same time zone always gives the same day. English only, as in `hlm`.
 */
public enum WhenParser {
    /// Forms shown in help (`WHEN_EXAMPLES`).
    public static let examples = [
        "today", "tomorrow", "fri", "next mon", "this weekend", "in 3 days", "+2w", "in 2 hours", "eow", "eom", "23 oct",
        "oct 23 2027", "2026-10-23", "14:00", "2pm", "noon", "tomorrow at 9am", "fri 14:30",
    ]

    static let weekdays: [String: Int] = [
        "mon": 1, "monday": 1, "tue": 2, "tues": 2, "tuesday": 2, "wed": 3, "weds": 3, "wednesday": 3, "thu": 4,
        "thur": 4, "thurs": 4, "thursday": 4, "fri": 5, "friday": 5, "sat": 6, "saturday": 6, "sun": 7, "sunday": 7,
    ]
    static let months: [String: Int] = [
        "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4, "may": 5,
        "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
        "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
    ]
    static let numbers: [String: Int] = [
        "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
        "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    ]

    enum Unit { case minute, hour, day, week, month, year }

    static let units: [String: Unit] = [
        "min": .minute, "mins": .minute, "minute": .minute, "minutes": .minute, "h": .hour, "hr": .hour, "hrs": .hour,
        "hour": .hour, "hours": .hour, "d": .day, "day": .day, "days": .day, "w": .week, "wk": .week, "wks": .week,
        "week": .week, "weeks": .week, "mo": .month, "month": .month, "months": .month, "y": .year, "yr": .year,
        "yrs": .year, "year": .year, "years": .year,
    ]

    struct Ref {
        let now: Int64
        let timezone: String
        let today: CivilDate
        let time: ClockTime
    }

    struct Match<T> {
        let value: T
        let next: Int
    }

    public static func parse(_ text: String, now: Int64, timezone: String) throws -> When {
        let tokens = text.lowercased().replacingOccurrences(of: ",", with: " ")
            .split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard !tokens.isEmpty else { throw notUnderstood() }
        let local = HelmDates.localAt(now, timezone)
        let ref = Ref(now: now, timezone: timezone, today: local.date, time: local.time)

        if let instant = relativeInstant(tokens, ref) { return instant }

        if let date = try datePart(tokens, 0, ref) {
            if date.next == tokens.count { return When(date: date.value.description) }
            if let time = try timePart(tokens, date.next), time.next == tokens.count {
                return settle(date.value, time.value, ref.timezone)
            }
            throw notUnderstood()
        }
        guard let time = try timePart(tokens, 0) else { throw notUnderstood() }
        if time.next == tokens.count {
            // A time alone is the next time the clock shows it: today, or tomorrow once it has passed.
            let day = time.value > ref.time ? ref.today : ref.today.adding(days: 1)
            return settle(day, time.value, ref.timezone)
        }
        let start = tokens[time.next] == "on" ? time.next + 1 : time.next
        if let after = try datePart(tokens, start, ref), after.next == tokens.count {
            return settle(after.value, time.value, ref.timezone)
        }
        throw notUnderstood()
    }

    static func notUnderstood() -> WhenError {
        WhenError(message: "Not a date Dayhand understands; try e.g. tomorrow, fri 14:00, next mon, in 3 days, 23 oct, 2026-10-23")
    }

    static func noSuchDay() -> WhenError { WhenError(message: "That day does not exist in the calendar") }

    /// A wall-clock time that does not exist (clocks going forward) moves forward by the gap.
    static func settle(_ date: CivilDate, _ time: ClockTime, _ timezone: String) -> When {
        let wanted = LocalMoment(date: date, time: time)
        let real = HelmDates.localAt(HelmDates.instantOf(wanted, timezone), timezone)
        if real == wanted { return When(date: date.description, time: time.description) }
        return When(date: real.date.description, time: real.time.description, shiftedFrom: time.description)
    }

    static func count(_ word: String?) -> Int? {
        guard let word else { return nil }
        if word.count <= 3, !word.isEmpty, word.allSatisfy({ $0.isASCII && $0.isNumber }) { return Int(word) }
        return numbers[word]
    }

    /// "in 2 hours", "in 30 min", "+3h": a moment, so both a day and a time.
    static func relativeInstant(_ tokens: [String], _ ref: Ref) -> When? {
        var amount: Int?
        var unit: Unit?
        if tokens.count == 1, let short = capture(#"^\+(\d{1,3})(h|min)$"#, tokens[0]) {
            amount = Int(short[0])
            unit = units[short[1]]
        } else if tokens.count == 3, tokens[0] == "in" {
            amount = count(tokens[1])
            unit = units[tokens[2]]
        }
        guard let amount, let unit, unit == .hour || unit == .minute else { return nil }
        let at = HelmDates.localAt(ref.now + Int64(amount) * (unit == .hour ? 3_600_000 : 60_000), ref.timezone)
        return When(date: at.date.description, time: at.time.description)
    }

    static func shift(_ date: CivilDate, _ amount: Int, _ unit: Unit) -> CivilDate {
        switch unit {
        case .day: return date.adding(days: amount)
        case .week: return date.adding(days: amount * 7)
        case .month: return date.adding(months: amount)
        default: return date.adding(months: amount * 12)
        }
    }

    /// First day on or after [from] with this ISO weekday.
    static func onOrAfter(_ from: CivilDate, _ weekday: Int) -> CivilDate {
        from.adding(days: (weekday - from.weekday + 7) % 7)
    }

    static func nextWeekMonday(_ today: CivilDate) -> CivilDate { today.adding(days: 8 - today.weekday) }

    /// Saturday on or after today; on a Sunday, today.
    static func weekend(_ today: CivilDate) -> CivilDate { today.weekday == 7 ? today : onOrAfter(today, 6) }

    static func endOfMonth(_ today: CivilDate) -> CivilDate { today.lastOfMonth }

    static func endOfYear(_ today: CivilDate) -> CivilDate { CivilDate(year: today.year, month: 12, day: 31)! }

    static func datePart(_ tokens: [String], _ start: Int, _ ref: Ref) throws -> Match<CivilDate>? {
        var i = start
        if i < tokens.count, tokens[i] == "on" { i += 1 }
        guard i < tokens.count else { return nil }
        let word = tokens[i]
        let one = { (value: CivilDate) in Match(value: value, next: i + 1) }
        let two = { (value: CivilDate) in Match(value: value, next: i + 2) }

        switch word {
        case "today", "tod": return one(ref.today)
        case "tomorrow", "tmr", "tmrw": return one(ref.today.adding(days: 1))
        case "yesterday": return one(ref.today.adding(days: -1))
        case "weekend": return one(weekend(ref.today))
        case "eow": return one(onOrAfter(ref.today, 7))
        case "eoww": return one(onOrAfter(ref.today, 5))
        case "eom": return one(endOfMonth(ref.today))
        case "eoy": return one(endOfYear(ref.today))
        default: break
        }
        if let weekday = weekdays[word] {
            return one(ref.today.adding(days: ((weekday - ref.today.weekday + 6) % 7) + 1))
        }
        if let iso = capture(#"^(\d{4})-(\d{2})-(\d{2})$"#, word) {
            return one(try realDate(Int(iso[0])!, Int(iso[1])!, Int(iso[2])!))
        }
        if let plus = capture(#"^\+(\d{1,3})(d|w|mo|y)$"#, word), let unit = units[plus[1]] {
            return one(shift(ref.today, Int(plus[0])!, unit))
        }

        let following = i + 1 < tokens.count ? tokens[i + 1] : nil
        let followingDay = following.flatMap { weekdays[$0] }
        if word == "this", following != nil {
            if let followingDay { return two(onOrAfter(ref.today, followingDay)) }
            if following == "weekend" { return two(weekend(ref.today)) }
        }
        if word == "next", let following {
            let monday = nextWeekMonday(ref.today)
            if let followingDay { return two(monday.adding(days: followingDay - 1)) }
            switch following {
            case "week": return two(monday)
            case "weekend": return two(monday.adding(days: 5))
            case "month": return two(ref.today.adding(months: 1).firstOfMonth)
            case "year": return two(CivilDate(year: ref.today.year + 1, month: 1, day: 1)!)
            default: break
            }
        }
        if word == "in", following != nil {
            let unitWord = i + 2 < tokens.count ? tokens[i + 2] : nil
            if let amount = count(following), let unit = unitWord.flatMap({ units[$0] }), unit != .hour, unit != .minute {
                return Match(value: shift(ref.today, amount, unit), next: i + 3)
            }
        }
        if let phrase = phraseDate(tokens, i, ref) { return phrase }
        return try dayMonth(tokens, i, ref)
    }

    /// "end of week/work week/month/year", "day after tomorrow".
    static func phraseDate(_ tokens: [String], _ i: Int, _ ref: Ref) -> Match<CivilDate>? {
        let rest = tokens[i...].joined(separator: " ")
        let phrases: [(String, () -> CivilDate)] = [
            (#"^(the )?day after tomorrow\b"#, { ref.today.adding(days: 2) }),
            (#"^end of (the )?work week\b"#, { onOrAfter(ref.today, 5) }),
            (#"^end of (the )?week\b"#, { onOrAfter(ref.today, 7) }),
            (#"^end of (the )?month\b"#, { endOfMonth(ref.today) }),
            (#"^end of (the )?year\b"#, { endOfYear(ref.today) }),
        ]
        for (pattern, resolve) in phrases {
            if let range = rest.range(of: pattern, options: .regularExpression) {
                let words = rest[range].split(separator: " ").count
                return Match(value: resolve(), next: i + words)
            }
        }
        return nil
    }

    /// "23 oct", "23rd of october 2027", "oct 23", "the 15th".
    static func dayMonth(_ tokens: [String], _ start: Int, _ ref: Ref) throws -> Match<CivilDate>? {
        var i = start
        let at = { (index: Int) -> String? in index < tokens.count ? tokens[index] : nil }
        if at(i) == "the" { i += 1 }
        let day = { (word: String?) -> [String]? in word.flatMap { capture(#"^(\d{1,2})(st|nd|rd|th)?$"#, $0) } }
        let year = { (word: String?) -> Int? in
            guard let word, word.count == 4, word.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
            return Int(word)
        }

        if let first = day(at(i)) {
            var j = i + 1
            if at(j) == "of" { j += 1 }
            if let month = at(j).flatMap({ months[$0] }) {
                let y = year(at(j + 1))
                return Match(value: try dated(Int(first[0])!, month, y, ref), next: y == nil ? j + 1 : j + 2)
            }
            // "the 15th": the next 15th of a month, this month included.
            if !first[1].isEmpty { return Match(value: try nextDayOfMonth(Int(first[0])!, ref.today), next: i + 1) }
            return nil
        }
        if let month = at(i).flatMap({ months[$0] }), let second = day(at(i + 1)) {
            let y = year(at(i + 2))
            return Match(value: try dated(Int(second[0])!, month, y, ref), next: y == nil ? i + 2 : i + 3)
        }
        return nil
    }

    static func realDate(_ year: Int, _ month: Int, _ day: Int) throws -> CivilDate {
        guard let date = CivilDate(year: year, month: month, day: day) else { throw noSuchDay() }
        return date
    }

    /// With a year, exactly that day; without, its next occurrence (today included).
    static func dated(_ day: Int, _ month: Int, _ year: Int?, _ ref: Ref) throws -> CivilDate {
        if let year { return try realDate(year, month, day) }
        for y in ref.today.year..<(ref.today.year + 9) {
            if let date = CivilDate(year: y, month: month, day: day), date >= ref.today { return date }
        }
        throw noSuchDay()
    }

    static func nextDayOfMonth(_ day: Int, _ today: CivilDate) throws -> CivilDate {
        guard (1...31).contains(day) else { throw noSuchDay() }
        for m in 0..<13 {
            let month = today.firstOfMonth.adding(months: m)
            if day <= month.lengthOfMonth {
                let candidate = month.withDay(day)
                if candidate >= today { return candidate }
            }
        }
        throw noSuchDay()
    }

    /// "14:00", "9:30am", "2pm", "2 pm", "at 9", "noon", "midnight" (24h unless am/pm).
    static func timePart(_ tokens: [String], _ start: Int) throws -> Match<ClockTime>? {
        var i = start
        let isAt = i < tokens.count && tokens[i] == "at"
        if isAt { i += 1 }
        guard i < tokens.count else { return nil }
        let word = tokens[i]
        if word == "noon" { return Match(value: ClockTime(hour: 12, minute: 0)!, next: i + 1) }
        if word == "midnight" { return Match(value: ClockTime(hour: 0, minute: 0)!, next: i + 1) }

        guard let found = capture(#"^(\d{1,2})(?::(\d{2}))?(am|pm)?$"#, word) else { return nil }
        var meridiem = found[2]
        var next = i + 1
        if meridiem.isEmpty, next < tokens.count, tokens[next] == "am" || tokens[next] == "pm" {
            meridiem = tokens[next]
            next += 1
        }
        // A bare number is a time only after "at" ("at 9"); "9" alone is not a date or a time.
        if meridiem.isEmpty, found[1].isEmpty, !isAt { return nil }

        var hour = Int(found[0])!
        let minute = found[1].isEmpty ? 0 : Int(found[1])!
        if minute > 59 { throw WhenError(message: "Minutes must be 00 to 59") }
        if !meridiem.isEmpty {
            guard (1...12).contains(hour) else { throw WhenError(message: "With am or pm the hour must be 1 to 12") }
            hour = hour % 12 + (meridiem == "pm" ? 12 : 0)
        } else if hour > 23 {
            throw WhenError(message: "The hour must be 0 to 23")
        }
        return Match(value: ClockTime(hour: hour, minute: minute)!, next: next)
    }

    /// The capture groups of [pattern] in the whole of [text] ("" for a group that did not take part), or nil.
    static func capture(_ pattern: String, _ text: String) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        return (1..<match.numberOfRanges).map { index in
            Range(match.range(at: index), in: text).map { String(text[$0]) } ?? ""
        }
    }

    /// For the day column: "today", "tomorrow", "in 3 days", "2 days ago".
    public static func relativeDay(_ date: String, today: String) -> String {
        guard let d = CivilDate(date), let t = CivilDate(today) else { return date }
        let days = t.days(until: d)
        switch days {
        case 0: return "today"
        case 1: return "tomorrow"
        case -1: return "yesterday"
        default: return days > 0 ? "in \(days) days" : "\(-days) days ago"
        }
    }
}
