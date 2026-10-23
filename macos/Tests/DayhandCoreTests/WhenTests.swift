import Testing
@testable import DayhandCore

/// The date grammar, case for case with `cli/tests/when.unit.test.ts`: fixed reference moments in Europe/London,
/// including both weeks the clocks change (last Sunday of March and of October).
struct WhenTests {
    static let london = "Europe/London"

    static func when(_ text: String, _ now: Int64, _ timezone: String = london) throws -> String {
        let found = try WhenParser.parse(text, now: now, timezone: timezone)
        return [found.date, found.time, found.shiftedFrom].compactMap { $0 }.joined(separator: " ")
    }

    /// Thursday 22 October 2026, 10:00 BST.
    static let thu = utc("2026-10-22T09:00")

    static let phrases: [(String, String)] = [
        ("today", "2026-10-22"), ("tod", "2026-10-22"), ("Today", "2026-10-22"), ("tomorrow", "2026-10-23"),
        ("tmr", "2026-10-23"), ("tmrw", "2026-10-23"), ("yesterday", "2026-10-21"), ("day after tomorrow", "2026-10-24"),
        ("the day after tomorrow", "2026-10-24"), ("fri", "2026-10-23"), ("Friday", "2026-10-23"), ("thu", "2026-10-29"),
        ("on monday", "2026-10-26"), ("this thu", "2026-10-22"), ("this sun", "2026-10-25"), ("next mon", "2026-10-26"),
        ("next thu", "2026-10-29"), ("next fri", "2026-10-30"), ("next sun", "2026-11-01"), ("next week", "2026-10-26"),
        ("next month", "2026-11-01"), ("next year", "2027-01-01"), ("weekend", "2026-10-24"), ("this weekend", "2026-10-24"),
        ("next weekend", "2026-10-31"), ("eow", "2026-10-25"), ("end of week", "2026-10-25"), ("end of the week", "2026-10-25"),
        ("eoww", "2026-10-23"), ("end of work week", "2026-10-23"), ("eom", "2026-10-31"), ("end of month", "2026-10-31"),
        ("eoy", "2026-12-31"), ("end of year", "2026-12-31"), ("in 3 days", "2026-10-25"), ("in a week", "2026-10-29"),
        ("in 2 weeks", "2026-11-05"), ("in one month", "2026-11-22"), ("in 1 year", "2027-10-22"), ("+3d", "2026-10-25"),
        ("+2w", "2026-11-05"), ("+1mo", "2026-11-22"), ("+1y", "2027-10-22"), ("23 oct", "2026-10-23"),
        ("22 oct", "2026-10-22"), ("21 oct", "2027-10-21"), ("23rd october", "2026-10-23"),
        ("the 23rd of october", "2026-10-23"), ("oct 23", "2026-10-23"), ("october 23rd 2027", "2027-10-23"),
        ("Oct 23, 2027", "2027-10-23"), ("1 jan", "2027-01-01"), ("29 feb", "2028-02-29"), ("the 15th", "2026-11-15"),
        ("22nd", "2026-10-22"), ("2026-10-23", "2026-10-23"), ("14:00", "2026-10-22 14:00"), ("9:30", "2026-10-23 09:30"),
        ("2pm", "2026-10-22 14:00"), ("2 pm", "2026-10-22 14:00"), ("9am", "2026-10-23 09:00"), ("at 9", "2026-10-23 09:00"),
        ("at 10", "2026-10-23 10:00"), ("noon", "2026-10-22 12:00"), ("midnight", "2026-10-23 00:00"),
        ("12am", "2026-10-23 00:00"), ("12pm", "2026-10-22 12:00"), ("tomorrow at 9am", "2026-10-23 09:00"),
        ("fri 14:30", "2026-10-23 14:30"), ("at 3pm on friday", "2026-10-23 15:00"), ("9am tomorrow", "2026-10-23 09:00"),
        ("next mon at noon", "2026-10-26 12:00"), ("in 3 days at 8:15", "2026-10-25 08:15"),
        ("23 oct 9:30pm", "2026-10-23 21:30"), ("in 2 hours", "2026-10-22 12:00"), ("in 30 min", "2026-10-22 10:30"),
        ("+3h", "2026-10-22 13:00"), ("in 15 hours", "2026-10-23 01:00"),
    ]

