import Testing
@testable import DayhandCore

/// The same cases as `backend/tests/repeat.test.ts` and the Android app's `RecurrenceTest.kt`: all three clients must
/// agree on every date a series falls on. Month ends, leap years, nth weekdays, counting from completion, until/count
/// and London's clock changes.
struct RecurrenceTests {
    let year = ("2026-01-01", "2031-12-31")

    func monthly(monthDay: Int? = nil, nth: WeekdayOfMonth? = nil, interval: Int = 1, from: RepeatFrom? = nil, until: String? = nil) -> RepeatRule {
        RepeatRule(every: .month, interval: interval, from: from, monthDay: monthDay, weekdayOfMonth: nth, until: until)
    }

    func daily(_ interval: Int = 1, count: Int? = nil, until: String? = nil, from: RepeatFrom? = nil) -> RepeatRule {
        RepeatRule(every: .day, interval: interval, from: from, until: until, count: count)
    }

    func list(_ rule: RepeatRule, _ start: String, _ limit: Int = 500, range: (String, String)? = nil) -> [String] {
        let (from, to) = range ?? year
        return Recurrence.occurrences(rule, start: start, from: from, to: to, limit: limit)
    }

    /// Completes each occurrence on its own day, [n] times, and returns the due dates.
    func completeOnTime(_ rule: RepeatRule, _ start: String, _ n: Int) -> [String] {
        var dates = [start]
        var current = Recurrence.Next(dueDate: start, repeat: rule)
        while dates.count < n {
            guard let next = Recurrence.advance(current.repeat, dueDate: current.dueDate, today: current.dueDate) else { break }
            current = next
            dates.append(current.dueDate)
        }
        return dates
    }

    @Test func lastDayOfTheMonth() throws {
        #expect(list(monthly(monthDay: -1), "2026-01-31", 4) == ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"])
        let feb = try #require(Recurrence.advance(monthly(monthDay: -1), dueDate: "2026-01-31", today: "2026-01-31"))
        #expect(feb.dueDate == "2026-02-28")
        #expect(Recurrence.advance(feb.repeat, dueDate: feb.dueDate, today: feb.dueDate)?.dueDate == "2026-03-31")
    }

    @Test func day31FallsOnAShorterMonthsLastDayAndComesBack() {
        #expect(list(monthly(monthDay: 31), "2026-01-31", 4) == ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"])
    }

    @Test func plainMonthlyKeeps29To31AfterAShorterMonthAndLeavesThe15thAlone() throws {
        let feb = try #require(Recurrence.advance(monthly(), dueDate: "2026-01-31", today: "2026-01-31"))
        #expect(feb == Recurrence.Next(dueDate: "2026-02-28", repeat: monthly(monthDay: 31)))
        #expect(Recurrence.advance(feb.repeat, dueDate: feb.dueDate, today: feb.dueDate)?.dueDate == "2026-03-31")
        #expect(completeOnTime(monthly(), "2026-01-30", 4) == ["2026-01-30", "2026-02-28", "2026-03-30", "2026-04-30"])
        #expect(Recurrence.advance(monthly(), dueDate: "2026-01-15", today: "2026-01-15") == Recurrence.Next(dueDate: "2026-02-15", repeat: monthly()))
    }

    @Test func aMonthDayLaterInTheSameMonthComesFirst() {
        #expect(Recurrence.advance(monthly(monthDay: -1), dueDate: "2026-01-10", today: "2026-01-10")?.dueDate == "2026-01-31")
    }

    @Test func monthDayInAndNthWeekdayIn() {
        #expect(Recurrence.monthDayIn(day("2026-02-01"), 30) == day("2026-02-28"))
        #expect(Recurrence.monthDayIn(day("2026-04-01"), -1) == day("2026-04-30"))
        #expect(Recurrence.nthWeekdayIn(day("2026-10-01"), 2, 2) == day("2026-10-13"))
        #expect(Recurrence.nthWeekdayIn(day("2026-10-01"), -1, 5) == day("2026-10-30"))
        #expect(Recurrence.nthWeekdayIn(day("2026-02-01"), 5, 1) == nil)
        #expect(Recurrence.nthWeekdayIn(day("2026-03-01"), 5, 1) == day("2026-03-30"))
    }

