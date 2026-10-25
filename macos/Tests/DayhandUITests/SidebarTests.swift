import AppKit
import DayhandCore
import DayhandLocalization
import Foundation
import Testing
@testable import DayhandUI

/// The sidebar's places, quick add in them, dropping a task on a project, the task panel's height and the project
/// colors, through the app's model on a database in memory.
@MainActor
struct SidebarTests {
    private func makeModel() throws -> AppModel {
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        defaults.register(defaults: [AppModel.Keys.useOffline: true, AppModel.Keys.language: "en"])
        return AppModel(AppEnvironment(
            database: try AppDatabase.inMemory(), credentials: MemoryCredentialStore(), notifications: false, defaults: defaults
        ))
    }

    /// Waits for the model to see a change the repository made (its observations run on their own).
    private func eventually(_ condition: () -> Bool) async throws {
        for _ in 0..<100 where !condition() {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        #expect(condition())
    }

    private func seeded(_ model: AppModel) async throws -> (bakery: String, home: String) {
        let now = Clock.nowMs()
        let zone = "Europe/Warsaw"
        let today = HelmDates.localDate(now, zone)
        let projects = [
            RemoteProject(id: "p1", name: "Bakery website", color: .amber, position: 1, createdAt: now, updatedAt: now),
            RemoteProject(id: "p2", name: "Home", position: 2, createdAt: now, updatedAt: now),
            RemoteProject(id: "p3", name: "Old", position: 3, archivedAt: now, createdAt: now, updatedAt: now),
        ]
        let tasks = [
            RemoteTask(id: "t1", title: "Invoice", dueDate: HelmDates.addDays(today, -1), createdAt: now, updatedAt: now, labels: ["work"], projectId: "p1"),
            RemoteTask(id: "t2", title: "Photos", createdAt: now, updatedAt: now, projectId: "p1"),
            RemoteTask(id: "t3", title: "Milk", dueDate: today, createdAt: now, updatedAt: now),
        ]
        try await model.repository.apply(Snapshot(tasks: tasks, settings: ReminderSettings(timezone: zone), projects: projects))
        try await eventually { model.projects.count == 3 && model.tasks.count == 3 }
        return (model.projects[0].localId, model.projects[1].localId)
    }

    @Test func theSidebarCountsOpenTasksAndListsAProjectInSections() async throws {
        let model = try makeModel()
        let (bakery, _) = try await seeded(model)
        #expect(model.counts.all == SidebarCounts.Count(open: 3, overdue: 1))
        #expect(model.counts.project(bakery) == SidebarCounts.Count(open: 2, overdue: 1))
        #expect(model.counts.noProject.open == 1)
        #expect(model.activeProjects.map(\.name) == ["Bakery website", "Home"])
        #expect(model.archivedProjects.map(\.name) == ["Old"])
        #expect(model.shortcutProjects.count == 2)

        let invoice = try #require(model.tasks.first { $0.title == "Invoice" })
        #expect(model.projectLine(invoice)?.localId == bakery)
        model.show(.project(bakery))
        #expect(model.projectLine(invoice) == nil)
        #expect(model.list.overdue.map(\.title) == ["Invoice"])
        #expect(model.list.noDay.map(\.title) == ["Photos"])
        model.search = "phot"
        #expect(model.list.overdue.isEmpty && model.list.noDay.map(\.title) == ["Photos"])
    }

    @Test func quickAddInAProjectAddsToItWithoutADayAndPlusWordsWinOverThePlace() async throws {
        let model = try makeModel()
        let (bakery, home) = try await seeded(model)
        model.show(.project(bakery))
        #expect(model.quickAdd("Menu photos", in: model.place))
        #expect(model.quickAdd("Hoover +home", in: model.place))
        #expect(model.quickAdd("Call mum"))
        try await eventually { model.tasks.count == 6 }
        let added = { (title: String) in model.tasks.first { $0.title == title } }
        #expect(added("Menu photos")?.projectLocalId == bakery && added("Menu photos")?.dueDate == nil)
        #expect(added("Hoover")?.projectLocalId == home)
        #expect(added("Call mum")?.projectLocalId == nil && added("Call mum")?.dueDate == model.today)

        let preview = try #require(QuickAddPreview.of("Hoover +gardn fri", readPhrase: true, model: model, place: .project(bakery)))
        #expect(preview.project == "Bakery website" && preview.unknownProject == "gardn" && preview.phrase != nil)
    }

    @Test func quickAddInAnArchivedProjectAddsTheTaskOutsideIt() async throws {
        let model = try makeModel()
        _ = try await seeded(model)
        let old = try #require(model.archivedProjects.first)
        model.show(.project(old.localId))
        let preview = try #require(QuickAddPreview.of("Sweep", readPhrase: true, model: model, place: model.place))
        #expect(preview.project == nil)
        #expect(model.quickAdd("Sweep", in: model.place))
        try await eventually { model.tasks.contains { $0.title == "Sweep" } }
        #expect(model.tasks.first { $0.title == "Sweep" }?.projectLocalId == nil)
        #expect(model.alert == nil)
    }

    @Test func moveToProjectTakesATaskOutOfTheTrashOnly() async throws {
        let model = try makeModel()
        _ = try await seeded(model)
        let milk = try #require(model.tasks.first { $0.title == "Milk" })
        #expect(!model.canMoveToProject(nil))
        #expect(model.canMoveToProject(milk.localId))
        model.moveToTrash(milk.localId)
        try await eventually { model.task(milk.localId)?.inTrash == true }
        #expect(!model.canMoveToProject(milk.localId))
    }

    @Test func todayNarrowedByASearchShowsNothingWhenNothingMatches() async throws {
        let model = try makeModel()
        _ = try await seeded(model)
        #expect(model.searchedToday.today.map(\.title) == ["Milk"])
        model.search = "xyz"
        #expect(!model.sections.isEmpty)
        #expect(model.searchedToday.isEmpty && model.searchedToday.done.isEmpty)
        #expect(model.todayPlaceholder == nil)
        model.search = "inv"
        #expect(model.searchedToday.overdue.map(\.title) == ["Invoice"] && model.searchedToday.today.isEmpty)
        #expect(model.todayPlaceholder == nil)
        model.search = ""
        #expect(model.todayPlaceholder == nil)
        let milk = try #require(model.tasks.first { $0.title == "Milk" })
        model.moveToTrash(milk.localId)
        try await eventually { model.sections.today.isEmpty }
        #expect(model.todayPlaceholder == "Nothing else planned for today.")
    }

    @Test func aTaskDroppedOnAProjectMovesThereAndOnNoProjectLeavesIt() async throws {
        let model = try makeModel()
        let (bakery, home) = try await seeded(model)
        let milk = try #require(model.tasks.first { $0.title == "Milk" })
        #expect(model.drop(milk.localId, on: .project(home)))
        try await eventually { model.task(milk.localId)?.projectLocalId == home }
        #expect(!model.drop(milk.localId, on: .project(home)))
        let old = try #require(model.archivedProjects.first)
        #expect(!model.drop(milk.localId, on: .project(old.localId)))
        #expect(!model.drop(milk.localId, on: .trash))
        let invoice = try #require(model.tasks.first { $0.title == "Invoice" })
        #expect(model.drop(invoice.localId, on: .noProject))
        try await eventually { model.task(invoice.localId)?.projectLocalId == nil }
        #expect(model.drop(invoice.localId, on: .today))
        try await eventually { model.task(invoice.localId)?.dueDate == model.today }
        #expect(try await model.repository.pendingOps().count == 3)
        _ = bakery
    }

    @Test func aSelectedTaskThatIsNotInTheNewPlaceIsLetGo() async throws {
        let model = try makeModel()
        let (bakery, home) = try await seeded(model)
        let photos = try #require(model.tasks.first { $0.title == "Photos" })
        model.show(.project(bakery))
        model.selection = photos.localId
        model.show(.all)
        #expect(model.selection == photos.localId)
        model.show(.project(home))
        #expect(model.selection == nil)
    }

    @Test func aServerWithoutProjectsHidesThemAndLeavesAProjectPlace() async throws {
        let model = try makeModel()
        let (bakery, _) = try await seeded(model)
        model.show(.project(bakery))
        #expect(model.showsProjects)
        // A snapshot from a 0.12 server: no projects.
        try await model.repository.apply(Snapshot(tasks: [], settings: ReminderSettings(timezone: "Europe/Warsaw"), projects: nil))
        try await eventually { !model.showsProjects }
        #expect(model.place == .today)
        #expect(model.counts.projects.isEmpty)
    }

    @Test func projectChangesWithoutAServerNeedAConnectionAndQueueNothing() async throws {
        let model = try makeModel()
        let (bakery, home) = try await seeded(model)
        let needsConnection = "Requires a connection to the server."
        #expect(await model.saveProject(nil, name: "Garden", color: .green, icon: "", note: "") == needsConnection)
        #expect(await model.saveProject(bakery, name: "Bakery", color: .amber, icon: "", note: "") == needsConnection)
        model.show(.project(bakery))
        #expect(await model.deleteProject(bakery, moveTasksTo: home) == needsConnection)
        model.setArchived(bakery, true)
        #expect(model.alert == needsConnection)
        // The place stays: nothing changed.
        #expect(model.place == .project(bakery))
        #expect(model.projects.map(\.name) == ["Bakery website", "Home", "Old"])
        #expect(model.activeProjects.count == 2)
        #expect(try await model.repository.pendingOps().isEmpty)
    }

    @Test func placesSayWhatTheyListAndWhereQuickAddPutsATask() {
        let open = TaskItem(localId: "a", title: "A", createdAt: 0, updatedAt: 0, projectLocalId: "p")
        let deleted = TaskItem(localId: "b", title: "B", createdAt: 0, updatedAt: 0, deletedAt: 5)
        let archived = TaskItem(localId: "c", title: "C", archivedAt: 3, createdAt: 0, updatedAt: 0)
        let projects: Set<String> = ["p"]
        #expect(Place.project("p").lists(open, projects: projects) && !Place.noProject.lists(open, projects: projects))
        #expect(Place.trash.lists(deleted, projects: projects) && !Place.all.lists(deleted, projects: projects))
        #expect(Place.done.lists(archived, projects: projects) && !Place.inbox.lists(open, projects: projects))
        let active = Project(localId: "p", name: "P", position: 1, createdAt: 0, updatedAt: 0)
        let old = Project(localId: "q", name: "Q", position: 2, archivedAt: 1, createdAt: 0, updatedAt: 0)
        #expect(QuickAddContext(.today, today: "2026-10-25", projects: []) == QuickAddContext(.trash, today: "2026-10-25", projects: []))
        #expect(QuickAddContext(.project("p"), today: "2026-10-25", projects: [active]).date == nil)
        #expect(QuickAddContext(.project("p"), today: "2026-10-25", projects: [active]).project == "p")
        #expect(QuickAddContext(.project("q"), today: "2026-10-25", projects: [active, old]).project == nil)
    }

    @Test func thePanelFollowsTheWindowUntilDraggedAndLeavesTheListRoom() {
        #expect(TaskPanel.height(stored: 0, available: 650) == 260)
        #expect(TaskPanel.height(stored: 0, available: 450) == TaskPanel.minHeight)
        #expect(TaskPanel.height(stored: 0, available: 2000) == 380)
        #expect(TaskPanel.height(stored: 600, available: 650) == 480)
        #expect(TaskPanel.height(stored: 50, available: 650) == TaskPanel.minHeight)
    }

    @Test func theEditorChecksAndThePickerFilters() {
        let home = Project(localId: "h", name: "Home", position: 1, createdAt: 0, updatedAt: 0)
        let bakery = Project(localId: "b", name: "Strona piekarni", position: 2, createdAt: 0, updatedAt: 0)
        Localization.$override.withValue(Localization(language: "en", region: "GB")) {
            #expect(ProjectEditorCheck(name: "Garden", icon: "🌱", note: "", projects: [home], editing: nil).isValid)
            #expect(ProjectEditorCheck(name: "home", icon: "", note: "", projects: [home], editing: nil).nameProblem != nil)
            #expect(ProjectEditorCheck(name: "Home", icon: "", note: "", projects: [home], editing: "h").isValid)
            #expect(ProjectEditorCheck(name: "Garden", icon: "ab", note: "", projects: [], editing: nil).iconProblem == "The icon must be a single emoji.")
            #expect(ProjectEditorCheck(name: "Garden", icon: "", note: String(repeating: "x", count: 2001), projects: [], editing: nil).noteProblem
                == "The note must be at most 2,000 characters.")
        }
        #expect(ProjectPicker.matching([home, bakery], "PIEK").map(\.localId) == ["b"])
        #expect(ProjectPicker.matching([home, bakery], " ").count == 2)
        #expect(TaskDrag.localId(TaskDrag.payload("t1")) == "t1")
        #expect(TaskDrag.localId("t1") == nil)
    }

