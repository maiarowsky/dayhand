import DayhandCore
import DayhandLocalization
import Foundation
import Testing
@testable import DayhandUI

/// The board's columns, the view switcher's choice and where a new card may be added, through the app's model on a
/// database in memory.
@MainActor
struct BoardTests {
    private func makeModel(_ defaults: UserDefaults? = nil) throws -> AppModel {
        let defaults = try defaults ?? #require(UserDefaults(suiteName: UUID().uuidString))
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

    /// A project with a task in each status and an archived project, synced from a server.
    private func seeded(_ model: AppModel) async throws -> (bakery: String, old: String) {
        let now = Clock.nowMs()
        let zone = "Europe/Warsaw"
        let today = HelmDates.localDate(now, zone)
        let projects = [
            RemoteProject(id: "p1", name: "Bakery website", color: .amber, position: 1, createdAt: now, updatedAt: now),
            RemoteProject(id: "p2", name: "Old", position: 2, archivedAt: now, createdAt: now, updatedAt: now),
        ]
        let tasks = [
            RemoteTask(id: "t1", title: "Invoice", dueDate: today, createdAt: now, updatedAt: now, projectId: "p1"),
            RemoteTask(id: "t2", title: "Photos", status: "doing", createdAt: now, updatedAt: now, projectId: "p1"),
            RemoteTask(id: "t3", title: "Logo", status: "done", completedAt: now, createdAt: now, updatedAt: now, projectId: "p1"),
            RemoteTask(id: "t4", title: "Milk", dueDate: today, createdAt: now, updatedAt: now),
        ]
        try await model.repository.apply(Snapshot(tasks: tasks, settings: ReminderSettings(timezone: zone), projects: projects))
        try await eventually { model.projects.count == 2 && model.tasks.count == 4 }
        return (model.projects[0].localId, model.projects[1].localId)
    }

    @Test func aProjectsBoardSplitsItsTasksByStatusAndFollowsTheSearch() async throws {
        let model = try makeModel()
        let (bakery, _) = try await seeded(model)
        model.show(.project(bakery))
        #expect(model.board.todo.map(\.title) == ["Invoice"])
        #expect(model.board.doing.map(\.title) == ["Photos"])
        #expect(model.board.done.map(\.title) == ["Logo"])
        model.search = "pho"
        #expect(model.board.todo.isEmpty && model.board.doing.map(\.title) == ["Photos"] && model.board.done.isEmpty)
    }

    @Test func todaysBoardHoldsTodaysTasksAndOtherPlacesHaveNone() async throws {
        let model = try makeModel()
        _ = try await seeded(model)
        model.show(.today)
        #expect(Set(model.board.todo.map(\.title)) == ["Invoice", "Milk"])
        #expect(model.placeHasViews)
        model.show(.trash)
        #expect(!model.placeHasViews)
        #expect(model.board == BoardColumns())
    }

    @Test func aCardDroppedOnAnotherColumnTakesItsStatus() async throws {
        let model = try makeModel()
        let (bakery, _) = try await seeded(model)
        model.show(.project(bakery))
        let invoice = try #require(model.tasks.first { $0.title == "Invoice" })
        #expect(!model.drop(invoice.localId, onColumn: .todo))
        #expect(!model.drop("unknown", onColumn: .doing))
        #expect(model.drop(invoice.localId, onColumn: .doing))
        try await eventually { model.board.doing.map(\.title).sorted() == ["Invoice", "Photos"] }
        #expect(model.board.todo.isEmpty)
    }

    @Test func theDoneColumnCountsEveryDoneTaskThoughItShowsTheLatest() async throws {
        let model = try makeModel()
        let now = Clock.nowMs()
        let limit = TaskListSections.doneLimit
        let tasks = (0...limit).map {
            RemoteTask(id: "d\($0)", title: "Done \($0)", status: "done", completedAt: now, createdAt: now, updatedAt: now)
        }
        try await model.repository.apply(Snapshot(tasks: tasks, settings: ReminderSettings(timezone: "Europe/Warsaw")))
        try await eventually { model.tasks.count == limit + 1 }
        model.show(.all)
        #expect(model.board.done.count == limit)
        #expect(model.board.count(.done) == limit + 1)
    }

    @Test func anArchivedProjectsPlaceTakesNoNewTasks() async throws {
        let model = try makeModel()
        let (bakery, old) = try await seeded(model)
        model.show(.project(bakery))
        #expect(model.placeTakesTasks)
        model.show(.project(old))
        #expect(!model.placeTakesTasks)
        model.show(.all)
        #expect(model.placeTakesTasks)
    }

    @Test func theViewSwitcherRemembersBoardOrList() async throws {
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        let model = try makeModel(defaults)
        #expect(model.viewMode == .list)
        model.viewMode = .board
        #expect(try makeModel(defaults).viewMode == .board)
        #expect(ViewMode.allCases.map(\.title) == ["Board", "List"])
    }
}
