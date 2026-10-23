import Testing
@testable import DayhandCore

/// The Android app's `HelmDatesTest`, case for case.
struct HelmDatesTests {
    @Test func londonMidnightInSummerAndWinterTime() {
        #expect(HelmDates.localDate(utc("2026-10-22T22:59"), "Europe/London") == "2026-10-22")
        #expect(HelmDates.localDate(utc("2026-10-22T23:00"), "Europe/London") == "2026-10-23")
        #expect(HelmDates.localDate(utc("2026-12-01T23:59"), "Europe/London") == "2026-12-01")
        #expect(HelmDates.localDate(utc("2026-12-02T00:00"), "Europe/London") == "2026-12-02")
    }

    @Test func warsawAndNewYork() {
        #expect(HelmDates.localDate(utc("2026-10-22T21:59"), "Europe/Warsaw") == "2026-10-22")
        #expect(HelmDates.localDate(utc("2026-10-22T22:00"), "Europe/Warsaw") == "2026-10-23")
        #expect(HelmDates.localDate(utc("2026-10-23T03:00"), "America/New_York") == "2026-10-22")
    }

    @Test func lastMillisecondBeforeMidnightAndMidnightItself() {
        let midnight = utc("2026-10-22T22:00") // 00:00 on 23 Oct in Warsaw (CEST)
        #expect(HelmDates.localDate(midnight - 1, "Europe/Warsaw") == "2026-10-22")
        #expect(HelmDates.localDate(midnight, "Europe/Warsaw") == "2026-10-23")
    }

    @Test func dayWhenClocksGoBackStillHasOneMidnight() {
        #expect(HelmDates.localDate(utc("2026-10-25T22:59"), "Europe/Warsaw") == "2026-10-25")
        #expect(HelmDates.localDate(utc("2026-10-25T23:00"), "Europe/Warsaw") == "2026-10-26")
        #expect(HelmDates.nextMidnight(utc("2026-10-25T12:00"), "Europe/Warsaw") == utc("2026-10-25T23:00"))
    }

    @Test func unknownOrMissingZoneFallsBackToTheBackendDefault() {
        #expect(HelmDates.localDate(utc("2026-10-22T23:00"), "Mars/Base") == "2026-10-23")
        #expect(HelmDates.localDate(utc("2026-10-22T23:00"), nil) == "2026-10-23")
    }

    @Test func nextMidnight() {
        #expect(HelmDates.nextMidnight(utc("2026-10-22T10:00"), "Europe/London") == utc("2026-10-22T23:00"))
        #expect(HelmDates.nextMidnight(utc("2026-10-22T23:00"), "Europe/London") == utc("2026-10-23T23:00"))
    }

    @Test func overdueRulesMatchTheBackend() {
        let base = task("a", due: "2026-10-21")
        #expect(HelmDates.isOverdue(base, today: "2026-10-22"))
        #expect(!HelmDates.isOverdue(base, today: "2026-10-21"))
        #expect(!HelmDates.isOverdue(task("a", due: "2026-10-21", status: .done), today: "2026-10-22"))
        #expect(!HelmDates.isOverdue(task("a", due: "2026-10-21") { $0.archivedAt = 1 }, today: "2026-10-22"))
        #expect(!HelmDates.isOverdue(task("a"), today: "2026-10-22"))
        #expect(HelmDates.isOverdue(task("a", due: "2026-10-21", status: .doing), today: "2026-10-22"))
    }

    @Test func addDaysCrossesMonthAndYear() {
        #expect(HelmDates.addDays("2026-12-31", 1) == "2027-01-01")
        #expect(HelmDates.addDays("2026-03-01", -1) == "2026-02-28")
    }

