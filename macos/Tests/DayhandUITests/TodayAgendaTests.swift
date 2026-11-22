import DayhandCore
import DayhandLocalization
import Foundation
import Testing
@testable import DayhandUI

/// Today as an agenda, through the app's model on a database in memory: what the strip of days, the sentence and
/// To plan count, a day of the strip shown in Today's place, moving a task to another day, and the toolbar's field
/// adding what is typed on Return.
@MainActor
struct TodayAgendaTests {
    private func makeModel() throws -> AppModel {
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        defaults.register(defaults: [AppModel.Keys.useOffline: true, AppModel.Keys.language: "en"])
        return AppModel(AppEnvironment(
            database: try AppDatabase.inMemory(), credentials: MemoryCredentialStore(), notifications: false, defaults: defaults
        ))
    }

    private func eventually(_ condition: () -> Bool) async throws {
        for _ in 0..<100 where !condition() {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        #expect(condition())
    }

    private func day(_ model: AppModel, _ offset: Int) -> String { HelmDates.addDays(model.today, offset) ?? model.today }

    private func seed(_ model: AppModel) async throws {
        let now = Clock.nowMs()
        let today = HelmDates.localDate(now, "Europe/Warsaw")
        let day = { (offset: Int) in HelmDates.addDays(today, offset) ?? today }
        try await model.repository.apply(Snapshot(
            tasks: [
                RemoteTask(id: "t1", title: "Call", dueDate: today, dueTime: "14:00", createdAt: now, updatedAt: now),
                RemoteTask(id: "t2", title: "Plants", dueDate: today, createdAt: now, updatedAt: now, repeat: RepeatRule(every: .week)),
                RemoteTask(id: "t3", title: "Invoice", dueDate: day(-2), createdAt: now, updatedAt: now),
                RemoteTask(id: "t4", title: "Idea", createdAt: now - 1000, updatedAt: now),
                RemoteTask(id: "t5", title: "Dentist", dueDate: day(1), dueTime: "10:00", createdAt: now, updatedAt: now),
                RemoteTask(id: "t6", title: "Cards", dueDate: day(3), createdAt: now, updatedAt: now),
                RemoteTask(id: "t7", title: "Far away", dueDate: day(4), createdAt: now, updatedAt: now),
                RemoteTask(id: "t8", title: "Ran", dueDate: today, status: "done", completedAt: now, createdAt: now, updatedAt: now),
                RemoteTask(id: "t9", title: "Old idea", archivedAt: now, createdAt: now, updatedAt: now),
            ],
            settings: ReminderSettings(timezone: "Europe/Warsaw")
        ))
        try await eventually { model.tasks.count == 9 }
    }

    @Test func theOverviewCountsTheDaysAndListsWhatNeedsADay() async throws {
        let model = try makeModel()
        try await seed(model)
        let overview = model.overview

        #expect(overview.days.count == 14)
        #expect(overview.days.first?.date == model.today)
        // Open tasks only: the done one does not weigh on today.
        #expect(overview.days.prefix(5).map(\.open) == [2, 1, 0, 1, 1])
        #expect(overview.timed == 1 && overview.repeating == 1)
        #expect(overview.noDay.map(\.title) == ["Idea"])
        // The next three days, not the fourth.
        #expect(overview.comingUp.map(\.title) == ["Dentist", "Cards"])
        #expect(model.sections.overdue.map(\.title) == ["Invoice"])
    }

    @Test func aDayOfTheStripIsShownInTodaysPlaceNotInThePlan() async throws {
        let model = try makeModel()
        try await seed(model)
        let mode = model.viewMode
        model.preview(day(model, 1))

        #expect(model.viewMode == mode)
        #expect(model.place == .today)
        #expect(model.planDayOffset == 0)
        #expect(model.shownDay == day(model, 1))
        let tomorrow = try #require(model.previewSections)
        #expect(tomorrow.date == day(model, 1))
        #expect(tomorrow.today.map(\.title) == ["Dentist"])
        #expect(tomorrow.overdue.isEmpty && tomorrow.now == nil)

        // Another day of the strip replaces it; a day without tasks is shown empty.
        model.preview(day(model, 2))
        #expect(model.previewSections?.today.isEmpty == true)

        // The search narrows the picked day like today.
        model.preview(day(model, 3))
        model.search = "nothing like it"
        #expect(model.previewSections?.today.isEmpty == true)
        model.search = ""
        #expect(model.previewSections?.today.map(\.title) == ["Cards"])
    }

    @Test func todayOrLeavingTodaysPlaceGoesBackToToday() async throws {
        let model = try makeModel()
        model.preview(day(model, 2))
        model.preview(model.today)
        #expect(model.previewDay == nil && model.previewSections == nil && model.shownDay == model.today)

        // An earlier day is never shown in today's place.
        model.preview(day(model, -1))
        #expect(model.previewDay == nil)

        model.preview(day(model, 2))
        model.show(.all)
        #expect(model.previewDay == nil)
    }

    @Test func quickAddOnAPickedDayPlansItForThatDay() async throws {
        let model = try makeModel()
        model.preview(day(model, 2))
        #expect(model.quickAddContext(.today).date == day(model, 2))
        #expect(model.quickAddContext(.all).date == nil)
        model.preview(model.today)
        #expect(model.quickAddContext(.today).date == model.today)
    }

    @Test func aTaskMovesToAnotherDayOnlyWhileOpen() async throws {
        let model = try makeModel()
        try await seed(model)
        let invoice = try #require(model.tasks.first { $0.title == "Invoice" })
        let ran = try #require(model.tasks.first { $0.title == "Ran" })
        #expect(model.canReschedule(invoice.localId))
        #expect(!model.canReschedule(ran.localId))
        #expect(!model.canReschedule(nil))

        model.moveToDay(invoice.localId, day(model, 5))
        try await eventually { model.task(invoice.localId)?.dueDate == day(model, 5) }
        #expect(model.sections.overdue.isEmpty)
    }

    @Test func returnInTheToolbarsFieldAddsWhatIsTypedAndClearsIt() async throws {
        let model = try makeModel()
        model.search = "Call Anna tomorrow 2pm"
        #expect(model.isSearching)
        model.addFromSearch()
        #expect(model.search.isEmpty)
        try await eventually { model.tasks.contains { $0.title == "Call Anna" } }
        let added = try #require(model.tasks.first { $0.title == "Call Anna" })
        #expect(added.dueDate == day(model, 1) && added.dueTime == "14:00")

        // Nothing but spaces adds nothing and stays typed.
        model.search = "   "
        model.addFromSearch()
        #expect(model.search == "   ")
    }

    @Test func aPlaceThatTakesNoTasksAddsToToday() async throws {
        let model = try makeModel()
        let now = Clock.nowMs()
        try await model.repository.apply(Snapshot(
            tasks: [],
            settings: ReminderSettings(timezone: "Europe/Warsaw"),
            projects: [RemoteProject(id: "p1", name: "Old", position: 1, archivedAt: now, createdAt: now, updatedAt: now)]
        ))
        try await eventually { !model.projects.isEmpty }
        let old = try #require(model.projects.first)
        model.show(.project(old.localId))
        #expect(model.searchAddPlace == .today)

        model.search = "Sweep"
        model.addFromSearch()
        try await eventually { model.tasks.contains { $0.title == "Sweep" } }
        let added = try #require(model.tasks.first { $0.title == "Sweep" })
        #expect(added.dueDate == model.today && added.projectLocalId == nil)
    }
}
