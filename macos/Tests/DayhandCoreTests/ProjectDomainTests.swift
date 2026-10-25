import Foundation
import GRDB
import Testing
@testable import DayhandCore

func project(_ id: String, _ name: String, position: Double = 1024, archived: Bool = false, _ change: (inout Project) -> Void = { _ in }) -> Project {
    var item = Project(localId: id, serverId: id, name: name, position: position, archivedAt: archived ? 1 : nil, createdAt: 0, updatedAt: 0)
    change(&item)
    return item
}

/// The backend's checks of a name, an icon, a note and a position (`convex/lib/projectOps.ts`).
struct ProjectRulesTests {
    let projects = [project("p1", "Strona piekarni"), project("p2", "Café", archived: true)]

    @Test func aNameIsTrimmedInNFCAndUniqueInAnyCaseArchivedProjectsIncluded() {
        #expect(ProjectRules.name("  Dom ", among: projects) == .success("Dom"))
        #expect(ProjectRules.name("strona PIEKARNI", among: projects) == .failure(.taken("Strona piekarni")))
        // "café" with a combining accent is the archived "Café".
        #expect(ProjectRules.name("cafe\u{301}", among: projects) == .failure(.taken("Café")))
        #expect(ProjectRules.name("Strona Piekarni", among: projects, except: "p1") == .success("Strona Piekarni"))
    }

    @Test func emptyLongMultilineAndNoneAreRefused() {
        #expect(ProjectRules.name("   ", among: []) == .failure(.empty))
        #expect(ProjectRules.name(String(repeating: "a", count: 50), among: []) == .success(String(repeating: "a", count: 50)))
        #expect(ProjectRules.name(String(repeating: "a", count: 51), among: []) == .failure(.tooLong))
        #expect(ProjectRules.name("Dom\nPraca", among: []) == .failure(.multiline))
        #expect(ProjectRules.name(" NONE ", among: []) == .failure(.reserved))
    }

    @Test func anIconIsOneEmojiAndBlankIsNone() {
        for emoji in ["🥐", "🇵🇱", "👩🏽‍💻", "❤️"] {
            #expect(ProjectRules.icon(" \(emoji) ") == .some(emoji), "\(emoji)")
        }
        #expect(ProjectRules.icon("  ") == .some(nil))
        for bad in ["a", "1", "#", "🥐🥐", "🥐 x", "ab"] {
            #expect(ProjectRules.icon(bad) == nil, "\(bad)")
        }
    }

    @Test func aNoteIsAtMost2000CharactersAndBlankIsNone() {
        #expect(ProjectRules.note("  ") == .some(nil))
        #expect(ProjectRules.note("Strona i menu") == .some("Strona i menu"))
        #expect(ProjectRules.note(String(repeating: "x", count: 2001)) == nil)
    }

    @Test func positionsGoAtTheEndOrBetweenNeighbours() {
        #expect(ProjectRules.positionAtEnd([]) == 1024)
        #expect(ProjectRules.positionAtEnd([project("a", "A", position: 3000), project("b", "B", position: -5, archived: true)]) == 4024)
        let ordered = [project("a", "A", position: 1024), project("b", "B", position: 2048), project("c", "C", position: 3072)]
        #expect(ProjectRules.position(moving: "c", to: 0, in: ordered) == 0)
        #expect(ProjectRules.position(moving: "a", to: 1, in: ordered) == 2560)
        #expect(ProjectRules.position(moving: "a", to: 2, in: ordered) == 4096)
        #expect(ProjectRules.position(moving: "b", to: 1, in: ordered) == nil)
    }
}

/// `+project` in quick add, next to the date phrase at the end.
struct QuickAddProjectTests {
    static let now = utc("2026-10-22T09:00")
    let projects = [project("p1", "Strona piekarni"), project("p2", "Dom"), project("p3", "Old", archived: true), project("p4", "e-commerce")]

    func parse(_ line: String) -> QuickAddInput {
        QuickAdd.parse(line, now: Self.now, timezone: "Europe/London", projects: projects)
    }

    @Test func aHyphenatedWordInAnyCaseNamesTheProjectAndLeavesTheTitle() {
        let input = parse("Zdjęcia do galerii +strona-piekarni")
        #expect(input.title == "Zdjęcia do galerii")
        #expect(input.projectLocalId == "p1")
        #expect(input.unknownProject == nil)
        #expect(parse("Zdjęcia +STRONA-Piekarni do galerii").title == "Zdjęcia do galerii")
        #expect(parse("Checkout +e-commerce").projectLocalId == "p4")
    }

