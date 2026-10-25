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
        let add = try #require(try await repo.pendingOps().first)
        try await repo.acknowledge(add, value: ["project": ["id": "server-home"]])
        try await repo.deleteProject(home.localId, moveTasksTo: work.localId)
        #expect(try await repo.projects().map(\.name) == ["Praca"])
        #expect(try await repo.task(t.localId)?.projectLocalId == work.localId)
        let delete = try #require(try await repo.pendingOps().last)
        #expect(args(delete) == ["projectId": .string(home.localId), "moveTasksTo": .string(work.localId), "clientId": .string(delete.clientId)])
        await #expect(throws: RepositoryError.self) { try await repo.deleteProject(work.localId, moveTasksTo: work.localId) }
    }

    @Test func invalidAssignmentTargetsLeaveTheTaskAndOutboxUnchanged() async throws {
        let repo = try repository()
        let home = try await repo.addProject(name: "Dom")
        let work = try await repo.addProject(name: "Praca")
        let t = try await repo.add(title: "T", dueDate: nil, dueTime: nil, projectLocalId: home.localId)
        try await repo.setArchived(work.localId, true)
        let pending = try await repo.pendingOps()
        await #expect(throws: RepositoryError.self) { try await repo.setProject(t.localId, work.localId) }
        await #expect(throws: RepositoryError.self) { try await repo.setProject(t.localId, "missing") }
        #expect(try await repo.task(t.localId)?.projectLocalId == home.localId)
        #expect(try await repo.pendingOps() == pending)
        try await repo.setArchived(work.localId, false)
        try await repo.deleteProject(work.localId, moveTasksTo: nil)
        await #expect(throws: RepositoryError.self) { try await repo.setProject(t.localId, work.localId) }
        try await repo.moveToTrash(t.localId)
        let trashed = try await repo.pendingOps()
        try await repo.setProject(t.localId, nil)
        #expect(try await repo.task(t.localId)?.projectLocalId == home.localId)
        #expect(try await repo.pendingOps() == trashed)
    }

    @Test func concurrentAssignmentAndArchivalFollowTheWriterOrder() async throws {
        let repo = try repository()
        for index in 0..<20 {
            let p = try await repo.addProject(name: "P\(index)")
            let t = try await repo.add(title: "T", dueDate: nil, dueTime: nil)
            let assignment = Task { try await repo.setProject(t.localId, p.localId) }
            let archive = Task { try await repo.setArchived(p.localId, true) }
            let result = await assignment.result
            try await archive.value
            let ops = try await repo.pendingOps()
            let archived = try #require(ops.last { $0.mutation == Mutations.updateProject })
            let moved = ops.first { $0.taskLocalId == t.localId && $0.mutation == Mutations.update }
            switch result {
            case .success:
                #expect(try #require(moved?.seq) < #require(archived.seq))
                #expect(try await repo.task(t.localId)?.projectLocalId == p.localId)
            case .failure(let error):
                #expect(error is RepositoryError)
                #expect(moved == nil)
                #expect(try await repo.task(t.localId)?.projectLocalId == nil)
            }
        }
    }

    @Test(arguments: [false, true], [false, true]) func rejectedAssignmentsPreserveLaterMembership(add: Bool, clear: Bool) async throws {
        let repo = try repository()
        let projects = [
            RemoteProject(id: "a", name: "A", position: 1, createdAt: 0, updatedAt: 1),
            RemoteProject(id: "b", name: "B", position: 2, createdAt: 0, updatedAt: 1),
        ]
        let remote = RemoteTask(id: "t", title: "T", createdAt: 0, updatedAt: 1)
        try await repo.apply(Snapshot(tasks: add ? [] : [remote], projects: projects))
        let localId: String
        if add {
            localId = try await repo.add(title: "T", dueDate: nil, dueTime: nil, projectLocalId: "a").localId
        } else {
            localId = "t"
            try await repo.setProject(localId, "a")
        }
        let expected: String? = clear ? nil : "b"
        try await repo.setProject(localId, expected)
        let first = try #require(try await repo.next())
        try await repo.reject(first, reason: "Project \"A\" is archived; restore it first")
        let later = try #require(try await repo.pendingOps().last)
        try await repo.recordFailure(later, reason: "offline")
        #expect(try await repo.task(localId)?.projectLocalId == expected)
        #expect(try await repo.task(localId)?.serverUpdatedAt == nil)
        try await repo.apply(Snapshot(tasks: add ? [] : [RemoteTask(id: "t", title: "Newer", createdAt: 0, updatedAt: 2)], projects: projects))
        #expect(try await repo.task(localId)?.projectLocalId == expected)
        #expect(JSONValue.decode(later.argsJson)?["projectId"] == .of(expected))
    }

    @Test func rejectionRestoresAuthoritativeMembershipEvenAtTheCachedServerVersion() async throws {
        let repo = try repository()
        let projects = [
            RemoteProject(id: "a", name: "A", position: 1, createdAt: 0, updatedAt: 1),
            RemoteProject(id: "b", name: "B", position: 2, createdAt: 0, updatedAt: 1),
        ]
        let snapshot = Snapshot(tasks: [RemoteTask(id: "t", title: "T", createdAt: 0, updatedAt: 1, projectId: "b")], projects: projects)
        try await repo.apply(snapshot)
        try await repo.setProject("t", "a")
        let op = try #require(try await repo.next())
        try await repo.reject(op, reason: "Project \"A\" not found")
        try await repo.apply(snapshot)
        #expect(try await repo.task("t")?.projectLocalId == "b")
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

    func setUp(transport: HTTPTransport? = nil) throws -> (TaskRepository, SyncEngine) {
        let clock = clock, ids = TestIds()
        server.clock = { clock.now }
        let repo = TaskRepository(database: try AppDatabase.inMemory(), clock: { clock.now }, newId: { ids.next() })
        let remote = remote(transport: transport)
        return (repo, SyncEngine(repository: repo, sender: remote, source: remote, onStatus: { _ in }))
    }

    func remote(transport: HTTPTransport? = nil) -> ConvexRemote {
        let transport = transport ?? server, clock = clock
        let tokens = DeviceTokens(
            serverUrl: FakeServer.site, deviceToken: FakeServer.deviceToken, api: PairingAPI(transport: transport),
            onRevoked: {}, clock: { clock.now }
        )
        return ConvexRemote(deploymentUrl: FakeServer.cloud, tokens: tokens, transport: transport)
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

    @Test func sameNamedCreationsNeverAdoptAnotherDevicesProject() async throws {
        let (repo, engine) = try setUp()
        server.offline = true
        let mine = try await repo.addProject(name: "dom")
        let t = try await repo.add(title: "Mine", dueDate: nil, dueTime: nil, note: "Offline note", projectLocalId: mine.localId)
        server.offline = false
        let theirs = server.addProjectElsewhere("Dom")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.allProjects.count == 1)
        #expect(server.task(titled: "Mine")?["projectId"]?.string == nil)
        let other = try #require(try await repo.projects().first)
        #expect(other.localId != mine.localId && other.serverId == theirs && other.name == "Dom")
        #expect(try await repo.task(t.localId)?.projectLocalId == nil)
        #expect(server.task(titled: "Mine")?["note"] == "Offline note")
        #expect(try await repo.task(t.localId)?.note == "Offline note")
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test(arguments: [false, true]) func deletingAnUnsentOrNameRefusedProjectNeverDeletesTheOtherMacsProject(refused: Bool) async throws {
        let (repo, engine) = try setUp()
        let mine = try await repo.addProject(name: "Dom")
        let t = try await repo.add(title: "Mine", dueDate: nil, dueTime: nil, projectLocalId: mine.localId)
        let theirs = server.addProjectElsewhere("Dom")
        if refused {
            let add = try #require(try await repo.next())
            try await repo.reject(add, reason: "A project named \"Dom\" already exists")
        }
        try await repo.deleteProject(mine.localId, moveTasksTo: nil)
        #expect(try await repo.pendingOps().allSatisfy { !Mutations.projectChanges.contains($0.mutation) })
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.allProjects.map { $0["id"]?.string } == [theirs])
        #expect(!sent().contains { $0.0 == Mutations.deleteProject })
        #expect(try await repo.task(t.localId)?.projectLocalId == nil)
        #expect(server.task(titled: "Mine")?["projectId"]?.string == nil)
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test func cancellingAnOfflineProjectMovesItsPendingTasksToTheDestination() async throws {
        let (repo, engine) = try setUp()
        let mine = try await repo.addProject(name: "Dom")
        let target = try await repo.addProject(name: "Praca")
        let t = try await repo.add(title: "Moved", dueDate: nil, dueTime: nil, projectLocalId: mine.localId)
        try await repo.deleteProject(mine.localId, moveTasksTo: target.localId)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let targetId = try #require(server.project(named: "Praca")?["id"]?.string)
        #expect(server.project(named: "Dom") == nil)
        #expect(server.task(titled: "Moved")?["projectId"] == .string(targetId))
        #expect(try await repo.task(t.localId)?.projectLocalId == target.localId)
    }

    @Test(arguments: [false, true]) func cancellingOrRefusingALocalProjectClearsItsPendingAssignments(refused: Bool) async throws {
        let (repo, engine) = try setUp()
        let work = server.addProjectElsewhere("Praca")
        let t = server.addElsewhere("Existing")
        server.editElsewhere(t, ["projectId": .string(work)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let mine = try await repo.addProject(name: "Dom")
        let theirs = server.addProjectElsewhere("Dom")
        try await repo.setProject(t, mine.localId)
        if refused {
            let add = try #require(try await repo.next())
            try await repo.reject(add, reason: "A project named \"Dom\" already exists")
        }
        try await repo.deleteProject(mine.localId, moveTasksTo: nil)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.task(titled: "Existing")?["projectId"]?.string == nil)
        #expect(try await repo.task(t)?.projectLocalId == nil)
        #expect(server.project(named: "Dom")?["id"] == .string(theirs))
        #expect(!sent().contains { $0.0 == Mutations.deleteProject })
    }

    @Test(arguments: [false, true]) func newerSnapshotsKeepTheFinalDestinationOfOfflineDeletionChains(toNone: Bool) async throws {
        let (repo, engine) = try setUp()
        let a = server.addProjectElsewhere("A")
        let b = server.addProjectElsewhere("B")
        let c = server.addProjectElsewhere("C")
        let t = server.addElsewhere("T")
        server.editElsewhere(t, ["projectId": .string(a)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        try await repo.deleteProject(a, moveTasksTo: b)
        try await repo.deleteProject(b, moveTasksTo: toNone ? nil : c)
        server.editElsewhere(t, ["note": "A newer server copy"])
        server.failNextMutation = true
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }
        #expect(try await repo.task(t)?.projectLocalId == (toNone ? nil : c))
        #expect(try await repo.task(t)?.note == "A newer server copy")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.task(titled: "T")?["projectId"]?.string == (toNone ? nil : c))
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test func aRefusedDeletionDestinationNeverRedirectsToASameNamedProject() async throws {
        let (repo, engine) = try setUp()
        let source = server.addProjectElsewhere("Source")
        let t = server.addElsewhere("T")
        server.editElsewhere(t, ["projectId": .string(source)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let destination = try await repo.addProject(name: "Dom")
        let theirs = server.addProjectElsewhere("Dom")
        try await repo.deleteProject(source, moveTasksTo: destination.localId)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.allProjects.compactMap { $0["id"]?.string } == [theirs])
        #expect(server.task(titled: "T")?["projectId"]?.string == nil)
        let deletion = try #require(sent().first { $0.0 == Mutations.deleteProject })
        #expect(deletion.1["projectId"] == .string(source) && deletion.1["moveTasksTo"] == "none")
        #expect(try await repo.task(t)?.projectLocalId == nil)
    }

    @Test(arguments: [false, true]) func anUnacknowledgedCreationKeepsItsDeletionUntilIdentityResolves(snapshot: Bool) async throws {
        let (repo, engine) = try setUp()
        let p = try await repo.addProject(name: "Uncertain")
        server.loseNextAnswer = true
        #expect(try await OutboxProcessor(store: repo, sender: remote()).drain() == .retryLater)
        let serverId = try #require(server.project(named: "Uncertain")?["id"]?.string)
        #expect(try await repo.projects().first?.serverId == nil)
        try await repo.deleteProject(p.localId, moveTasksTo: nil)
        #expect(try await repo.projects().isEmpty)
        #expect(try await repo.pendingOps().map(\.mutation) == [Mutations.addProject, Mutations.deleteProject])
        if snapshot {
            try await repo.apply(try await remote().snapshot().get())
            #expect(try await repo.projectRef(p.localId) == serverId)
            #expect(try await repo.pendingOps().map(\.mutation) == [Mutations.deleteProject])
        }
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.project(named: "Uncertain") == nil)
        #expect(try await repo.projects().isEmpty)
        #expect(try await repo.pendingOps().isEmpty)
        #expect(sent().last?.1["projectId"] == .string(serverId))
    }

    @Test func deletionDuringAnInFlightCreationWaitsForItsAcknowledgement() async throws {
        let transport = PausedProjectTransport(server)
        let (repo, engine) = try setUp(transport: transport)
        let p = try await repo.addProject(name: "In flight")
        let round = Task { await engine.round() }
        defer { Task { await transport.release() } }
        for _ in 0..<200 {
            if await transport.isPaused { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(await transport.isPaused)
        try await repo.deleteProject(p.localId, moveTasksTo: nil)
        #expect(try await repo.projects().isEmpty)
        #expect(try await repo.pendingOps().map(\.mutation) == [Mutations.addProject, Mutations.deleteProject])
        await transport.release()
        guard case .synced = await round.value else { Issue.record("expected synced"); return }
        #expect(server.project(named: "In flight") == nil)
        #expect(try await repo.projects().isEmpty)
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test(arguments: [Mutations.deleteProject, Mutations.add, Mutations.update], [false, true])
    func cancellationCreatesTheDestinationBeforeEveryRetargetedReference(mutation: String, refused: Bool) async throws {
        let (repo, engine) = try setUp()
        let a = server.addProjectElsewhere("A")
        let original = server.addElsewhere("Original")
        server.editElsewhere(original, ["projectId": .string(a)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let b = try await repo.addProject(name: "B")
        if refused {
            _ = try await repo.next(markSending: true)
            server.addProjectElsewhere("B")
        }
        var taskId = original
        switch mutation {
        case Mutations.deleteProject: try await repo.deleteProject(a, moveTasksTo: b.localId)
        case Mutations.add:
            taskId = try await repo.add(title: "New", dueDate: nil, dueTime: nil, projectLocalId: b.localId).localId
            try await repo.setNote(taskId, "After creation")
        default: try await repo.setProject(original, b.localId)
        }
        let c = try await repo.addProject(name: "C")
        try await repo.deleteProject(b.localId, moveTasksTo: c.localId)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let destination = try #require(server.project(named: "C")?["id"]?.string)
        let title = mutation == Mutations.add ? "New" : "Original"
        #expect(server.task(titled: title)?["projectId"] == .string(destination))
        #expect(try await repo.task(taskId)?.projectLocalId == c.localId)
        #expect(try await repo.pendingOps().isEmpty)
        if mutation == Mutations.deleteProject { #expect(server.project(named: "A") == nil) }
        if mutation == Mutations.add { #expect(server.task(titled: title)?["note"] == "After creation") }
        if refused { #expect(server.project(named: "B") != nil) }
        let mutations = sent()
        let created = try #require(mutations.firstIndex { $0.0 == Mutations.addProject && $0.1["name"] == "C" })
        let referenced = try #require(mutations.firstIndex { $0.1["projectId"]?.string == destination || $0.1["moveTasksTo"]?.string == destination })
        #expect(created < referenced)
    }

    @Test(arguments: [false, true]) func aRefusedCreationCannotRedirectLaterRenamesOrNotes(conflicting: Bool) async throws {
        let (repo, engine) = try setUp()
        let mine = try await repo.addProject(name: "Dom")
        try await repo.updateProject(mine.localId, name: "Praca", color: nil, icon: "", note: "My note")
        let t = try await repo.add(title: "Mine", dueDate: nil, dueTime: nil, projectLocalId: mine.localId)
        let home = server.addProjectElsewhere("Dom")
        let other = conflicting ? server.addProjectElsewhere("Praca") : nil
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.task(titled: "Mine")?["projectId"]?.string == nil)
        #expect(try await repo.task(t.localId)?.projectLocalId == nil)
        #expect(try await repo.projects().allSatisfy { $0.localId != mine.localId })
        #expect(server.allProjects.first { $0["id"]?.string == home }?["name"] == "Dom")
        #expect(server.allProjects.first { $0["id"]?.string == home }?["note"]?.string == nil)
        if let other { #expect(server.allProjects.first { $0["id"]?.string == other }?["note"]?.string == nil) }
        #expect(!sent().contains { $0.0 == Mutations.updateProject })
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test(arguments: [false, true]) func aRefusedCreationDoesNotAdoptCachedSameNamedProjects(cachedSnapshot: Bool) async throws {
        let (repo, engine) = try setUp()
        let mine = try await repo.addProject(name: "Dom")
        try await repo.updateProject(mine.localId, name: "Praca", color: nil, icon: "", note: "Waiting note")
        let t = try await repo.add(title: "Mine", dueDate: nil, dueTime: nil, projectLocalId: mine.localId)
        let home = server.addProjectElsewhere("Dom")
        let other = server.addProjectElsewhere("Praca")
        let theirs = server.addElsewhere("Theirs")
        server.editElsewhere(theirs, ["projectId": .string(home)])
        if cachedSnapshot {
            server.failNextMutation = true
            guard case .offline = await engine.round() else { Issue.record("expected offline"); return }
        }
        let add = try #require(try await repo.next())
        try await repo.reject(add, reason: "A project named \"Dom\" already exists")
        server.failNextMutation = true
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }
        #expect(try await repo.projects().allSatisfy { $0.localId != mine.localId })
        #expect(try await repo.task(theirs)?.projectLocalId == home)
        #expect(try await repo.projects().count == 2)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.task(titled: "Mine")?["projectId"]?.string == nil)
        #expect(try await repo.task(t.localId)?.projectLocalId == nil)
        #expect(server.allProjects.first { $0["id"]?.string == other }?["note"]?.string == nil)
    }

    @Test(arguments: [false, true]) func missingReferencesReconcileOnlyTheRejectedTaskAssignment(laterMove: Bool) async throws {
        let (repo, engine) = try setUp()
        let q = server.addProjectElsewhere("Q")
        let p = server.addProjectElsewhere("P")
        let r = server.addProjectElsewhere("R")
        let t = server.addElsewhere("T")
        server.editElsewhere(t, ["projectId": .string(q)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let version = server.task(titled: "T")?["updatedAt"]
        try await repo.setProject(t, p)
        server.deleteProjectElsewhere(p)
        server.failNextMutation = true
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }
        #expect(try await repo.task(t)?.projectLocalId == p)
        if laterMove {
            try await repo.setProject(t, r)
            server.failNextMutation = true
        }
        let status = await engine.round()
        if !laterMove { guard case .synced = status else { Issue.record("expected synced"); return } }
        #expect(try await repo.task(t)?.projectLocalId == (laterMove ? r : q))
        #expect(server.task(titled: "T")?["updatedAt"] == version)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.task(titled: "T")?["projectId"] == .string(laterMove ? r : q))
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test func rejectingARenameKeepsTheLaterDeletionHiddenDuringAnOutage() async throws {
        let (repo, engine) = try setUp()
        let home = server.addProjectElsewhere("Dom")
        let work = server.addProjectElsewhere("Praca")
        let t = server.addElsewhere("T")
        server.editElsewhere(t, ["projectId": .string(home)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        try await repo.updateProject(home, name: "Taken", color: nil, icon: "", note: "")
        server.addProjectElsewhere("Taken")
        try await repo.deleteProject(home, moveTasksTo: nil)
        try await repo.setProject(t, work)
        let rename = try #require(try await repo.next())
        try await repo.reject(rename, reason: "A project named \"Taken\" already exists")
        server.failNextMutation = true
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }
        #expect(try await repo.projects().allSatisfy { $0.localId != home })
        #expect(try await repo.pendingOps().first?.mutation == Mutations.deleteProject)
        #expect(try await repo.task(t)?.projectLocalId == work)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.project(named: "Dom") == nil)
        #expect(server.task(titled: "T")?["projectId"] == .string(work))
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
        await #expect(throws: RepositoryError.invalid("Needs backend 0.13.0 or later")) {
            try await repo.addProject(name: "Dom")
        }
        await #expect(throws: RepositoryError.self) { try await repo.setProject(mine.localId, "x") }
    }

    @Test func projectsAndMembershipsWaitWhileTasksSyncThenResumeAfterAnUpgrade() async throws {
        let (repo, engine, _) = try setUp()
        server.offline = true
        let home = try await repo.addProject(name: "Dom")
        let t = try await repo.add(title: "Written offline", dueDate: "2026-10-22", dueTime: nil, note: "Keep this note", projectLocalId: home.localId)
        try await repo.updateProject(home.localId, name: "Dom 2", color: nil, icon: "", note: "")
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }

        server.offline = false
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let afterFirst = server.mutationsSent()
        #expect(afterFirst == [Mutations.addProject, Mutations.add])
        let onServer = try #require(server.task(titled: "Written offline"))
        #expect(onServer["projectId"] == nil)
        #expect(try await repo.task(t.localId)?.serverId == onServer["id"]?.string)
        #expect(onServer["note"] == "Keep this note")
        #expect(try await repo.task(t.localId)?.projectLocalId == home.localId)
        #expect(try await repo.task(t.localId)?.note == "Keep this note")
        #expect(try await repo.projects().map(\.name) == ["Dom 2"])
        let waiting = try await repo.pendingOps()
        #expect(waiting.map(\.mutation) == [Mutations.addProject, Mutations.update, Mutations.updateProject])
        #expect(waiting.allSatisfy { $0.waitsForProjects && $0.lastError == nil })
        #expect(try await repo.next() == nil)
        for _ in 0..<3 {
            guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        }
        #expect(server.mutationsSent() == afterFirst)
        #expect(try await repo.pendingOps() == waiting)
        try await repo.setNote(t.localId, "Edited on the old server")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.task(titled: "Written offline")?["note"] == "Edited on the old server")
        #expect(try await repo.task(t.localId)?.projectLocalId == home.localId)

        server.hasProjects = true
        for _ in 0..<2 {
            guard case .synced = await engine.round() else { Issue.record("expected synced after upgrade"); return }
        }
        let projectId = try #require(server.project(named: "Dom 2")?["id"]?.string)
        #expect(server.task(titled: "Written offline")?["projectId"] == .string(projectId))
        #expect(server.task(titled: "Written offline")?["note"] == "Edited on the old server")
        #expect(try await repo.task(t.localId)?.projectLocalId == home.localId)
        #expect(try await repo.pendingOps().isEmpty)
        #expect(Array(server.mutationsSent().suffix(3)) == [Mutations.addProject, Mutations.update, Mutations.updateProject])
    }

    @Test(arguments: [false, true]) func pendingAssignmentsAndClearsWaitWithoutBlockingOtherTaskEdits(clear: Bool) async throws {
        let (repo, engine, _) = try setUp()
        server.hasProjects = true
        let home = server.addProjectElsewhere("Dom")
        let work = server.addProjectElsewhere("Praca")
        let t = server.addElsewhere("T")
        server.editElsewhere(t, ["projectId": .string(home)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        try await repo.setProject(t, clear ? nil : work)
        try await repo.setNote(t, "Still syncs")
        server.hasProjects = false
        guard case .synced = await engine.round() else { Issue.record("expected synced on old server"); return }
        #expect(server.task(titled: "T")?["note"] == "Still syncs")
        #expect(try await repo.task(t)?.projectLocalId == (clear ? nil : work))
        let waiting = try await repo.pendingOps()
        #expect(waiting.count == 1 && waiting.allSatisfy(\.waitsForProjects))
        let sent = server.mutationsSent()
        guard case .synced = await engine.round() else { Issue.record("expected synced again"); return }
        #expect(server.mutationsSent() == sent)
        server.hasProjects = true
        for _ in 0..<2 {
            guard case .synced = await engine.round() else { Issue.record("expected synced after upgrade"); return }
        }
        #expect(server.task(titled: "T")?["projectId"]?.string == (clear ? nil : work))
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test func unsupportedSnapshotsPreservePreviouslySyncedProjectsAndMemberships() async throws {
        let (repo, engine, _) = try setUp()
        server.hasProjects = true
        let home = server.addProjectElsewhere("Dom")
        let t = server.addElsewhere("T")
        server.editElsewhere(t, ["projectId": .string(home)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        server.hasProjects = false
        server.editElsewhere(t, ["note": "A newer task without a project field"])
        guard case .synced = await engine.round() else { Issue.record("expected synced on old server"); return }
        #expect(try await repo.task(t)?.note == "A newer task without a project field")
        #expect(try await repo.task(t)?.projectLocalId == home)
        #expect(try await repo.projects().map(\.localId) == [home])
        #expect(try await repo.pendingOps().isEmpty)
        server.editElsewhere(t, ["projectId": .null])
        server.hasProjects = true
        for _ in 0..<2 {
            guard case .synced = await engine.round() else { Issue.record("expected synced after upgrade"); return }
        }
        #expect(server.task(titled: "T")?["projectId"] == .string(home))
        #expect(try await repo.task(t)?.projectLocalId == home)
        #expect(try await repo.pendingOps().isEmpty)
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
        #expect(try await repo.task(t.localId)?.projectLocalId == home)
        #expect(try await repo.projects().map(\.localId) == [home])
        #expect(try await repo.projectSupport() == .unsupported)
        #expect(try await repo.pendingOps().allSatisfy(\.waitsForProjects))
        let sent = server.mutationsSent()
        guard case .synced = await engine.round() else { Issue.record("expected synced again"); return }
        #expect(server.mutationsSent() == sent)
        server.hasProjects = true
        for _ in 0..<2 {
            guard case .synced = await engine.round() else { Issue.record("expected synced after upgrade"); return }
        }
        #expect(server.task(titled: "Before the rollback")?["projectId"] == .string(home))
        #expect(try await repo.pendingOps().isEmpty)
    }
}
