import DayhandCore
import DayhandLocalization
import Foundation
import SwiftUI
import Testing
@testable import DayhandUI

/// The plan's seven days from today, where times sit in its grid, the lanes of tasks close in time, how a short window shares its
/// height, and the tasks a place plans in a week.
@MainActor
struct PlanTests {
    @Test func aWeekRunsFromTodayForSevenDaysAndMovesInSevens() throws {
        // A Sunday: the plan starts on it, not on the Monday before.
        let sunday = try #require(CivilDate("2026-11-22"))
        let week = PlanWeek.around(0, from: sunday)
        #expect(week.days.map(\.description) == [
            "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28",
        ])
        #expect(PlanWeek.around(6, from: sunday) == week)
        #expect(PlanWeek.around(7, from: sunday).first.description == "2026-11-29")
        #expect(PlanWeek.around(-1, from: sunday).first.description == "2026-11-15")
        #expect(PlanWeek.around(-7, from: sunday).first.description == "2026-11-15")
        #expect(PlanWeek.around(-8, from: sunday).first.description == "2026-11-08")
        #expect(week.contains("2026-11-28") && !week.contains("2026-11-29") && !week.contains("2026-11-21"))
        #expect(!week.contains(nil) && !week.contains("soon"))
        Localization.$override.withValue(Localization(language: "en", region: "GB")) {
            #expect(week.range == "22 November – 28 November")
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
        // A chain half an hour apart reuses the lane freed an hour earlier, so it keeps two lanes however long it runs.
        #expect(chained["a"]?.lane == 0 && chained["b"]?.lane == 1 && chained["c"]?.lane == 0)
        #expect([chained["a"]?.of, chained["b"]?.of, chained["c"]?.of] == [2, 2, 2])
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

    @Test func aDaysTitleWithAllItsUntimedTasksFitsTheHeader() throws {
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        defaults.register(defaults: [AppModel.Keys.useOffline: true, AppModel.Keys.language: "en"])
        let model = AppModel(AppEnvironment(
            database: try AppDatabase.inMemory(), credentials: MemoryCredentialStore(), notifications: false, defaults: defaults
        ))
        let day = try #require(CivilDate("2026-10-22"))
        let tasks = (1...5).map {
            TaskItem(localId: "u\($0)", title: "Untimed task \($0)", dueDate: day.description, createdAt: 0, updatedAt: 0)
        }
        for height in [466.0, 650.0] {
            let layout = PlanLayout(height: height)
            // More untimed tasks than shown, so "+n more" is there too.
            let header = PlanDayHeader(day: day, tasks: tasks, isToday: true, limit: layout.untimed)
                .environmentObject(model)
                .frame(width: 108)
                .fixedSize(horizontal: false, vertical: true)
            let needed = NSHostingView(rootView: header).fittingSize.height
            #expect(needed <= layout.header, "\(height): the day's title needs \(needed), the header has \(layout.header)")
        }
    }

    @Test func aPlacePlansItsActiveTasksDueInTheWeek() async throws {
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        defaults.register(defaults: [AppModel.Keys.useOffline: true, AppModel.Keys.language: "en"])
        let model = AppModel(AppEnvironment(
            database: try AppDatabase.inMemory(), credentials: MemoryCredentialStore(), notifications: false, defaults: defaults
        ))
        let now = Clock.nowMs()
        let today = model.today
        let week = PlanWeek.around(0, from: try #require(CivilDate(today)))
        let first = week.first.description
        try await model.repository.apply(Snapshot(
            tasks: [
                RemoteTask(id: "t1", title: "Invoice", dueDate: first, dueTime: "09:00", createdAt: now, updatedAt: now, projectId: "p1"),
                RemoteTask(id: "t2", title: "Milk", dueDate: first, createdAt: now, updatedAt: now),
                RemoteTask(id: "t3", title: "Next week", dueDate: week.first.adding(days: 7).description, createdAt: now, updatedAt: now, projectId: "p1"),
                RemoteTask(id: "t4", title: "Filed", dueDate: first, archivedAt: now, createdAt: now, updatedAt: now, projectId: "p1"),
            ],
            settings: ReminderSettings(timezone: "Europe/Warsaw"),
            projects: [RemoteProject(id: "p1", name: "Bakery", position: 1, createdAt: now, updatedAt: now)]
        ))
        for _ in 0..<100 where model.tasks.count < 3 || model.projects.isEmpty {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        let bakery = try #require(model.projects.first)

        model.show(.all)
        #expect(model.plan(week)[first]?.map(\.title).sorted() == ["Invoice", "Milk"])
        model.show(.project(bakery.localId))
        #expect(model.plan(week).values.flatMap { $0 }.map(\.title) == ["Invoice"])
        model.show(.noProject)
        #expect(model.plan(week)[first]?.map(\.title) == ["Milk"])
        model.search = "inv"
        model.show(.all)
        #expect(model.plan(week).values.flatMap { $0 }.map(\.title) == ["Invoice"])
    }
}