    @Test func theProjectAndADatePhraseGoTogetherInEitherOrder() {
        let after = parse("Zdjęcia do galerii fri 2pm +dom")
        #expect(after.title == "Zdjęcia do galerii")
        #expect(after.when?.date == "2026-10-23" && after.when?.time == "14:00")
        #expect(after.projectLocalId == "p2")
        let before = parse("Zdjęcia +dom do galerii tomorrow")
        #expect(before.title == "Zdjęcia do galerii")
        #expect(before.when?.date == "2026-10-23")
        #expect(before.projectLocalId == "p2")
    }

    @Test func anUnknownOrArchivedProjectStaysInTheTitleAndADateIsNoProject() {
        let unknown = parse("Kupić mleko +ogrod")
        #expect(unknown.title == "Kupić mleko +ogrod")
        #expect(unknown.projectLocalId == nil)
        #expect(unknown.unknownProject == "ogrod")
        #expect(parse("Notes +old").unknownProject == "old")
        let date = parse("Pay rent +3d")
        #expect(date.title == "Pay rent" && date.when?.date == "2026-10-25")
        #expect(date.unknownProject == nil)
        #expect(parse("C++ +dom").title == "C++")
    }

    @Test func withoutReadingTheDateTheProjectIsStillRead() {
        let input = QuickAdd.parse("Plan next week +dom", now: Self.now, timezone: "Europe/London", projects: projects, readDate: false)
        #expect(input.title == "Plan next week")
        #expect(input.when == nil)
        #expect(input.projectLocalId == "p2")
    }

    /// The cases in `Tests/cases/quickadd-project.json`, the ones the Android app and the TUI are to share.
    @Test func theSharedCasesPass() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("cases/quickadd-project.json")
        let file = try #require(JSONValue.decode(try Data(contentsOf: url)))
        let shared = (file["projects"]?.array ?? []).enumerated().map { index, p in
            project("p\(index)", p["name"]?.string ?? "", archived: p["archived"]?.bool ?? false)
        }
        let now = try #require(file["now"]?.string.map(utc))
        let zone = try #require(file["timezone"]?.string)
        let cases = try #require(file["cases"]?.array)
        #expect(cases.count >= 10)
        for c in cases {
            let line = try #require(c["line"]?.string)
            let input = QuickAdd.parse(line, now: now, timezone: zone, projects: shared)
            let name = input.projectLocalId.flatMap { id in shared.first { $0.localId == id }?.name }
            #expect(input.title == c["title"]?.string, "\(line)")
            #expect(name == c["project"]?.string, "\(line)")
            #expect(input.when?.date == c["date"]?.string, "\(line)")
            #expect(input.unknownProject == c["unknown"]?.string, "\(line)")
        }
    }
}

/// The sidebar's numbers and a project's list, from the local tasks.
struct TaskListTests {
    let today = "2026-10-22"
    let projects = [project("p1", "Strona"), project("p2", "Dom"), project("p3", "Old", archived: true)]

    var tasks: [TaskItem] {
        [
            task("late", due: "2026-10-20") { $0.projectLocalId = "p1"; $0.labels = ["czekam"] },
            task("today", due: today) { $0.projectLocalId = "p1" },
            task("later", due: "2026-10-30") { $0.projectLocalId = "p1" },
            task("someday") { $0.projectLocalId = "p1"; $0.labels = ["czekam", "telefon"] },
            task("done", due: today, status: .done) { $0.projectLocalId = "p1"; $0.completedAt = 5; $0.labels = ["dom"] },
            task("loose", due: "2026-10-21"),
            task("unknown project") { $0.projectLocalId = "gone" },
            task("archived task") { $0.projectLocalId = "p2"; $0.archivedAt = 1 },
            task("trashed") { $0.projectLocalId = "p2"; $0.deletedAt = 1; $0.labels = ["kosz"] },
            task("in old") { $0.projectLocalId = "p3" },
        ]
    }

