import Foundation
import Testing
@testable import DayhandCore

/// Project changes write the row and queue their mutation together, as task changes do.
struct ProjectRepositoryTests {
    let clock = TestClock(utc("2026-10-22T09:00"))
    let ids = TestIds()

    func repository() throws -> TaskRepository {
        let clock = clock, ids = ids
        return TaskRepository(database: try AppDatabase.inMemory(), clock: { clock.now }, newId: { ids.next() })
    }

    func args(_ op: OutboxOp) -> JSONValue? { JSONValue.decode(op.argsJson) }

    @Test func aNewProjectGoesLastAndQueuesAddProjectWithItsLocalIdAsClientId() async throws {
        let repo = try repository()
        let first = try await repo.addProject(name: " Strona piekarni ", color: .amber, icon: "🥐", note: "Menu")
        let second = try await repo.addProject(name: "Dom")
        #expect(first.localId == "id-1" && first.name == "Strona piekarni" && first.position == 1024)
        #expect(second.position == 2048)
        #expect(try await repo.projects().map(\.name) == ["Strona piekarni", "Dom"])
        let ops = try await repo.pendingOps()
        #expect(ops.map(\.mutation) == [Mutations.addProject, Mutations.addProject])
        #expect(args(ops[0]) == ["name": "Strona piekarni", "color": "amber", "icon": "🥐", "note": "Menu", "clientId": "id-1"])
        #expect(ops[0].clientId == first.localId)
        await #expect(throws: RepositoryError.invalid("There is already a project named “Dom”.")) { try await repo.addProject(name: "DOM") }
        await #expect(throws: RepositoryError.self) { try await repo.addProject(name: "Ikona", icon: "ab") }
        #expect(try await repo.pendingOps().count == 2)
    }

    @Test func aTaskGoesIntoAProjectWhenAddedOrMovedAndOutWithNull() async throws {
        let repo = try repository()
        let home = try await repo.addProject(name: "Dom")
        let t = try await repo.add(title: "Odkurzyć", dueDate: nil, dueTime: nil, projectLocalId: home.localId)
        #expect(t.projectLocalId == home.localId)
        let other = try await repo.add(title: "Mleko", dueDate: nil, dueTime: nil)
        try await repo.setProject(other.localId, home.localId)
        try await repo.setProject(other.localId, home.localId)
        try await repo.setProject(t.localId, nil)
        #expect(try await repo.task(other.localId)?.projectLocalId == home.localId)
        #expect(try await repo.task(t.localId)?.projectLocalId == nil)
        let ops = try await repo.pendingOps()
        #expect(ops.map(\.mutation) == [Mutations.addProject, Mutations.add, Mutations.add, Mutations.update, Mutations.update])
        #expect(args(ops[1])?["projectId"] == .string(home.localId))
        #expect(args(ops[3])?["projectId"] == .string(home.localId))
        #expect(args(ops[4])?["projectId"] == .null)
    }