    @Test func leapYears() {
        #expect(list(monthly(monthDay: 29), "2028-01-29", 3) == ["2028-01-29", "2028-02-29", "2028-03-29"])
        #expect(list(monthly(monthDay: 29), "2027-01-29", 3) == ["2027-01-29", "2027-02-28", "2027-03-29"])
        #expect(list(monthly(monthDay: -1), "2028-01-31", 2) == ["2028-01-31", "2028-02-29"])
        #expect(list(monthly(monthDay: -1), "2029-01-31", 2) == ["2029-01-31", "2029-02-28"])
        #expect(Recurrence.advance(RepeatRule(every: .year), dueDate: "2028-02-29", today: "2028-02-29")?.dueDate == "2029-02-28")
        #expect(Recurrence.advance(RepeatRule(every: .year, interval: 4), dueDate: "2028-02-29", today: "2028-02-29")?.dueDate == "2032-02-29")
        #expect(list(daily(), "2028-02-28", 3) == ["2028-02-28", "2028-02-29", "2028-03-01"])
    }

    @Test func nthWeekdayOfTheMonth() {
        let secondTuesday = monthly(nth: WeekdayOfMonth(nth: 2, weekday: 2))
        #expect(list(secondTuesday, "2026-10-13", 4) == ["2026-10-13", "2026-11-10", "2026-12-08", "2027-01-12"])
        let lastFriday = monthly(nth: WeekdayOfMonth(nth: -1, weekday: 5), interval: 2)
        #expect(list(lastFriday, "2026-10-30", 4) == ["2026-10-30", "2026-12-25", "2027-02-26", "2027-04-30"])
        let fifthMonday = monthly(nth: WeekdayOfMonth(nth: 5, weekday: 1))
        #expect(Recurrence.advance(fifthMonday, dueDate: "2026-01-01", today: "2026-01-01")?.dueDate == "2026-03-30")
        #expect(Recurrence.advance(fifthMonday, dueDate: "2026-03-30", today: "2026-03-30")?.dueDate == "2026-06-29")
        #expect(Recurrence.advance(secondTuesday, dueDate: "2026-10-01", today: "2026-10-01")?.dueDate == "2026-10-13")
    }

    @Test func countingFromCompletion() {
        let every3 = daily(3, from: .completion)
        #expect(Recurrence.advance(every3, dueDate: "2026-10-02", today: "2026-10-22")?.dueDate == "2026-10-25")
        var fromDue = every3
        fromDue.from = .due
        #expect(Recurrence.advance(fromDue, dueDate: "2026-10-02", today: "2026-10-22")?.dueDate == "2026-10-23")
        #expect(Recurrence.advance(every3, dueDate: "2026-10-30", today: "2026-10-22")?.dueDate == "2026-10-25")
        let mondays = RepeatRule(every: .week, weekdays: [1], from: .completion)
        #expect(Recurrence.advance(mondays, dueDate: "2026-10-12", today: "2026-10-21")?.dueDate == "2026-10-26")
        #expect(Recurrence.advance(monthly(monthDay: -1, from: .completion), dueDate: "2026-02-28", today: "2026-03-05")?.dueDate == "2026-03-31")
    }

    @Test func countIsTheOccurrencesLeftAndDatesSkippedByALateCompletionUseItUp() {
        #expect(Recurrence.advance(daily(count: 3), dueDate: "2026-10-20", today: "2026-10-20") == Recurrence.Next(dueDate: "2026-10-21", repeat: daily(count: 2)))
        #expect(Recurrence.advance(daily(count: 1), dueDate: "2026-10-20", today: "2026-10-20") == nil)
        #expect(Recurrence.advance(daily(count: 3), dueDate: "2026-10-20", today: "2026-10-22") == nil)
        #expect(Recurrence.advance(daily(count: 5), dueDate: "2026-10-20", today: "2026-10-22") == Recurrence.Next(dueDate: "2026-10-23", repeat: daily(count: 2)))
    }

    @Test func untilIsTheLastDateTheSeriesMayFallOn() {
        #expect(Recurrence.advance(daily(until: "2026-10-21"), dueDate: "2026-10-20", today: "2026-10-20")?.dueDate == "2026-10-21")
        #expect(Recurrence.advance(daily(until: "2026-10-21"), dueDate: "2026-10-21", today: "2026-10-21") == nil)
    }

    @Test func occurrencesRespectCountUntilTheRangeAndTheLimit() {
        #expect(list(daily(3, count: 5), "2026-10-22") == ["2026-10-22", "2026-10-25", "2026-10-28", "2026-10-31", "2026-11-03"])
        let fridays = RepeatRule(every: .week, weekdays: [5], until: "2026-11-13")
        #expect(list(fridays, "2026-10-23") == ["2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13"])
        #expect(list(daily(), "2026-10-01", range: ("2026-10-30", "2026-11-02")) == ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"])
        #expect(list(daily(), "2026-10-01", 2) == ["2026-10-01", "2026-10-02"])
    }

