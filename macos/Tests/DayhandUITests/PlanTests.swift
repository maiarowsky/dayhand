import DayhandCore
import DayhandLocalization
import Foundation
import Testing
@testable import DayhandUI

/// The plan's week, where times sit in its grid, the lanes of tasks close in time, how a short window shares its
/// height, and the tasks a place plans in a week.
@MainActor
struct PlanTests {
    @Test func aWeekRunsMondayToSundayAndShifts() throws {
        let week = try #require(PlanWeek.containing("2026-10-25"))
        #expect(week.monday.description == "2026-10-19")
        #expect(PlanWeek.containing("2026-10-19") == week)
        #expect(week.days.map(\.description).last == "2026-10-25")
        #expect(week.shifted(by: 1).monday.description == "2026-10-26")
        #expect(week.shifted(by: -1).monday.description == "2026-10-12")
        #expect(week.contains("2026-10-25") && !week.contains("2026-10-26") && !week.contains(nil) && !week.contains("soon"))
        #expect(PlanWeek.containing("someday") == nil)
        Localization.$override.withValue(Localization(language: "en", region: "GB")) {
            #expect(week.range == "19 October – 25 October")
        }
    }

    @Test func timesSitInTheGridAndAPointGivesTheHalfHour() {
        #expect(PlanGrid.offset("00:00") == 0)
        #expect(PlanGrid.offset("08:30") == 8.5 * PlanGrid.hourHeight)
        // A late task keeps a whole hour of the grid.
        #expect(PlanGrid.offset("23:30") == PlanGrid.height - PlanGrid.hourHeight)
        #expect(PlanGrid.offset("noon") == nil)

        #expect(PlanGrid.time(at: 0) == "00:00")
        #expect(PlanGrid.time(at: 8 * PlanGrid.hourHeight + 1) == "08:00")
        #expect(PlanGrid.time(at: 8.5 * PlanGrid.hourHeight + 1) == "08:30")
        #expect(PlanGrid.time(at: -10) == "00:00")
        #expect(PlanGrid.time(at: 100_000) == "23:30")
    }

    @Test func tasksWithinAnHourShareTheWidth() {
        func task(_ id: String, _ time: String?) -> TaskItem {
            TaskItem(localId: id, title: id, dueDate: "2026-10-25", dueTime: time, createdAt: 0, updatedAt: 0)
        }
        let lanes = PlanGrid.lanes([task("late", "11:00"), task("b", "09:30"), task("a", "09:00"), task("all day", nil)])
        #expect(lanes["a"]?.lane == 0 && lanes["a"]?.of == 2)
        #expect(lanes["b"]?.lane == 1 && lanes["b"]?.of == 2)
        #expect(lanes["late"]?.lane == 0 && lanes["late"]?.of == 1)
        #expect(lanes["all day"] == nil)

        let chained = PlanGrid.lanes([task("a", "09:00"), task("b", "09:30"), task("c", "10:00"), task("d", "11:00")])
        #expect(chained["a"]?.lane == 0 && chained["b"]?.lane == 1 && chained["c"]?.lane == 2)
        #expect([chained["a"]?.of, chained["b"]?.of, chained["c"]?.of] == [3, 3, 3])
        #expect(chained["d"]?.lane == 0 && chained["d"]?.of == 1)
    }

    @Test func aShortWindowKeepsRoomForTheHours() {
        let short = PlanLayout(height: 466)
        #expect(short.untimed == 1 && short.header < PlanLayout(height: 650).header)
        #expect(short.drawer == 130)
        #expect(PlanLayout(height: 650).untimed == 3)
        #expect(PlanLayout(height: 2000).drawer == 190)
        #expect(PlanLayout(height: 200).drawer == 110)
    }

    @Test func aPlacePlansItsActiveTasksDueInTheWeek() async throws {
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        defaults.register(defaults: [AppModel.Keys.useOffline: true, AppModel.Keys.language: "en"])
        let model = AppModel(AppEnvironment(
            database: try AppDatabase.inMemory(), credentials: MemoryCredentialStore(), notifications: false, defaults: defaults
        ))
        let now = Clock.nowMs()
        let today = model.today
        let week = try #require(PlanWeek.containing(today))
        let monday = week.monday.description
        try await model.repository.apply(Snapshot(
            tasks: [
                RemoteTask(id: "t1", title: "Invoice", dueDate: monday, dueTime: "09:00", createdAt: now, updatedAt: now, projectId: "p1"),
                RemoteTask(id: "t2", title: "Milk", dueDate: monday, createdAt: now, updatedAt: now),
                RemoteTask(id: "t3", title: "Next week", dueDate: week.shifted(by: 1).monday.description, createdAt: now, updatedAt: now, projectId: "p1"),
                RemoteTask(id: "t4", title: "Filed", dueDate: monday, archivedAt: now, createdAt: now, updatedAt: now, projectId: "p1"),
            ],
            settings: ReminderSettings(timezone: "Europe/Warsaw"),
            projects: [RemoteProject(id: "p1", name: "Bakery", position: 1, createdAt: now, updatedAt: now)]
        ))
        for _ in 0..<100 where model.tasks.count < 3 || model.projects.isEmpty {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        let bakery = try #require(model.projects.first)

        model.show(.all)
        #expect(model.plan(week)[monday]?.map(\.title).sorted() == ["Invoice", "Milk"])
        model.show(.project(bakery.localId))
        #expect(model.plan(week).values.flatMap { $0 }.map(\.title) == ["Invoice"])
        model.show(.noProject)
        #expect(model.plan(week)[monday]?.map(\.title) == ["Milk"])
        model.search = "inv"
        model.show(.all)
        #expect(model.plan(week).values.flatMap { $0 }.map(\.title) == ["Invoice"])
    }
}