    @Test func civilDatesRoundTripAndKnowTheirWeekday() {
        for number in stride(from: -800_000, through: 800_000, by: 997) {
            #expect(CivilDate(dayNumber: number).dayNumber == number)
        }
        #expect(day("2026-10-22").weekday == 4)
        #expect(day("2026-10-25").weekday == 7)
        #expect(day("1970-01-01").dayNumber == 0)
        #expect(CivilDate("2026-02-29") == nil)
        #expect(CivilDate("2028-02-29") != nil)
        #expect(CivilDate("2026-1-01") == nil)
        #expect(ClockTime("24:00") == nil)
        #expect(ClockTime("9:00") == nil)
    }
}

/// The Android app's `TodaySectionsTest`, case for case.
struct TodaySectionsTests {
    let at = utc("2026-10-22T10:00")

    @Test func sectionsInOrderWithBackendSorting() {
        let tasks = [
            task("old", due: "2026-10-19", created: 1),
            task("yesterday-late", due: "2026-10-21", time: "18:00", created: 2),
            task("yesterday-untimed", due: "2026-10-21", created: 3),
            task("untimed", due: "2026-10-22", created: 4),
            task("at-13", due: "2026-10-22", time: "13:15", created: 5),
            task("at-09", due: "2026-10-22", time: "09:00", created: 6),
            task("tomorrow", due: "2026-10-23", created: 7),
            task("no-date", created: 8),
        ]
        let s = todaySections(tasks, nowMs: at, timezone: "Europe/London")
        #expect(s.date == "2026-10-22")
        #expect(ids(s.overdue) == ["old", "yesterday-late", "yesterday-untimed"])
        #expect(ids(s.today) == ["at-09", "at-13", "untimed"])
        #expect(s.now == nil)
        #expect(s.done.isEmpty)
        #expect(!s.isEmpty)
    }

    @Test func theNowTaskIsShownOnceInItsOwnSectionEvenWhenOverdue() {
        let tasks = [
            task("now", due: "2026-10-20", status: .doing, created: 1) { $0.isNow = true; $0.resumeNote = "page 3" },
            task("other", due: "2026-10-20", created: 2),
            task("today", due: "2026-10-22", status: .doing, created: 3),
        ]
        let s = todaySections(tasks, nowMs: at, timezone: "Europe/London")
        #expect(s.now?.localId == "now")
        #expect(ids(s.overdue) == ["other"])
        #expect(ids(s.today) == ["today"])
    }

    @Test func doneTodayOnlyNewestFirstArchivedAndOtherDaysLeftOut() {
        let tasks = [
            task("done-early", due: "2026-10-22", status: .done) { $0.completedAt = utc("2026-10-22T07:00") },
            task("done-late", due: "2026-10-20", status: .done) { $0.completedAt = utc("2026-10-22T09:00") },
            task("done-yesterday", due: "2026-10-21", status: .done) { $0.completedAt = utc("2026-10-21T12:00") },
            task("archived", due: "2026-10-20") { $0.archivedAt = 1 },
            task("archived-today", due: "2026-10-22") { $0.archivedAt = 1 },
        ]
        let s = todaySections(tasks, nowMs: at, timezone: "Europe/London")
        #expect(ids(s.done) == ["done-late", "done-early"])
        #expect(s.overdue.isEmpty)
        #expect(s.today.isEmpty)
        #expect(s.isEmpty, "only done tasks counts as an empty plan")
    }

    @Test func midnightInTheUsersZoneMovesTodaysTasksToOverdue() {
        let tasks = [task("a", due: "2026-10-22")]
        let before = todaySections(tasks, nowMs: utc("2026-10-22T21:59"), timezone: "Europe/Warsaw")
        let after = todaySections(tasks, nowMs: utc("2026-10-22T22:00"), timezone: "Europe/Warsaw")
        #expect(ids(before.today) == ["a"])
        #expect(before.overdue.isEmpty)
        #expect(after.date == "2026-10-23")
        #expect(ids(after.overdue) == ["a"])
        #expect(after.today.isEmpty)
    }