    @Test func anArchivedProjectTakesNoNewTaskButKeepsItsOwn() async throws {
        let repo = try repository()
        let home = try await repo.addProject(name: "Dom")
        let t = try await repo.add(title: "In it", dueDate: nil, dueTime: nil, projectLocalId: home.localId)
        try await repo.setArchived(home.localId, true)
        #expect(try await repo.projects().first?.isArchived == true)
        await #expect(throws: RepositoryError.invalid("“Dom” is archived; restore it first.")) {
            try await repo.add(title: "New", dueDate: nil, dueTime: nil, projectLocalId: home.localId)
        }
        #expect(try await repo.task(t.localId)?.projectLocalId == home.localId)
        try await repo.setArchived(home.localId, false)
        let last = try #require(try await repo.pendingOps().last)
        #expect(args(last)?["archived"] == false && args(last)?["projectId"] == .string(home.localId))
    }

    @Test func editsSendOnlyWhatChanged() async throws {
        let repo = try repository()
        let home = try await repo.addProject(name: "Dom", color: .green)
        try await repo.updateProject(home.localId, name: "Dom", color: .green, icon: "", note: "")
        try await repo.updateProject(home.localId, name: "Dom i ogród", color: nil, icon: "🏡", note: "")
        try await repo.moveProject(home.localId, to: 10)
        let ops = try await repo.pendingOps()
        #expect(ops.map(\.mutation) == [Mutations.addProject, Mutations.updateProject, Mutations.updateProject])
        let edit = try #require(args(ops[1])?.object)
        #expect(Set(edit.keys) == ["projectId", "name", "color", "icon", "clientId"])
        #expect(edit["color"] == .null && edit["icon"] == "🏡")
        #expect(args(ops[2])?["position"] == 10)
        let edited = try #require(try await repo.projects().first)
        #expect(edited.name == "Dom i ogród" && edited.color == nil && edited.icon == "🏡" && edited.position == 10)
    }

    @Test func deletingMovesTheTasksAtOnceAndHidesTheProjectUntilTheServerHasIt() async throws {
        let repo = try repository()
        let home = try await repo.addProject(name: "Dom")
        let work = try await repo.addProject(name: "Praca")
        let t = try await repo.add(title: "T", dueDate: nil, dueTime: nil, projectLocalId: home.localId)
        try await repo.deleteProject(home.localId, moveTasksTo: work.localId)
        #expect(try await repo.projects().map(\.name) == ["Praca"])
        #expect(try await repo.task(t.localId)?.projectLocalId == work.localId)
        let delete = try #require(try await repo.pendingOps().last)
        #expect(args(delete) == ["projectId": .string(home.localId), "moveTasksTo": .string(work.localId), "clientId": .string(delete.clientId)])
        await #expect(throws: RepositoryError.self) { try await repo.deleteProject(work.localId, moveTasksTo: work.localId) }
    }

    @Test func aRepeatingTaskDoneWithoutAServerKeepsItsProjectInTheNextOccurrence() async throws {
        let clock = clock, ids = ids
        let repo = TaskRepository(database: try AppDatabase.inMemory(), clock: { clock.now }, newId: { ids.next() }, repeatsOnMac: { true })
        let home = try await repo.addProject(name: "Dom")
        let t = try await repo.add(title: "Podlać kwiaty", dueDate: "2026-10-22", dueTime: nil, projectLocalId: home.localId)
        try await repo.setRepeat(t.localId, RepeatRule(every: .week))
        try await repo.complete(t.localId)
        let next = try #require(try await repo.allTasks().first { $0.localId != t.localId })
        #expect(next.dueDate == "2026-10-29")
        #expect(next.projectLocalId == home.localId)
        let add = try #require(try await repo.pendingOps().last)
        #expect(add.mutation == Mutations.add && args(add)?["projectId"] == .string(home.localId))
    }
}

/// Projects through the outbox and the poll, against the fake server: offline first, in order, with the right ids.
struct ProjectSyncTests {
    let clock = TestClock(utc("2026-10-22T09:00"))
    let server = FakeServer()

    func setUp() throws -> (TaskRepository, SyncEngine) {
        let clock = clock, ids = TestIds()
        server.clock = { clock.now }
        let repo = TaskRepository(database: try AppDatabase.inMemory(), clock: { clock.now }, newId: { ids.next() })
        let tokens = DeviceTokens(
            serverUrl: FakeServer.site, deviceToken: FakeServer.deviceToken, api: PairingAPI(transport: server),
            onRevoked: {}, clock: { clock.now }
        )
        let remote = ConvexRemote(deploymentUrl: FakeServer.cloud, tokens: tokens, transport: server)
        return (repo, SyncEngine(repository: repo, sender: remote, source: remote, onStatus: { _ in }))
    }

    /// The arguments of each mutation sent, in order.
    func sent() -> [(String, JSONValue)] {
        server.requests.filter { $0.path == "/api/mutation" }.map { ($0.body["path"]?.string ?? "", $0.body["args"]?.array?.first ?? .null) }
    }

    @Test func aProjectMadeOfflineAndATaskInItReachTheServerInOrderWithTheServerId() async throws {
        let (repo, engine) = try setUp()
        server.offline = true
        let bakery = try await repo.addProject(name: "Strona piekarni", color: .amber)
        let t = try await repo.add(title: "Zdjęcia do galerii", dueDate: nil, dueTime: nil, projectLocalId: bakery.localId)
        let moved = try await repo.add(title: "Menu", dueDate: nil, dueTime: nil)
        try await repo.setProject(moved.localId, bakery.localId)
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }

        server.offline = false
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(try await repo.pendingOps().isEmpty)
        let onServer = try #require(server.project(named: "Strona piekarni"))
        let projectId = try #require(onServer["id"]?.string)
        #expect(onServer["color"] == "amber")
        #expect(sent().map(\.0) == [Mutations.addProject, Mutations.add, Mutations.add, Mutations.update])
        #expect(sent()[1].1["projectId"] == .string(projectId))
        #expect(sent()[3].1["projectId"] == .string(projectId))
        #expect(server.task(titled: "Zdjęcia do galerii")?["projectId"] == .string(projectId))
        #expect(server.task(titled: "Menu")?["projectId"] == .string(projectId))
        // The rows keep their local ids and know the server's.
        let row = try #require(try await repo.projects().first)
        #expect(row.localId == bakery.localId && row.serverId == projectId)
        #expect(try await repo.task(t.localId)?.projectLocalId == bakery.localId)
        #expect(try await repo.projectSupport() == .supported)
    }

    @Test func projectsMadeElsewhereArriveWithTheirTasksAndChangesHereGoBack() async throws {
        let (repo, engine) = try setUp()
        let home = server.addProjectElsewhere("Dom")
        let id = server.addElsewhere("Odkurzyć")
        server.editElsewhere(id, ["projectId": .string(home)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let local = try #require(try await repo.projects().first)
        #expect(local.localId == home && local.serverId == home)
        let task = try #require(try await repo.allTasks().first { $0.serverId == id })
        #expect(task.projectLocalId == home)

        try await repo.updateProject(home, name: "Dom i ogród", color: .green, icon: "", note: "")
        try await repo.setArchived(home, true)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.project(named: "Dom i ogród")?["archived"] == true)
        #expect(server.project(named: "Dom i ogród")?["color"] == "green")

        try await repo.deleteProject(home, moveTasksTo: nil)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.allProjects.isEmpty)
        #expect(server.task(titled: "Odkurzyć")?["projectId"] == nil)
        #expect(try await repo.projects().isEmpty)
        #expect(try await repo.allTasks().first { $0.serverId == id }?.projectLocalId == nil)
    }

    @Test func twoMacsMakingTheSameProjectOfflineEndUpInOne() async throws {
        let (repo, engine) = try setUp()
        server.offline = true
        let mine = try await repo.addProject(name: "dom")
        let t = try await repo.add(title: "Mine", dueDate: nil, dueTime: nil, projectLocalId: mine.localId)
        server.offline = false
        let theirs = server.addProjectElsewhere("Dom")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.allProjects.count == 1)
        #expect(server.task(titled: "Mine")?["projectId"] == .string(theirs))
        let joined = try #require(try await repo.projects().first)
        #expect(joined.localId == mine.localId && joined.serverId == theirs && joined.name == "Dom")
        #expect(try await repo.task(t.localId)?.projectLocalId == mine.localId)
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test func aTaskRefusedForItsProjectGoesAgainWithoutIt() async throws {
        let (repo, engine) = try setUp()
        let home = server.addProjectElsewhere("Dom")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        server.offline = true
        let t = try await repo.add(title: "Late", dueDate: nil, dueTime: nil, projectLocalId: home)
        server.offline = false
        // Archived on the phone before this Mac was back.
        server.editProjectElsewhere(home, ["archived": true, "archivedAt": 5])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.task(titled: "Late") != nil)
        #expect(server.task(titled: "Late")?["projectId"] == nil)
        #expect(try await repo.task(t.localId)?.serverId != nil)
        #expect(try await repo.task(t.localId)?.projectLocalId == nil)
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test func aProjectRefusedForAnotherReasonGoesAndItsTasksStayWithoutIt() async throws {
        let (repo, engine) = try setUp()
        server.offline = true
        let p = try await repo.addProject(name: "Dom")
        let t = try await repo.add(title: "Kept", dueDate: nil, dueTime: nil, projectLocalId: p.localId)
        try await repo.updateProject(p.localId, name: "Dom 2", color: nil, icon: "", note: "")
        server.offline = false
        server.addProjectElsewhere("dom 2", archived: true)
        server.rejectNextMutation = true
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.allProjects.count == 1)
        #expect(server.task(titled: "Kept") != nil)
        #expect(try await repo.task(t.localId)?.projectLocalId == nil)
        #expect(try await repo.projects().map(\.name) == ["dom 2"])
        #expect(try await repo.pendingOps().isEmpty)
    }
}