    @Test func countsAreOpenTasksWithTheirOverdueOnesPerPlace() {
        let counts = sidebarCounts(tasks, projects: projects, today: today)
        #expect(counts.all == .init(open: 7, overdue: 2))
        #expect(counts.project("p1") == .init(open: 4, overdue: 1))
        #expect(counts.project("p2") == .init(open: 0, overdue: 0))
        #expect(counts.project("p3") == .init(open: 1, overdue: 0))
        #expect(counts.noProject == .init(open: 2, overdue: 1))
        #expect(counts.label("czekam") == .init(open: 2, overdue: 1))
        #expect(counts.label("dom") == .init(open: 0, overdue: 0))
        #expect(counts.labelNames == ["czekam", "dom", "telefon"])
        #expect(counts.archivedProjects == 1)
    }

    @Test func aProjectsListHasItsSectionsInScheduleOrder() {
        let s = taskListSections(tasks, filter: .project("p1"), projects: Set(projects.map(\.localId)), nowMs: utc("2026-10-22T09:00"), timezone: "Europe/London")
        #expect(ids(s.overdue) == ["late"])
        #expect(ids(s.today) == ["today"])
        #expect(ids(s.later) == ["later"])
        #expect(ids(s.noDay) == ["someday"])
        #expect(ids(s.done) == ["done"])
        #expect(s.openCount == 4 && s.doneCount == 1)
        let none = taskListSections(tasks, filter: .noProject, projects: Set(projects.map(\.localId)), nowMs: utc("2026-10-22T09:00"), timezone: "Europe/London")
        #expect(ids(none.overdue + none.noDay) == ["loose", "unknown project"])
        let label = taskListSections(tasks, filter: .label("czekam"), projects: [], nowMs: utc("2026-10-22T09:00"), timezone: "Europe/London")
        #expect(ids(label.overdue + label.noDay) == ["late", "someday"])
    }
}

/// The server's projects merged into the rows, as tasks are.
struct ProjectMergerTests {
    @Test func newProjectsArriveAndNewerServerCopiesWinWhereNothingWaits() {
        let local = [project("p1", "Dom") { $0.serverUpdatedAt = 1; $0.updatedAt = 1 }]
        let remote = [
            RemoteProject(id: "p1", name: "Dom i ogród", color: .green, position: 10, createdAt: 0, updatedAt: 2),
            RemoteProject(id: "p2", name: "Praca", icon: "💼", position: 20, createdAt: 0, updatedAt: 2),
        ]
        let plan = ProjectMerger.merge(local: local, pending: [], remote: remote, nowMs: 100)
        #expect(plan.upserts.map(\.name) == ["Dom i ogród", "Praca"])
        #expect(plan.upserts[0].color == .green && plan.upserts[1].localId == "p2" && plan.upserts[1].serverUpdatedAt == 2)
        #expect(plan.deletes.isEmpty)
    }