    @Test func doneIsCountedByTheCompletionDayInTheUsersZone() {
        // 22:30 UTC on 21 Oct is 00:30 on 22 Oct in Warsaw, but 18:30 on 21 Oct in New York.
        let done = task("d", due: "2026-10-21", status: .done) { $0.completedAt = utc("2026-10-21T22:30") }
        #expect(ids(todaySections([done], nowMs: at, timezone: "Europe/Warsaw").done) == ["d"])
        #expect(todaySections([done], nowMs: at, timezone: "America/New_York").done.isEmpty)
    }

    @Test func emptyPlan() {
        #expect(todaySections([], nowMs: at, timezone: "Europe/London").isEmpty)
    }

    @Test func tasksInTheTrashAreNeitherOverdueNowTodayNorDone() {
        let trashed = [
            task("late", due: "2026-10-20") { $0.deletedAt = 1 },
            task("now", due: "2026-10-22", status: .doing) { $0.isNow = true; $0.deletedAt = 1 },
            task("today", due: "2026-10-22") { $0.deletedAt = 1 },
            task("done", due: "2026-10-22", status: .done) { $0.completedAt = utc("2026-10-22T10:00"); $0.deletedAt = 1 },
        ]
        let s = todaySections(trashed, nowMs: at, timezone: "Europe/London")
        #expect(s.isEmpty)
        #expect(s.done.isEmpty)
        #expect(!HelmDates.isOverdue(trashed[0], today: "2026-10-22"))
    }
}

/// The Android app's `TaskRulesTest`, case for case.
struct TaskRulesTests {
    @Test func titlesAreTrimmedAndMustBe1To500Characters() {
        #expect(TaskRules.title("  Call ") == "Call")
        #expect(TaskRules.title("   ") == nil)
        #expect(TaskRules.title(String(repeating: "x", count: 500))?.count == 500)
        #expect(TaskRules.title(String(repeating: "x", count: 501)) == nil)
        // The server counts UTF-16 units: 250 emoji are 500 units, 251 are too many.
        #expect(TaskRules.title(String(repeating: "😀", count: 250)) != nil)
        #expect(TaskRules.title(String(repeating: "😀", count: 251)) == nil)
    }

    @Test func labelsAreTrimmedDeduplicatedAndLimitedLikeOnTheServer() {
        #expect(TaskRules.labels([" home", "work", "home ", " "]) == ["home", "work"])
        #expect(TaskRules.labels([String(repeating: "x", count: 51)]) == nil)
        #expect(TaskRules.labels((1...21).map { "l\($0)" }) == nil)
        #expect(TaskRules.labels((1...20).map { "l\($0)" })?.count == 20)
    }

    @Test func linksMustBeAbsoluteHttpOrHttpsAddresses() {
        #expect(TaskRules.isLinkURL("https://example.com/a?b=1"))
        #expect(TaskRules.isLinkURL("http://10.0.2.2:3210"))
        #expect(!TaskRules.isLinkURL("example.com"))
        #expect(!TaskRules.isLinkURL("ftp://example.com"))
        #expect(!TaskRules.isLinkURL("javascript:alert(1)"))
        #expect(!TaskRules.isLinkURL("https://"))
        #expect(!TaskRules.isLinkURL("https://example.com/" + String(repeating: "a", count: 2048)))
        #expect(TaskRules.link(url: " https://a.pl ", title: " Docs ") == TaskLink(url: "https://a.pl", title: "Docs"))
        #expect(TaskRules.link(url: "https://a.pl", title: "  ") == TaskLink(url: "https://a.pl"))
        #expect(TaskRules.link(url: "a.pl", title: "Docs") == nil)
    }