    @Test func completingAtNightAcrossLondonsClockChangesCountsFromTheLondonDay() {
        let rule = daily(from: .completion)
        func doneAt(_ iso: String) -> String? {
            Recurrence.advance(rule, dueDate: nil, today: HelmDates.localDate(utc(iso), "Europe/London"))?.dueDate
        }
        // Autumn: 23:30 UTC on 24 Oct is already 25 Oct in London (BST), on 25 Oct it is still 25 Oct (GMT).
        #expect(doneAt("2026-10-24T23:30") == "2026-10-26")
        #expect(doneAt("2026-10-25T23:30") == "2026-10-26")
        // Spring: 23:30 UTC on 28 Mar is 28 Mar (GMT), on 29 Mar it is 30 Mar (BST).
        #expect(doneAt("2026-03-28T23:30") == "2026-03-29")
        #expect(doneAt("2026-03-29T23:30") == "2026-03-31")
        // Plain dates do not move across the change.
        let weekly = RepeatRule(every: .week)
        #expect(list(weekly, "2026-10-18", 3) == ["2026-10-18", "2026-10-25", "2026-11-01"])
        #expect(list(weekly, "2026-03-22", 3) == ["2026-03-22", "2026-03-29", "2026-04-05"])
    }

    @Test func listingAheadGivesTheDatesCompletingOnTimeWouldCreate() {
        let rules: [(RepeatRule, String)] = [
            (daily(), "2026-01-31"),
            (daily(3, count: 7), "2026-01-31"),
            (RepeatRule(every: .week, interval: 2, weekdays: [1, 4]), "2026-10-19"),
            (monthly(), "2026-01-31"),
            (monthly(monthDay: -1), "2026-01-31"),
            (monthly(nth: WeekdayOfMonth(nth: 2, weekday: 2), until: "2027-06-30"), "2026-10-13"),
            (RepeatRule(every: .year), "2028-02-29"),
        ]
        for (rule, start) in rules {
            #expect(list(rule, start, 30, range: ("2026-01-01", "2099-12-31")) == completeOnTime(rule, start, 30), "\(rule)")
        }
    }

    /// Expected dates from python-dateutil 2.9's rrule, the same as in the backend's and the Android app's tests.
    @Test(arguments: [
        (RepeatRule(every: .month, weekdayOfMonth: WeekdayOfMonth(nth: 2, weekday: 2)), "2026-10-13",
         "2026-10-13 2026-11-10 2026-12-08 2027-01-12 2027-02-09 2027-03-09 2027-04-13 2027-05-11"),
        (RepeatRule(every: .month, weekdayOfMonth: WeekdayOfMonth(nth: -1, weekday: 5)), "2026-10-30",
         "2026-10-30 2026-11-27 2026-12-25 2027-01-29 2027-02-26 2027-03-26 2027-04-30 2027-05-28"),
        (RepeatRule(every: .month, monthDay: -1), "2026-01-31",
         "2026-01-31 2026-02-28 2026-03-31 2026-04-30 2026-05-31 2026-06-30 2026-07-31 2026-08-31"),
        // BYMONTHDAY=28,29;BYSETPOS=-1: the 29th, or the last day of a shorter February.
        (RepeatRule(every: .month, monthDay: 29), "2027-12-29",
         "2027-12-29 2028-01-29 2028-02-29 2028-03-29 2028-04-29 2028-05-29 2028-06-29 2028-07-29"),
        (RepeatRule(every: .week, interval: 2, weekdays: [1, 4]), "2026-10-19",
         "2026-10-19 2026-10-22 2026-11-02 2026-11-05 2026-11-16 2026-11-19 2026-11-30 2026-12-03"),
        (RepeatRule(every: .day, interval: 3, count: 5), "2026-10-22", "2026-10-22 2026-10-25 2026-10-28 2026-10-31 2026-11-03"),
        (RepeatRule(every: .week, weekdays: [5], until: "2026-12-04"), "2026-10-23",
         "2026-10-23 2026-10-30 2026-11-06 2026-11-13 2026-11-20 2026-11-27 2026-12-04"),
        (RepeatRule(every: .month, interval: 2, weekdayOfMonth: WeekdayOfMonth(nth: -1, weekday: 5)), "2026-10-30",
         "2026-10-30 2026-12-25 2027-02-26 2027-04-30 2027-06-25 2027-08-27 2027-10-29 2027-12-31"),
    ])
    func sameDatesAsAnRFC5545Implementation(rule: RepeatRule, start: String, dates: String) {
        let expected = dates.split(separator: " ").map(String.init)
        #expect(list(rule, start, expected.count, range: (start, "2030-12-31")) == expected)
    }
}