    /// Every project color keeps 3:1 against the main area and the cards, light and dark (WCAG 1.4.11).
    @Test func projectColorsStandOutInBothAppearances() throws {
        for (name, backgrounds) in [(NSAppearance.Name.aqua, [NSColor.dayhandCanvas, .dayhandCard]), (.darkAqua, [NSColor.dayhandCanvas, .dayhandCard])] {
            let appearance = try #require(NSAppearance(named: name))
            for token in ProjectColor.allCases {
                for background in backgrounds {
                    let ratio = contrast(ProjectColors.nsColor(token), background, in: appearance)
                    #expect(ratio >= 3, "\(token) on \(name.rawValue): \(ratio)")
                }
            }
        }
    }

    private func contrast(_ a: NSColor, _ b: NSColor, in appearance: NSAppearance) -> Double {
        var result = 0.0
        appearance.performAsCurrentDrawingAppearance {
            let la = luminance(a), lb = luminance(b)
            result = (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
        }
        return result
    }

    private func luminance(_ color: NSColor) -> Double {
        guard let rgb = color.usingColorSpace(.sRGB) else { return 0 }
        func channel(_ c: CGFloat) -> Double {
            let v = Double(c)
            return v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(rgb.redComponent) + 0.7152 * channel(rgb.greenComponent) + 0.0722 * channel(rgb.blueComponent)
    }
}