    @Test func repeatRulesFollowValidateRepeat() {
        #expect(TaskRules.isValid(RepeatRule(every: .day)))
        #expect(TaskRules.isValid(RepeatRule(every: .week, interval: 2, weekdays: [1, 3])))
        #expect(!TaskRules.isValid(RepeatRule(every: .day, interval: 0)))
        #expect(!TaskRules.isValid(RepeatRule(every: .year, interval: 367)))
        #expect(!TaskRules.isValid(RepeatRule(every: .month, weekdays: [1])))
        #expect(!TaskRules.isValid(RepeatRule(every: .week, weekdays: [])))
        #expect(!TaskRules.isValid(RepeatRule(every: .week, weekdays: [1, 1])))
        #expect(!TaskRules.isValid(RepeatRule(every: .week, weekdays: [8])))
    }

    @Test func monthPatternsUntilAndCountFollowValidateRepeat() {
        #expect(TaskRules.isValid(RepeatRule(every: .month, from: .completion, monthDay: -1, until: "2027-01-01")))
        #expect(TaskRules.isValid(RepeatRule(every: .month, weekdayOfMonth: WeekdayOfMonth(nth: -1, weekday: 5), count: 12)))
        #expect(!TaskRules.isValid(RepeatRule(every: .week, monthDay: 3)))
        #expect(!TaskRules.isValid(RepeatRule(every: .month, monthDay: 0)))
        #expect(!TaskRules.isValid(RepeatRule(every: .month, monthDay: -2)))
        #expect(!TaskRules.isValid(RepeatRule(every: .month, monthDay: 32)))
        #expect(!TaskRules.isValid(RepeatRule(every: .month, monthDay: 1, weekdayOfMonth: WeekdayOfMonth(nth: 1, weekday: 1))))
        #expect(!TaskRules.isValid(RepeatRule(every: .month, weekdayOfMonth: WeekdayOfMonth(nth: 0, weekday: 1))))
        #expect(!TaskRules.isValid(RepeatRule(every: .month, weekdayOfMonth: WeekdayOfMonth(nth: 6, weekday: 1))))
        #expect(!TaskRules.isValid(RepeatRule(every: .month, weekdayOfMonth: WeekdayOfMonth(nth: 1, weekday: 8))))
        #expect(!TaskRules.isValid(RepeatRule(every: .day, until: "2026-12-31", count: 3)))
        #expect(!TaskRules.isValid(RepeatRule(every: .day, until: "2026-02-30")))
        #expect(!TaskRules.isValid(RepeatRule(every: .day, count: 0)))
        #expect(!TaskRules.isValid(RepeatRule(every: .day, count: 1001)))
    }

    @Test func checklistItemsAreTrimmedEmptyOnesDroppedIdsUniqueAndAtMost100() {
        #expect(TaskRules.checklist([ChecklistItem(id: "a", title: " Milk "), ChecklistItem(id: "b", title: "  ")]) == [ChecklistItem(id: "a", title: "Milk")])
        #expect(TaskRules.checklist([ChecklistItem(id: "a", title: "x"), ChecklistItem(id: "a", title: "y")]) == nil)
        #expect(TaskRules.checklist([ChecklistItem(id: "a", title: String(repeating: "x", count: 501))]) == nil)
        #expect(TaskRules.checklist((1...101).map { ChecklistItem(id: "c\($0)", title: "Item \($0)") }) == nil)
        #expect(TaskRules.checklist((1...100).map { ChecklistItem(id: "c\($0)", title: "Item \($0)") })?.count == 100)
    }

