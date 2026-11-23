import DayhandCore
import DayhandLocalization
import Foundation
import SwiftUI
import Testing
@testable import DayhandUI

/// The Task menu's commands on the selected task: their keys, when they are offered, and what each one does, through
/// the app's model on a database in memory.
@MainActor
struct TaskCommandTests {
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

    /// A task due two days ago, selected.
    private func selectedTask(_ model: AppModel) async throws -> String {
        let now = Clock.nowMs()
        let today = HelmDates.localDate(now, "Europe/Warsaw")
        try await model.repository.apply(Snapshot(
            tasks: [RemoteTask(id: "t1", title: "Invoice", dueDate: HelmDates.addDays(today, -2), createdAt: now, updatedAt: now)],
            settings: ReminderSettings(timezone: "Europe/Warsaw")
        ))
        try await eventually { model.tasks.count == 1 }
        let id = try #require(model.tasks.first?.localId)
        model.selection = id
        return id
    }

    private func shortcut(_ command: TaskCommand) -> String {
        let keys: [KeyEquivalent: String] = [.return: "↩", .delete: "⌫", "t": "T"]
        guard let key = command.key else { return "" }
        let modifiers = command.modifiers
        return (modifiers.contains(.option) ? "⌥" : "") + (modifiers.contains(.shift) ? "⇧" : "")
            + (modifiers.contains(.command) ? "⌘" : "") + (keys[key] ?? "?")
    }

    @Test func eachCommandHasItsOwnKey() {
        let keys = Dictionary(uniqueKeysWithValues: TaskCommand.allCases.map { ($0, shortcut($0)) })
        #expect(keys == [
            .toggleDone: "⌘↩", .toggleNow: "", .toToday: "⌘T", .toTomorrow: "⇧⌘T", .anotherDay: "⌥⌘T", .moveToTrash: "⌘⌫",
        ])
        let used = keys.values.filter { !$0.isEmpty }
        #expect(Set(used).count == used.count)
        // ⌘R (Sync Now), ⇧⌘M (Move to Project…) and ⌥⌘N (New Project…) stay with the rest of the Task menu.
        #expect(Set(used).isDisjoint(with: ["⌘R", "⇧⌘M", "⌥⌘N", "⌘N", "⌘K"]))
    }

    @Test func theCommandsTickOffStartMoveAndTrashTheSelectedTask() async throws {
        let model = try makeModel()
        let id = try await selectedTask(model)
        func task() -> TaskItem? { model.task(id) }

        TaskCommand.toToday.run(in: model)
        try await eventually { task()?.dueDate == model.today }
        TaskCommand.toTomorrow.run(in: model)
        try await eventually { task()?.dueDate == HelmDates.addDays(model.today, 1) }
        TaskCommand.anotherDay.run(in: model)
        #expect(model.reschedulingTask?.id == id)

        #expect(TaskCommand.toggleNow.title(task()) == tr("Work on It Now"))
        TaskCommand.toggleNow.run(in: model)
        try await eventually { task()?.isNow == true }
        #expect(TaskCommand.toggleNow.title(task()) == tr("Not Now"))
        TaskCommand.toggleNow.run(in: model)
        try await eventually { task()?.isNow == false }

        TaskCommand.toggleDone.run(in: model)
        try await eventually { task()?.status == .done }
        #expect(TaskCommand.toggleDone.title(task()) == tr("Mark as Not Done"))
        #expect(!TaskCommand.toggleNow.isEnabled(task()) && !TaskCommand.toToday.isEnabled(task()))
        TaskCommand.toggleDone.run(in: model)
        try await eventually { task()?.status == .todo }

        TaskCommand.moveToTrash.run(in: model)
        try await eventually { task()?.inTrash == true }
        #expect(model.selection == nil)
        #expect(TaskCommand.allCases.allSatisfy { !$0.isEnabled(task()) })
    }

    @Test func nothingSelectedOffersNothing() throws {
        let model = try makeModel()
        #expect(TaskCommand.allCases.allSatisfy { !$0.isEnabled(nil) })
        TaskCommand.moveToTrash.run(in: model)
        #expect(model.selection == nil)
    }
}