    @Test func aWaitingRenameKeepsItsNameAndAProjectGoneFromTheServerGoes() {
        let local = [project("p1", "Mine") { $0.serverUpdatedAt = 1 }, project("p2", "Deleted elsewhere") { $0.serverUpdatedAt = 1 }]
        let rename = OutboxOp(opId: "o1", mutation: Mutations.updateProject, argsJson: #"{"projectId":"p1","name":"Mine","clientId":"o1"}"#, taskLocalId: nil, clientId: "o1", createdAt: 1)
        let remote = [RemoteProject(id: "p1", name: "Theirs", color: .red, position: 5, createdAt: 0, updatedAt: 9)]
        let plan = ProjectMerger.merge(local: local, pending: [rename], remote: remote, nowMs: 100)
        #expect(plan.upserts.first?.name == "Mine")
        #expect(plan.upserts.first?.color == .red)
        #expect(plan.deletes == ["p2"])
    }

    @Test func aProjectMadeHereMeetsItsServerCopyByClientIdAndAFreshOneWaits() {
        let mine = Project(localId: "c1", clientId: "c1", name: "Dom", position: 1024, createdAt: 90, updatedAt: 90)
        let fresh = Project(localId: "c2", clientId: "c2", name: "Fresh", position: 2048, createdAt: 95, updatedAt: 95)
        let remote = [RemoteProject(id: "s1", clientId: "c1", name: "Dom", position: 1024, createdAt: 91, updatedAt: 91)]
        let plan = ProjectMerger.merge(local: [mine, fresh], pending: [], remote: remote, nowMs: 100)
        #expect(plan.upserts.map(\.localId) == ["c1"])
        #expect(plan.upserts.first?.serverId == "s1")
        #expect(plan.deletes.isEmpty)
    }

    @Test func aProjectWhoseNameWasTakenJoinsTheServersProjectOfThatName() {
        let refused = Project(localId: "c1", clientId: "c1", name: "dom", position: 1024, createdAt: 90, updatedAt: 90)
        let remote = [RemoteProject(id: "s9", clientId: "other-mac", name: "Dom", position: 1024, createdAt: 50, updatedAt: 50)]
        let plan = ProjectMerger.merge(local: [refused], pending: [], remote: remote, nowMs: 100)
        #expect(plan.upserts.count == 1)
        #expect(plan.upserts.first?.localId == "c1" && plan.upserts.first?.serverId == "s9" && plan.upserts.first?.name == "Dom")
        // Not into an archived project: that one would refuse the tasks.
        let archived = [RemoteProject(id: "s9", name: "Dom", position: 1024, archivedAt: 3, createdAt: 50, updatedAt: 50)]
        #expect(ProjectMerger.merge(local: [refused], pending: [], remote: archived, nowMs: 100).upserts.first?.localId == "s9")
    }

    @Test func aProjectBeingDeletedStaysHiddenAndItsTasksReadAsMoved() {
        let removing = project("p1", "Dom") { $0.removing = true; $0.serverUpdatedAt = 1 }
        let delete = OutboxOp(opId: "o1", mutation: Mutations.deleteProject, argsJson: #"{"projectId":"p1","moveTasksTo":"p2","clientId":"o1"}"#, taskLocalId: nil, clientId: "o1", createdAt: 1)
        let remote = [RemoteProject(id: "p1", name: "Dom", position: 1, createdAt: 0, updatedAt: 5)]
        let plan = ProjectMerger.merge(local: [removing], pending: [delete], remote: remote, nowMs: 100)
        #expect(plan.upserts.isEmpty && plan.deletes.isEmpty)
        let mapping = ProjectMapping(projects: [removing, project("p2", "Praca")], pending: [delete])
        #expect(mapping.localId("p1") == "p2")
        #expect(mapping.localId("p2") == "p2")
        #expect(mapping.localId("not merged yet") == "not merged yet")
        #expect(mapping.localId(nil) == nil)
        let toNone = OutboxOp(opId: "o2", mutation: Mutations.deleteProject, argsJson: #"{"projectId":"p1","moveTasksTo":"none","clientId":"o2"}"#, taskLocalId: nil, clientId: "o2", createdAt: 1)
        #expect(ProjectMapping(projects: [removing], pending: [toNone]).localId("p1") == nil)
    }

    @Test func aTasksProjectReadsAsTheLocalProjectAndAWaitingMoveKeepsIt() {
        let local = task("t") { $0.serverId = "s1"; $0.serverUpdatedAt = 1; $0.projectLocalId = "c1" }
        let mine = Project(localId: "c1", serverId: "srvP1", clientId: "c1", name: "Dom", position: 1, createdAt: 0, updatedAt: 0)
        let mapping = ProjectMapping(projects: [mine], pending: [])
        let remote = RemoteTask(id: "s1", title: "t", createdAt: 0, updatedAt: 2, projectId: "srvP1")
        #expect(SnapshotMerger.merge(local: [local], pending: [], remote: [remote], nowMs: 10, projects: mapping).upserts.first?.projectLocalId == "c1")
        let elsewhere = RemoteTask(id: "s1", title: "t", createdAt: 0, updatedAt: 3)
        #expect(SnapshotMerger.merge(local: [local], pending: [], remote: [elsewhere], nowMs: 10, projects: mapping).upserts.first?.projectLocalId == nil)
        let move = OutboxOp(opId: "o1", mutation: Mutations.update, argsJson: #"{"projectId":"c1","clientId":"o1"}"#, taskLocalId: "t", clientId: "o1", createdAt: 1)
        #expect(SnapshotMerger.merge(local: [local], pending: [move], remote: [elsewhere], nowMs: 10, projects: mapping).upserts.first?.projectLocalId == "c1")
    }
}

/// The database of 0.3.0 (migrations v1 to v3) moves on to projects (v4) without losing a task.
struct ProjectMigrationTests {
    @Test func theMigrationKeepsEveryTaskAndAddsProjects() async throws {
        let queue = try DatabaseQueue()
        try AppDatabase.inMemory().migrator.migrate(queue, upTo: "v3")
        try await queue.write { db in
            try db.execute(sql: """
                INSERT INTO task (localId, serverId, title, status, createdAt, updatedAt, serverUpdatedAt, labels, links, checklist, ref, acceptance, dependsOn)
                VALUES ('old', 's1', 'From 0.3', 'doing', 1, 2, 2, '["home"]', '[]', '[]', 42, '[]', '[]')
                """)
            try db.execute(sql: """
                INSERT INTO outbox (opId, mutation, argsJson, taskLocalId, clientId, createdAt)
                VALUES ('o1', 'app:update', '{"title":"Waiting","clientId":"o1"}', 'old', 'o1', 3)
                """)
        }
        let repo = TaskRepository(database: try AppDatabase(queue))
        let old = try #require(try await repo.task("old"))
        #expect(old.title == "From 0.3" && old.status == .doing && old.labels == ["home"] && old.ref == 42)
        #expect(old.projectLocalId == nil)
        #expect(old.serverUpdatedAt == nil)
        #expect(try await repo.pendingOps().map(\.mutation) == [Mutations.update])
        #expect(try await repo.projects().isEmpty)
        #expect(try await repo.projectSupport() == .unknown)

        try await repo.apply(Snapshot(
            tasks: [RemoteTask(id: "s1", title: "From 0.3", status: "doing", createdAt: 1, updatedAt: 2, labels: ["home"], ref: 42, projectId: "srvP")],
            projects: [RemoteProject(id: "srvP", name: "Dom", color: .teal, position: 1024, createdAt: 1, updatedAt: 1)]
        ))
        #expect(try await repo.task("old")?.projectLocalId == "srvP")
        #expect(try await repo.projects().map(\.name) == ["Dom"])
        #expect(try await repo.projectSupport() == .supported)
        let columns = try await queue.read { db in try db.columns(in: "project").map(\.name) }
        #expect(Set(["localId", "serverId", "name", "color", "icon", "note", "position", "archivedAt", "removing"]).isSubset(of: Set(columns)))
    }
}

/// Projects as the app layer sends them.
struct RemoteProjectTests {
    @Test func projectsAreReadWithNumbersAsDoublesAndUnknownColorsAsNone() throws {
        let json = try #require(JSONValue.decode(#"""
        [{"id":"p1","name":"Strona piekarni","color":"amber","icon":"🥐","note":"Menu","position":1024.0,"archived":false,"createdAt":1.0,"updatedAt":2.0,"clientId":"c1"},
         {"id":"p2","name":"Old","color":"neon","position":2048.5,"archivedAt":7.0,"archived":true,"createdAt":1.0,"updatedAt":2.0},
         {"name":"no id"}]
        """#))
        let projects = RemoteJSON.projects(json)
        #expect(projects == [
            RemoteProject(id: "p1", clientId: "c1", name: "Strona piekarni", color: .amber, icon: "🥐", note: "Menu", position: 1024, createdAt: 1, updatedAt: 2),
            RemoteProject(id: "p2", name: "Old", position: 2048.5, archivedAt: 7, createdAt: 1, updatedAt: 2),
        ])
        let task = try #require(JSONValue.decode(#"{"id":"s1","title":"T","createdAt":1,"updatedAt":2,"projectId":"p1"}"#).flatMap(RemoteJSON.task))
        #expect(task.projectId == "p1")
    }

    @Test func aServerWithoutAFunctionIsToldApartFromARefusal() {
        #expect(RemoteJSON.isMissingFunction("[Request ID: f7] Server Error\nCould not find public function for 'app:listProjects'.\n"))
        #expect(!RemoteJSON.isMissingFunction("Project \"Dom\" not found"))
        #expect(RemoteJSON.refusesProjectField("ArgumentValidationError: Object contains extra field `projectId` that is not in the validator."))
        #expect(RemoteJSON.refusesProject("Uncaught ConvexError: Project \"Web\" is archived; restore it first"))
        #expect(RemoteJSON.refusesProject("Project \"Web\" not found"))
        #expect(!RemoteJSON.refusesProject("Task not found"))
        #expect(RemoteJSON.nameTakenByActiveProject("A project named \"Dom\" already exists"))
        #expect(!RemoteJSON.nameTakenByActiveProject("A project named \"Dom\" already exists (archived)"))
    }
}