    @Test func remindersFollowCheckReminders() {
        #expect(TaskRules.reminders([.before(15), .before(15)]) == [.before(15)])
        #expect(TaskRules.reminders([]) == [])
        #expect(TaskRules.reminders((1...6).map(TaskReminder.before)) == nil)
        #expect(TaskRules.isValid(TaskReminder.before(0)))
        #expect(TaskRules.isValid(TaskReminder.before(7 * 24 * 60)))
        #expect(!TaskRules.isValid(TaskReminder.before(7 * 24 * 60 + 1)))
        #expect(!TaskRules.isValid(TaskReminder.before(-1)))
        #expect(TaskRules.isValid(TaskReminder.at("18:00", daysBefore: 1)))
        #expect(TaskRules.isValid(TaskReminder.at("09:00", daysBefore: 30)))
        #expect(!TaskRules.isValid(TaskReminder.at("09:00", daysBefore: 31)))
        #expect(!TaskRules.isValid(TaskReminder.at("24:00")))
        #expect(!TaskRules.isValid(TaskReminder.at("9:00")))
        #expect(!TaskRules.isValid(TaskReminder(minutesBefore: 5, time: "09:00")))
        #expect(!TaskRules.isValid(TaskReminder()))
    }
}

/// The Android app's `ReminderRulesTest`, case for case.
struct ReminderRulesTests {
    let warsaw = "Europe/Warsaw"
    let minute: Int64 = 60_000

    func task(_ id: String, _ date: String?, _ time: String?, _ change: (inout TaskItem) -> Void = { _ in }) -> TaskItem {
        var item = TaskItem(localId: id, title: "Task \(id)", dueDate: date, dueTime: time, createdAt: 0, updatedAt: 0)
        change(&item)
        return item
    }

    func labels(_ reminders: [Reminder]) -> [String] {
        reminders.map { "\($0.taskLocalId)@\($0.minutesBefore.map(String.init) ?? "nil")" }
    }

    @Test func dueTimeIsReadInTheUsersZone() {
        #expect(ReminderRules.dueAt(task("a", "2026-10-22", "13:15"), warsaw) == utc("2026-10-22T11:15"))
        #expect(ReminderRules.dueAt(task("a", "2026-10-22", "13:15"), "Europe/London") == utc("2026-10-22T12:15"))
        #expect(ReminderRules.dueAt(task("a", "2026-10-22", nil), warsaw) == nil)
    }

    @Test func aTimeSkippedByTheSpringClockChangeMovesForwardByTheGap() {
        #expect(ReminderRules.dueAt(task("a", "2026-03-29", "02:30"), warsaw) == utc("2026-03-29T01:30"))
    }

    @Test func everyTimedOpenTaskRingsOncePerConfiguredOffsetEarliestFirst() {
        let tasks = [
            task("a", "2026-10-22", "13:15"),
            task("b", "2026-10-22", "09:00"),
            task("untimed", "2026-10-22", nil),
            task("nodate", nil, nil),
            task("done", "2026-10-22", "10:00") { $0.status = .done; $0.completedAt = 1 },
            task("archived", "2026-10-22", "10:00") { $0.archivedAt = 1 },
            task("trashed", "2026-10-22", "10:00") { $0.deletedAt = 1 },
        ]
        let reminders = ReminderRules.reminders(tasks, minutesBefore: [0, 30], timezone: warsaw)
        #expect(labels(reminders) == ["b@30", "b@0", "a@30", "a@0"])
        #expect(reminders.first?.at == utc("2026-10-22T06:30"))
    }

    @Test func noOffsetsMeansNoReminders() {
        #expect(ReminderRules.reminders([task("a", "2026-10-22", "13:15")], minutesBefore: [], timezone: warsaw).isEmpty)
    }

    @Test func aReminderWhoseMomentHadPassedWhenTheTaskWasSetDoesNotRing() {
        let t = task("a", "2026-10-22", "13:15") { $0.updatedAt = utc("2026-10-22T11:10") }
        #expect(ReminderRules.reminders([t], minutesBefore: [0, 10], timezone: warsaw).map(\.minutesBefore) == [0])
    }