/// A server from before projects (0.12.x) keeps working: no project section, no errors, no retry loop.
struct OldServerTests {
    let clock = TestClock(utc("2026-10-22T09:00"))
    let server = FakeServer()

    func setUp() throws -> (TaskRepository, SyncEngine, StatusLog) {
        let clock = clock, ids = TestIds()
        server.clock = { clock.now }
        server.hasProjects = false
        let repo = TaskRepository(database: try AppDatabase.inMemory(), clock: { clock.now }, newId: { ids.next() })
        let tokens = DeviceTokens(
            serverUrl: FakeServer.site, deviceToken: FakeServer.deviceToken, api: PairingAPI(transport: server),
            onRevoked: {}, clock: { clock.now }
        )
        let remote = ConvexRemote(deploymentUrl: FakeServer.cloud, tokens: tokens, transport: server)
        let log = StatusLog()
        return (repo, SyncEngine(repository: repo, sender: remote, source: remote, onStatus: { log.append($0) }), log)
    }

    @Test func itSyncsAsBeforeAndSaysItHasNoProjects() async throws {
        let (repo, engine, _) = try setUp()
        server.addElsewhere("From the CLI")
        let mine = try await repo.add(title: "Mine", dueDate: nil, dueTime: nil)
        for _ in 0..<3 {
            guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        }
        #expect(server.mutationsSent() == [Mutations.add])
        #expect(try await repo.task(mine.localId)?.serverId != nil)
        #expect(try await repo.allTasks().count == 2)
        #expect(try await repo.projectSupport() == .unsupported)
        await #expect(throws: RepositoryError.invalid("This server has no projects. Projects need Dayhand server 0.13.0 or later.")) {
            try await repo.addProject(name: "Dom")
        }
        await #expect(throws: RepositoryError.self) { try await repo.setProject(mine.localId, "x") }
    }

    @Test func projectsMadeBeforeConnectingGoAndTheirTasksArriveWithoutThem() async throws {
        let (repo, engine, _) = try setUp()
        server.offline = true
        let home = try await repo.addProject(name: "Dom")
        let t = try await repo.add(title: "Written offline", dueDate: "2026-10-22", dueTime: nil, projectLocalId: home.localId)
        try await repo.updateProject(home.localId, name: "Dom 2", color: nil, icon: "", note: "")
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }

        server.offline = false
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let afterFirst = server.mutationsSent()
        #expect(afterFirst == [Mutations.addProject, Mutations.add])
        let onServer = try #require(server.task(titled: "Written offline"))
        #expect(onServer["projectId"] == nil)
        #expect(try await repo.task(t.localId)?.serverId == onServer["id"]?.string)
        #expect(try await repo.task(t.localId)?.projectLocalId == nil)
        #expect(try await repo.projects().isEmpty)
        #expect(try await repo.pendingOps().isEmpty)
        // No retry loop: further rounds send nothing.
        for _ in 0..<3 {
            guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        }
        #expect(server.mutationsSent() == afterFirst)
    }

    @Test func aServerRolledBackFromProjectsTakesTheTaskWithoutItsProject() async throws {
        let (repo, engine, _) = try setUp()
        server.hasProjects = true
        let home = server.addProjectElsewhere("Dom")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        server.offline = true
        let t = try await repo.add(title: "Before the rollback", dueDate: nil, dueTime: nil, projectLocalId: home)
        server.offline = false
        server.hasProjects = false
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.task(titled: "Before the rollback")?["projectId"] == nil)
        #expect(try await repo.task(t.localId)?.serverId != nil)
        #expect(try await repo.task(t.localId)?.projectLocalId == nil)
        #expect(try await repo.projects().isEmpty)
        #expect(try await repo.projectSupport() == .unsupported)
        #expect(try await repo.pendingOps().isEmpty)
    }
}
