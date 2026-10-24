import DayhandCore
import DayhandLocalization
import Testing
@testable import DayhandUI

/// The repeat and reminder editors' own words, in English and in Polish with its plural forms.
struct EditorTextTests {
    func run(_ language: String, _ body: () -> String) -> String {
        Localization.$override.withValue(Localization(language: language, region: "GB"), operation: body)
    }

    @Test func monthChoicesReadAsSentences() {
        let due = CivilDate("2026-10-30")!
        let english = RepeatDraft.monthDays(due: due, current: RepeatRule(every: .month, monthDay: 15)).map { choice in
            run("en") { RepeatEditor.monthText(choice, due: due, fromCompletion: false) }
        }
        #expect(english == ["Day 30", "The last day of the month", "On the fifth Friday", "On the last Friday", "On day 15"])
        #expect(run("pl") { RepeatEditor.monthText(.weekday(WeekdayOfMonth(nth: 1, weekday: 1)), due: due, fromCompletion: false) } == "W pierwszy poniedziałek")
    }

    @Test(arguments: [false, true], [false, true])
    func implicitDaysDescribeTheEffectiveAnchor(_ hasDueDate: Bool, _ fromCompletion: Bool) {
        let due = hasDueDate ? CivilDate("2026-10-22") : nil
        let usesCompletion = fromCompletion || !hasDueDate
        #expect(run("en") { RepeatEditor.monthText(.sameDay, due: due, fromCompletion: fromCompletion) }
            == (usesCompletion ? "The day I complete it" : "Day 22"))
        #expect(run("en") { RepeatEditor.weekdayHint(due: due, fromCompletion: fromCompletion) }
            == (usesCompletion ? "No day picked: the completion day's weekday." : "No day picked: the due date's weekday."))
        #expect(run("pl") { RepeatEditor.weekdayHint(due: due, fromCompletion: fromCompletion) }
            == (usesCompletion ? "Bez wybranego dnia: dzień tygodnia, w którym ukończę zadanie." : "Nie wybrano dnia: dzień tygodnia terminu."))
        let monthly = RepeatRule(every: .month, from: fromCompletion ? .completion : nil)
        let weekly = RepeatRule(every: .week, from: fromCompletion ? .completion : nil)
        #expect(Recurrence.advance(monthly, dueDate: due?.description, today: "2026-10-24")?.dueDate
            == (usesCompletion ? "2026-11-24" : "2026-11-22"))
        #expect(Recurrence.advance(weekly, dueDate: due?.description, today: "2026-10-24")?.dueDate
            == (usesCompletion ? "2026-10-31" : "2026-10-29"))
        #expect(run("en") { RepeatEditor.monthText(.day(15), due: due, fromCompletion: fromCompletion) } == "On day 15")
        #expect(run("en") { RepeatEditor.monthText(.lastDay, due: due, fromCompletion: fromCompletion) } == "The last day of the month")
        #expect(run("en") {
            RepeatEditor.monthText(.weekday(WeekdayOfMonth(nth: 4, weekday: 4)), due: due, fromCompletion: fromCompletion)
        } == "On the fourth Thursday")
    }

    @Test func completionAnchorHintsAreTranslated() {
        for language in Localization.supported {
            let hint = run(language) { RepeatEditor.weekdayHint(due: nil, fromCompletion: false) }
            #expect(!hint.isEmpty)
            if language != "en" { #expect(hint != "No day picked: the completion day's weekday.") }
            #expect(run(language) {
                RepeatEditor.monthText(.sameDay, due: nil, fromCompletion: false)
            } == run(language) { tr("The day I complete it") })
        }
    }

    @Test func countsFollowEachLanguagesPlurals() {
        #expect(run("en") { RepeatEditor.everyText(.week, 2) } == "Every 2 weeks")
        #expect(run("en") { tr("\(1) times, this one included") } == "1 time, this one included")
        #expect(run("pl") { tr("\(3) times, this one included") } == "3 razy, łącznie z tym")
        #expect(run("pl") { tr("At most \(5) reminders.") } == "Najwyżej 5 przypomnień.")
    }

    @Test func pickerDaysAndTimesDoNotMoveWithTheZone() {
        #expect(PickerDates.day(PickerDates.date("2026-03-29")) == "2026-03-29")
        #expect(PickerDates.day(PickerDates.date("2024-02-29")) == "2024-02-29")
        #expect(PickerDates.hhmm(PickerDates.time("18:45")) == "18:45")
        #expect(PickerDates.hhmm(PickerDates.time("00:00")) == "00:00")
    }
}