    @Test func nextAlarmIsTheFirstReminderAfterWhatWasHandledAndNotTooLate() {
        let reminders = ReminderRules.reminders(
            [task("a", "2026-10-22", "09:00"), task("b", "2026-10-22", "13:15")], minutesBefore: [0], timezone: warsaw
        )
        let nine = utc("2026-10-22T07:00")
        let quarterPastOne = utc("2026-10-22T11:15")
        #expect(ReminderRules.nextAlarm(reminders, now: utc("2026-10-22T06:00"), handledUntil: 0) == nine)
        #expect(ReminderRules.nextAlarm(reminders, now: nine, handledUntil: nine) == quarterPastOne)
        #expect(ReminderRules.nextAlarm(reminders, now: nine + 5 * minute, handledUntil: 0) == nine)
        #expect(ReminderRules.nextAlarm(reminders, now: nine + 20 * minute, handledUntil: 0) == quarterPastOne)
        #expect(ReminderRules.nextAlarm(reminders, now: quarterPastOne, handledUntil: quarterPastOne) == nil)
    }

    @Test func dueRemindersAreThoseSinceTheLastCheckOnePerTaskNeverOverdueOnes() {
        let tasks = [
            task("a", "2026-10-22", "09:00"),
            task("b", "2026-10-22", "09:05"),
            task("c", "2026-10-22", "13:15"),
            task("late", "2026-10-21", "23:55"),
        ]
        let reminders = ReminderRules.reminders(tasks, minutesBefore: [0, 5], timezone: warsaw)
        let due = ReminderRules.due(reminders, now: utc("2026-10-22T07:06"), handledUntil: utc("2026-10-22T06:30"), timezone: warsaw)
        #expect(labels(due) == ["a@0", "b@0"])
        #expect(ReminderRules.due(reminders, now: utc("2026-10-21T22:02"), handledUntil: 0, timezone: warsaw).isEmpty)
    }

    @Test func summaryIsTheNextOccurrenceOfItsTimeInTheUsersZone() {
        #expect(ReminderRules.nextSummaryAt(now: utc("2026-10-22T02:59"), summaryTime: "05:00", timezone: warsaw) == utc("2026-10-22T03:00"))
        #expect(ReminderRules.nextSummaryAt(now: utc("2026-10-22T03:00"), summaryTime: "05:00", timezone: warsaw) == utc("2026-10-23T03:00"))
        #expect(ReminderRules.nextSummaryAt(now: utc("2026-10-24T03:30"), summaryTime: "05:00", timezone: warsaw) == utc("2026-10-25T04:00"))
    }

    @Test func morningSummaryCountsTodayAndOverdueAndSaysWhereToStart() {
        let now = utc("2026-10-22T03:00")
        let tasks = [
            task("t1", "2026-10-22", "09:00"),
            task("t2", "2026-10-22", nil),
            task("o1", "2026-10-20", nil),
            task("tomorrow", "2026-10-23", nil),
        ]
        #expect(morningSummary(tasks, nowMs: now, timezone: warsaw) == MorningSummary(today: 2, overdue: 1, startWith: "Task o1"))
        let withNow = tasks + [task("n", "2026-10-22", nil) { $0.isNow = true; $0.status = .doing }]
        #expect(morningSummary(withNow, nowMs: now, timezone: warsaw) == MorningSummary(today: 3, overdue: 1, startWith: "Task n"))
        #expect(morningSummary([], nowMs: now, timezone: warsaw) == MorningSummary(today: 0, overdue: 0, startWith: nil))
    }

    @Test func aTasksOwnRemindersReplaceTheDefaultsAndAnEmptyListSilencesIt() {
        let own = task("own", "2026-10-22", "13:15") { $0.reminders = [.before(60)] }
        let silent = task("silent", "2026-10-22", "13:30") { $0.reminders = [] }
        let plain = task("default", "2026-10-22", "14:00")
        let reminders = ReminderRules.reminders([own, silent, plain], minutesBefore: [0, 30], timezone: warsaw)
        #expect(labels(reminders) == ["own@60", "default@30", "default@0"])
    }