    @Test(arguments: phrases)
    func phraseOnThursday22October(text: String, expected: String) throws {
        #expect(try Self.when(text, Self.thu) == expected)
    }

    @Test(arguments: [
        "", "someday", "9", "25:00", "13pm", "14:75", "constructor", "next", "in 3 parsecs", "31 feb 2026", "fri fri",
        "tomorrow 9", "2026-02-29", "+1m",
    ])
    func rejectedNotGuessed(text: String) {
        #expect(throws: WhenError.self) { try WhenParser.parse(text, now: Self.thu, timezone: Self.london) }
    }

    @Test func theErrorDoesNotRepeatThePhrase() {
        do {
            _ = try WhenParser.parse("secret-ish words", now: Self.thu, timezone: Self.london)
            Issue.record("expected an error")
        } catch let error as WhenError {
            #expect(error.message.hasPrefix("Not a date Dayhand understands; try e.g. tomorrow"))
            #expect(!error.message.contains("secret"))
        } catch {
            Issue.record("unexpected \(error)")
        }
    }

    // The week the clocks go back (Sunday 25 October 2026, 02:00 BST → 01:00 GMT).

    @Test(arguments: [
        ("today", "2026-10-24"), ("tomorrow", "2026-10-25"), ("sun", "2026-10-25"), ("eow", "2026-10-25"),
        ("in 1 hour", "2026-10-25 00:30"), ("in 2 hours", "2026-10-25 01:30"), ("in 3 hours", "2026-10-25 01:30"),
        ("in 4 hours", "2026-10-25 02:30"), ("1:30am", "2026-10-25 01:30"), ("tomorrow 1:30am", "2026-10-25 01:30"),
        ("in 1 day", "2026-10-25"),
    ])
    func autumnSaturdayLate(text: String, expected: String) throws {
        #expect(try Self.when(text, utc("2026-10-24T22:30")) == expected)
    }

    @Test(arguments: [
        ("today", "2026-10-25"), ("in 1 hour", "2026-10-25 01:30"), ("in 2 hours", "2026-10-25 01:30"),
        ("2am", "2026-10-25 02:00"), ("tomorrow", "2026-10-26"),
    ])
    func autumnSundayEarly(text: String, expected: String) throws {
        #expect(try Self.when(text, utc("2026-10-24T23:30")) == expected)
    }

    @Test func half_past_one_happens_twice_and_the_earlier_one_is_meant() {
        let local = LocalMoment(date: day("2026-10-25"), time: ClockTime("01:30")!)
        #expect(HelmDates.instantOf(local, Self.london) == utc("2026-10-25T00:30"))
    }

    // The week the clocks go forward (Sunday 29 March 2026, 01:00 GMT → 02:00 BST).

    @Test(arguments: [
        ("tomorrow", "2026-03-29"), ("eow", "2026-03-29"), ("in 1 hour", "2026-03-29 00:30"),
        ("in 90 min", "2026-03-29 02:00"), ("in 2 hours", "2026-03-29 02:30"), ("tomorrow 2:30am", "2026-03-29 02:30"),
        ("tomorrow 1:30am", "2026-03-29 02:30 01:30"), ("1:30am", "2026-03-29 02:30 01:30"), ("next mon", "2026-03-30"),
    ])
    func springSaturdayLate(text: String, expected: String) throws {
        #expect(try Self.when(text, utc("2026-03-28T23:30")) == expected)
    }

    @Test(arguments: [
        ("today", "2026-03-29"), ("today 01:15", "2026-03-29 02:15 01:15"), ("in 1 hour", "2026-03-29 02:30"),
        ("3am", "2026-03-29 03:00"),
    ])
    func springSundayEarly(text: String, expected: String) throws {
        #expect(try Self.when(text, utc("2026-03-29T00:30")) == expected)
    }