    @Test func aTimeOfDayRingsOnTheDueDayOrDaysBeforeEvenForATaskWithoutATime() {
        let untimed = task("u", "2026-10-22", nil) { $0.reminders = [.at("09:00"), .at("18:00", daysBefore: 1), .before(15)] }
        let rung = ReminderRules.reminders([untimed], minutesBefore: [0], timezone: warsaw)
        #expect(rung.map(\.at) == [utc("2026-10-21T16:00"), utc("2026-10-22T07:00")])
        #expect(rung.map(\.daysBefore) == [1, 0])
        #expect(rung.map(\.minutesBefore) == [nil, nil])
    }

    @Test func aTimeOfDayInLondonFollowsItsClockChanges() {
        func at(_ date: String, _ time: String) -> Int64? {
            ReminderRules.reminders([task("a", date, nil) { $0.reminders = [.at(time)] }], minutesBefore: [], timezone: "Europe/London").first?.at
        }
        #expect(at("2026-10-24", "09:00") == utc("2026-10-24T08:00"))
        #expect(at("2026-10-26", "09:00") == utc("2026-10-26T09:00"))
        #expect(at("2026-03-29", "01:30") == utc("2026-03-29T01:30"))
        #expect(at("2026-10-25", "01:30") == utc("2026-10-25T00:30"))
    }
}

/// What Dayhand leaves with macOS: the reminders ahead and a summary each morning.
struct ReminderPlannerTests {
    let warsaw = ReminderSettings(timezone: "Europe/Warsaw", summaryTime: "05:00", reminderMinutes: [0, 30])

    @Test func remindersAheadAndSevenSummariesWithTheirOwnText() {
        let now = utc("2026-10-22T06:00") // 08:00 Warsaw
        let tasks = [
            task("a", due: "2026-10-22", time: "09:00"),
            task("b", due: "2026-10-23", time: "10:00"),
            task("late", due: "2026-10-20", time: "09:00"),
        ]
        let plan = ReminderPlanner.plan(tasks, settings: warsaw, now: now)
        let rings = plan.filter { if case .reminder = $0.kind { return true } else { return false } }
        #expect(rings.map(\.at) == [utc("2026-10-22T06:30"), utc("2026-10-22T07:00"), utc("2026-10-23T07:30"), utc("2026-10-23T08:00")])
        #expect(rings.map(\.body) == ["Today at 09:00", "Now, 09:00", "Today at 10:00", "Now, 10:00"])
        let summaries = plan.filter { $0.kind == .summary }
        #expect(summaries.count == 7)
        #expect(summaries.first?.id == "dayhand.summary.2026-10-23")
        // On the 23rd, "a" (due the 22nd, not done) is overdue and "b" is today's.
        #expect(summaries.first?.title == "1 task today, 2 overdue")
        #expect(summaries.first?.body == "Start with: late")
    }

    @Test func overdueTasksNeverRingAndThePastIsLeftOut() {
        let now = utc("2026-10-22T08:00") // 10:00 Warsaw
        let plan = ReminderPlanner.plan([task("a", due: "2026-10-22", time: "09:00")], settings: warsaw, now: now)
        #expect(plan.allSatisfy { $0.kind == .summary })
    }

    @Test func idsStayTheSameWhenPlannedAgain() {
        let now = utc("2026-10-22T06:00")
        let tasks = [task("a", due: "2026-10-22", time: "09:00")]
        #expect(ReminderPlanner.plan(tasks, settings: warsaw, now: now).map(\.id) == ReminderPlanner.plan(tasks, settings: warsaw, now: now + 1000).map(\.id))
    }

    @Test func thePlanStaysWithinTheSystemLimit() {
        let now = utc("2026-10-22T06:00")
        let many = (0..<100).map { task("t\($0)", due: "2026-10-23", time: String(format: "%02d:%02d", 6 + $0 / 60, $0 % 60)) }
        #expect(ReminderPlanner.plan(many, settings: warsaw, now: now).count == ReminderPlanner.limit)
    }
}