    @Test func theUsersZoneDecidesNotTheComputersOrUTC() throws {
        let late = utc("2026-10-22T23:30")
        #expect(try Self.when("today", late) == "2026-10-23")
        #expect(try Self.when("fri", late) == "2026-10-30")
        #expect(try Self.when("today", utc("2026-10-22T09:00"), "America/New_York") == "2026-10-22")
        #expect(try Self.when("in 2 hours", utc("2026-10-22T09:00"), "America/New_York") == "2026-10-22 07:00")
        #expect(try Self.when("tomorrow", utc("2026-10-22T11:30"), "Pacific/Auckland") == "2026-10-24")
        #expect(try Self.when("in 3 hours", utc("2026-10-22T09:00"), "Pacific/Auckland") == "2026-10-23 01:00")
    }

    @Test func monthsClampToTheLastDay() {
        #expect(day("2026-01-31").adding(months: 1) == day("2026-02-28"))
        #expect(day("2028-01-31").adding(months: 1) == day("2028-02-29"))
        #expect(day("2026-12-15").adding(months: 1) == day("2027-01-15"))
        #expect(day("2026-03-31").adding(months: -1) == day("2026-02-28"))
    }

    @Test func localWallClockAndRelativeDayWords() {
        #expect(HelmDates.localAt(utc("2026-07-01T12:00"), Self.london) == LocalMoment(date: day("2026-07-01"), time: ClockTime("13:00")!))
        #expect(WhenParser.relativeDay("2026-10-22", today: "2026-10-22") == "today")
        #expect(WhenParser.relativeDay("2026-10-23", today: "2026-10-22") == "tomorrow")
        #expect(WhenParser.relativeDay("2026-10-21", today: "2026-10-22") == "yesterday")
        #expect(WhenParser.relativeDay("2026-10-27", today: "2026-10-22") == "in 5 days")
        #expect(WhenParser.relativeDay("2026-10-19", today: "2026-10-22") == "3 days ago")
        #expect(WhenParser.relativeDay("2026-03-30", today: "2026-03-28") == "in 2 days")
    }
}

/// Quick add: the title, and a date phrase read from the end of the line.
struct QuickAddTests {
    let thu = utc("2026-10-22T09:00")

    func parse(_ line: String) -> QuickAddInput { QuickAdd.parse(line, now: thu, timezone: "Europe/London") }

    @Test func aPhraseAtTheEndIsTheDayAndTime() {
        let input = parse("Call the accountant fri 2pm")
        #expect(input.title == "Call the accountant")
        #expect(input.when == When(date: "2026-10-23", time: "14:00"))
        #expect(input.phrase == "fri 2pm")
    }

    @Test func theLongestWholePhraseWins() {
        #expect(parse("Buy milk tomorrow at 9am").when == When(date: "2026-10-23", time: "09:00"))
        #expect(parse("Buy milk tomorrow at 9am").title == "Buy milk")
        #expect(parse("Plan next week").title == "Plan")
        #expect(parse("Plan next week").when?.date == "2026-10-26")
        #expect(parse("Release v2 on oct 23").title == "Release v2")
        #expect(parse("Pay rent the 1st").when?.date == "2026-11-01")
    }

    @Test func withoutAPhraseTheLineIsTheTitle() {
        #expect(parse("Buy 2 apples") == QuickAddInput(title: "Buy 2 apples", when: nil, phrase: nil))
        #expect(parse("Read chapter 9").when == nil)
        #expect(parse("  Water the plants  ").title == "Water the plants")
    }

    @Test func aLineThatIsOnlyADateStaysATitle() {
        #expect(parse("tomorrow") == QuickAddInput(title: "tomorrow", when: nil, phrase: nil))
    }

    @Test func aDayTheCalendarLacksIsNotRead() {
        #expect(parse("Pay 31 feb").when == nil)
        #expect(parse("Pay 31 feb").title == "Pay 31 feb")
    }
}
