import Foundation
import Testing
@testable import DayhandCore

/// Moving tasks into projects is a queued task change, and only into a project the server has.
struct ProjectRepositoryTests {
    let clock = TestClock(utc("2026-10-22T09:00"))
    let ids = TestIds()

    func repository(repeatsOnMac: Bool = false) throws -> TaskRepository {
        let clock = clock, ids = ids
        return TaskRepository(
            database: try AppDatabase.inMemory(), clock: { clock.now }, newId: { ids.next() }, repeatsOnMac: { repeatsOnMac }
        )
    }

    func args(_ op: OutboxOp) -> JSONValue? { JSONValue.decode(op.argsJson) }

    /// Projects as a snapshot brings them: the server has each of them.
    func serverProjects(_ repo: TaskRepository, _ projects: [RemoteProject]) async throws {
        try await repo.apply(Snapshot(tasks: [], projects: projects))
    }

    static let home = RemoteProject(id: "home", name: "Dom", position: 1024, createdAt: 0, updatedAt: 1)
    static let work = RemoteProject(id: "work", name: "Praca", position: 2048, createdAt: 0, updatedAt: 1)

    @Test func aTaskGoesIntoAProjectWhenAddedOrMovedAndOutWithNull() async throws {
        let repo = try repository()
        try await serverProjects(repo, [Self.home])
        let t = try await repo.add(title: "Odkurzyć", dueDate: nil, dueTime: nil, projectLocalId: "home")
        #expect(t.projectLocalId == "home")
        let other = try await repo.add(title: "Mleko", dueDate: nil, dueTime: nil)
        try await repo.setProject(other.localId, "home")
        try await repo.setProject(other.localId, "home")
        try await repo.setProject(t.localId, nil)
        #expect(try await repo.task(other.localId)?.projectLocalId == "home")
        #expect(try await repo.task(t.localId)?.projectLocalId == nil)
        let ops = try await repo.pendingOps()
        #expect(ops.map(\.mutation) == [Mutations.add, Mutations.add, Mutations.update, Mutations.update])
        #expect(args(ops[0])?["projectId"] == "home")
        #expect(args(ops[2])?["projectId"] == "home")
        #expect(args(ops[3])?["projectId"] == .null)
    }

    @Test func aTaskGoesOnlyIntoAProjectTheServerHas() async throws {
        let repo = try repository()
        try await serverProjects(repo, [Self.home])
        // A row the server never confirmed, as a development build of 0.4.0 could leave behind.
        try await repo.database.writer.write { db in
            try Project(localId: "unsent", name: "Unsent", position: 2048, createdAt: 0, updatedAt: 0).save(db)
        }
        let t = try await repo.add(title: "T", dueDate: nil, dueTime: nil)
        let pending = try await repo.pendingOps()
        let notOnServer = RepositoryError.invalid("That project is not on the server yet.")
        await #expect(throws: notOnServer) { try await repo.setProject(t.localId, "unsent") }
        await #expect(throws: notOnServer) { try await repo.add(title: "U", dueDate: nil, dueTime: nil, projectLocalId: "unsent") }
        await #expect(throws: RepositoryError.invalid("That project no longer exists.")) { try await repo.setProject(t.localId, "gone") }
        #expect(try await repo.pendingOps() == pending)
        #expect(try await repo.task(t.localId)?.projectLocalId == nil)
        let projects = try await repo.projects()
        #expect(QuickAdd.parse("U +unsent", now: clock.now, timezone: "UTC", projects: projects).projectLocalId == nil)
        #expect(QuickAdd.parse("U +dom", now: clock.now, timezone: "UTC", projects: projects).projectLocalId == "home")
    }

    @Test func anArchivedProjectTakesNoNewTaskButKeepsItsOwn() async throws {
        let repo = try repository()
        try await serverProjects(repo, [Self.home, Self.work])
        let t = try await repo.add(title: "In it", dueDate: nil, dueTime: nil, projectLocalId: "home")
        var archived = Self.home
        archived.archivedAt = 5
        archived.updatedAt = 2
        try await serverProjects(repo, [archived, Self.work])
        #expect(try await repo.projects().first?.isArchived == true)
        #expect(try await repo.task(t.localId)?.projectLocalId == "home")
        let pending = try await repo.pendingOps()
        let archivedError = RepositoryError.invalid("“Dom” is archived; restore it first.")
        await #expect(throws: archivedError) { try await repo.add(title: "New", dueDate: nil, dueTime: nil, projectLocalId: "home") }
        try await repo.setProject(t.localId, "work")
        await #expect(throws: archivedError) { try await repo.setProject(t.localId, "home") }
        #expect(try await repo.task(t.localId)?.projectLocalId == "work")
        #expect(try await repo.pendingOps().count == pending.count + 1)
    }

    @Test func aTaskInTheTrashChangesNoProject() async throws {
        let repo = try repository()
        try await serverProjects(repo, [Self.home, Self.work])
        let t = try await repo.add(title: "T", dueDate: nil, dueTime: nil, projectLocalId: "home")
        try await repo.moveToTrash(t.localId)
        let trashed = try await repo.pendingOps()
        try await repo.setProject(t.localId, "work")
        try await repo.setProject(t.localId, nil)
        #expect(try await repo.task(t.localId)?.projectLocalId == "home")
        #expect(try await repo.pendingOps() == trashed)
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
        #expect(try await repo.task("t")?.projectLocalId == nil)
        #expect(try await repo.next()?.lastError == "Project \"A\" not found")
        try await repo.apply(snapshot)
        #expect(try await repo.task("t")?.projectLocalId == "b")
    }

    @Test func aRepeatingTaskDoneWithoutAServerKeepsItsProjectInTheNextOccurrence() async throws {
        let repo = try repository(repeatsOnMac: true)
        try await serverProjects(repo, [Self.home])
        let t = try await repo.add(title: "Podlać kwiaty", dueDate: "2026-10-22", dueTime: nil, projectLocalId: "home")
        try await repo.setRepeat(t.localId, RepeatRule(every: .week))
        try await repo.complete(t.localId)
        let next = try #require(try await repo.allTasks().first { $0.localId != t.localId })
        #expect(next.dueDate == "2026-10-29")
        #expect(next.projectLocalId == "home")
        let add = try #require(try await repo.pendingOps().last)
        #expect(add.mutation == Mutations.add && args(add)?["projectId"] == "home")
    }
}

/// Project management online, task assignments through the outbox, against the fake server.
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

    @Test func withoutAConnectionProjectManagementFailsAndQueuesNothing() async throws {
        let (repo, engine) = try setUp()
        let home = server.addProjectElsewhere("Dom")
        let work = server.addProjectElsewhere("Praca")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let before = try await repo.projects()
        let onServer = server.allProjects
        server.offline = true
        let needsConnection = RepositoryError.invalid("Requires a connection to the server.")
        // What the screens say without a pairing too.
        #expect(RepositoryError.needsConnection == needsConnection)
        await #expect(throws: needsConnection) { try await engine.addProject(name: "Nowy") }
        await #expect(throws: needsConnection) { try await engine.updateProject(home, name: "Dom 2", color: .green, icon: "", note: "") }
        await #expect(throws: needsConnection) { try await engine.moveProject(home, to: 99) }
        await #expect(throws: needsConnection) { try await engine.setArchived(home, true) }
        await #expect(throws: needsConnection) { try await engine.deleteProject(home, moveTasksTo: work) }
        #expect(try await repo.projects() == before)
        #expect(try await repo.pendingOps().isEmpty)
        server.offline = false
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.allProjects == onServer)
        #expect(try await repo.projects() == before)
    }

    @Test(arguments: [false, true]) func projectChangesActOnTheServerAtOnceAndTheRowsFollow(moveToProject: Bool) async throws {
        let (repo, engine) = try setUp()
        let work = server.addProjectElsewhere("Praca")
        let t = server.addElsewhere("Odkurzyć")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }

        let bakery = try await engine.addProject(name: " Strona piekarni ", color: .amber, icon: "🥐", note: "Menu")
        let onServer = try #require(server.project(named: "Strona piekarni"))
        let projectId = try #require(onServer["id"]?.string)
        #expect(sent().last?.0 == Mutations.addProject && sent().last?.1["clientId"] == .string(bakery.localId))
        #expect(bakery.serverId == projectId && bakery.position == onServer["position"]?.double)
        #expect(bakery.name == "Strona piekarni" && bakery.color == .amber && bakery.icon == "🥐" && bakery.note == "Menu")
        #expect(try await repo.projects().map(\.localId) == [work, bakery.localId])
        #expect(try await repo.projects().last == bakery)
        #expect(try await repo.pendingOps().isEmpty)

        try await repo.setProject(t, bakery.localId)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.task(titled: "Odkurzyć")?["projectId"] == .string(projectId))

        try await engine.updateProject(bakery.localId, name: "Piekarnia", color: .amber, icon: "", note: "Menu")
        #expect(Set(try #require(sent().last?.1.object).keys) == ["projectId", "name", "icon", "clientId"])
        #expect(sent().last?.1["projectId"] == .string(projectId))
        let renamed = try #require(try await repo.projects().first { $0.localId == bakery.localId })
        #expect(renamed.name == "Piekarnia" && renamed.icon == nil && renamed.note == "Menu" && renamed.serverId == projectId)
        #expect(server.project(named: "Piekarnia")?["icon"]?.string == nil)
        try await engine.moveProject(bakery.localId, to: 10)
        #expect(server.project(named: "Piekarnia")?["position"] == 10)
        #expect(try await repo.projects().map(\.name) == ["Piekarnia", "Praca"])
        try await engine.setArchived(bakery.localId, true)
        #expect(server.project(named: "Piekarnia")?["archived"] == true)
        #expect(try await repo.projects().first { $0.localId == bakery.localId }?.isArchived == true)
        // Nothing to change, nothing sent.
        let calls = sent().count
        try await engine.setArchived(bakery.localId, true)
        try await engine.updateProject(bakery.localId, name: "Piekarnia", color: .amber, icon: "", note: "Menu")
        try await engine.moveProject(bakery.localId, to: 10)
        #expect(sent().count == calls)
        #expect(try await repo.pendingOps().isEmpty)

        let target = moveToProject ? work : nil
        try await engine.deleteProject(bakery.localId, moveTasksTo: target)
        #expect(sent().last?.1["moveTasksTo"] == .string(target ?? "none"))
        #expect(server.project(named: "Piekarnia") == nil)
        #expect(server.task(titled: "Odkurzyć")?["projectId"]?.string == target)
        #expect(try await repo.projects().map(\.localId) == [work])
        #expect(try await repo.task(t)?.projectLocalId == target)
        #expect(try await repo.pendingOps().isEmpty)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(try await repo.projects().map(\.localId) == [work])
        #expect(try await repo.task(t)?.projectLocalId == target)
    }

    @Test func aProjectCallWaitsForTheRunningRoundSoItsSnapshotCannotUndoIt() async throws {
        let transport = PausedSnapshotTransport(server)
        let (repo, engine) = try setUp(transport: transport)
        let round = Task { await engine.round() }
        defer { Task { await transport.release() } }
        for _ in 0..<200 {
            if await transport.isPaused { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(await transport.isPaused)
        // The round has read the projects (none); the call must not reach the server before the round is over.
        let add = Task { try await engine.addProject(name: "Dom") }
        try await Task.sleep(for: .milliseconds(50))
        #expect(server.project(named: "Dom") == nil)
        await transport.release()
        guard case .synced = await round.value else { Issue.record("expected synced"); return }
        let project = try await add.value
        #expect(try await repo.projects().map(\.localId) == [project.localId])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(try await repo.projects().map(\.localId) == [project.localId])
    }

    @Test func aServerRefusalComesBackInItsWordsAndChangesNothing() async throws {
        let (repo, engine) = try setUp()
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        server.addProjectElsewhere("Dom")
        await #expect(throws: RepositoryError.invalid("A project named \"Dom\" already exists")) { try await engine.addProject(name: "dom") }
        #expect(try await repo.projects().isEmpty)
        #expect(try await repo.pendingOps().isEmpty)
        #expect(server.allProjects.count == 1)
        // Once the Mac knows the name, its own checks refuse it before anything is sent.
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let calls = sent().count
        await #expect(throws: RepositoryError.invalid("There is already a project named “Dom”.")) { try await engine.addProject(name: "DOM") }
        await #expect(throws: RepositoryError.invalid("The icon must be a single emoji.")) { try await engine.addProject(name: "Ikona", icon: "ab") }
        let home = try #require(try await repo.projects().first?.localId)
        await #expect(throws: RepositoryError.invalid("Move the tasks to another project.")) { try await engine.deleteProject(home, moveTasksTo: home) }
        #expect(sent().count == calls)
    }

    @Test(arguments: ["1️⃣", "#\u{20E3}", "👩🏽‍💻", "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}"])
    func backendEmojiIconsAreAcceptedAndCombiningSuffixesRefused(icon: String) async throws {
        let (repo, engine) = try setUp()
        let p = server.addProjectElsewhere("Imported")
        server.editProjectElsewhere(p, ["icon": .string(icon)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        try await engine.updateProject(p, name: "Imported", color: nil, icon: icon, note: "Edited note")
        let created = try await engine.addProject(name: "Created", icon: icon)
        let calls = sent().count
        await #expect(throws: RepositoryError.self) { try await engine.addProject(name: "Invalid", icon: "🥐\u{301}") }
        await #expect(throws: RepositoryError.self) {
            try await engine.updateProject(p, name: "Imported", color: nil, icon: "🥐\u{301}", note: "Refused note")
        }
        #expect(sent().count == calls)
        #expect(server.project(named: "Imported")?["note"] == "Edited note")
        #expect(server.project(named: "Created")?["icon"] == .string(icon))
        #expect(try await repo.projects().first { $0.localId == created.localId }?.icon == icon)
    }

    @Test func tasksGoIntoAConfirmedProjectOfflineAndReachTheServerWithItsId() async throws {
        let (repo, engine) = try setUp()
        let bakery = try await engine.addProject(name: "Strona piekarni")
        let projectId = try #require(bakery.serverId)
        server.offline = true
        let photos = try await repo.add(title: "Zdjęcia", dueDate: nil, dueTime: nil, projectLocalId: bakery.localId)
        let line = QuickAdd.parse("Faktura +strona-piekarni", now: clock.now, timezone: "Europe/London", projects: try await repo.projects())
        #expect(line.title == "Faktura" && line.projectLocalId == bakery.localId)
        let typed = try await repo.add(title: line.title, dueDate: nil, dueTime: nil, projectLocalId: line.projectLocalId)
        let menu = try await repo.add(title: "Menu", dueDate: nil, dueTime: nil)
        try await repo.setProject(menu.localId, bakery.localId)
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }

        server.offline = false
        let offlineCalls = sent().count
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let calls = sent().dropFirst(offlineCalls)
        #expect(calls.map(\.0) == [Mutations.add, Mutations.add, Mutations.add, Mutations.update])
        #expect(calls.map { $0.1["projectId"] } == [.string(projectId), .string(projectId), nil, .string(projectId)])
        for title in ["Zdjęcia", "Faktura", "Menu"] {
            #expect(server.task(titled: title)?["projectId"] == .string(projectId), "\(title)")
        }
        for task in [photos, typed, menu] {
            #expect(try await repo.task(task.localId)?.projectLocalId == bakery.localId)
        }
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test(arguments: [false, true], [false, true])
    func aRefusedAssignmentLeavesTheTaskWithoutTheProject(newTask: Bool, deleted: Bool) async throws {
        let (repo, engine) = try setUp()
        let home = server.addProjectElsewhere("Dom")
        let existing = server.addElsewhere("Existing")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let taskId = newTask
            ? try await repo.add(title: "Late", dueDate: nil, dueTime: nil, projectLocalId: home).localId
            : existing
        if !newTask { try await repo.setProject(existing, home) }
        try await repo.setNote(taskId, "Kept note")
        // Archived or deleted on the phone before this Mac sent the change.
        if deleted { server.deleteProjectElsewhere(home) } else { server.editProjectElsewhere(home, ["archived": true, "archivedAt": 5]) }
        #expect(try await OutboxProcessor(store: repo, sender: remote(), maxOps: 1).drain() == .moreLeft)
        let refused = try #require(try await repo.next())
        #expect(refused.lastError.map(RemoteJSON.refusesProject) == true)
        #expect(try await repo.task(taskId)?.projectLocalId == nil)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let title = newTask ? "Late" : "Existing"
        #expect(server.task(titled: title)?["projectId"] == nil)
        #expect(server.task(titled: title)?["note"] == "Kept note")
        #expect(try await repo.task(taskId)?.serverId != nil)
        #expect(try await repo.task(taskId)?.projectLocalId == nil)
        #expect(try await repo.task(taskId)?.note == "Kept note")
        #expect(try await repo.pendingOps().isEmpty)
        // Sent again once, without the project.
        #expect(sent().filter { $0.1["clientId"] == .string(refused.clientId) }.map { $0.1["projectId"] == nil } == [false, true])
    }

    @Test(arguments: [Mutations.softDelete, Mutations.restore, Mutations.archive, Mutations.setNow])
    func theQueueGoesStrictlyInOrderWithNothingWaiting(action: String) async throws {
        let (repo, engine) = try setUp()
        let home = server.addProjectElsewhere("Dom")
        let t = server.addElsewhere("T")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        try await repo.setProject(t, home)
        // The assignment will be refused: nothing behind it waits for that.
        server.deleteProjectElsewhere(home)
        switch action {
        case Mutations.softDelete: try await repo.moveToTrash(t)
        case Mutations.restore:
            try await repo.moveToTrash(t)
            try await repo.restore(t)
        case Mutations.archive: try await repo.archive(t)
        default: try await repo.setNow(t)
        }
        try await repo.add(title: "Unrelated", dueDate: nil, dueTime: nil)
        let queued = try await repo.pendingOps()
        #expect(try await repo.next() == queued.first)
        let before = sent().count
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let lifecycle = action == Mutations.restore ? [Mutations.softDelete, Mutations.restore] : [action]
        #expect(sent().dropFirst(before).map(\.0) == [Mutations.update, Mutations.update] + lifecycle + [Mutations.add])
        #expect(sent().dropFirst(before).compactMap { $0.1["clientId"]?.string } == [queued[0].clientId] + queued.map(\.clientId))
        #expect(try await repo.pendingOps().isEmpty)
        #expect(try await repo.task(t)?.projectLocalId == nil)
    }
}

/// Holds the first snapshot's `app:listProjects` answer until released.
private actor PausedSnapshotTransport: HTTPTransport {
    private let server: FakeServer
    private var didPause = false
    private var continuation: CheckedContinuation<Void, Never>?

    init(_ server: FakeServer) { self.server = server }

    var isPaused: Bool { continuation != nil }

    func post(_ url: URL, json: Data, bearer: String?) async throws -> HTTPReply {
        let reply = try await server.post(url, json: json, bearer: bearer)
        if !didPause, JSONValue.decode(json)?["path"]?.string == RemoteJSON.queryProjects {
            didPause = true
            await withCheckedContinuation { continuation = $0 }
        }
        return reply
    }

    func release() {
        continuation?.resume()
        continuation = nil
    }
}

/// A server from before projects (0.12.x) keeps working: tasks sync, project calls say what they need, no retry loop.
struct OldServerTests {
    let clock = TestClock(utc("2026-10-22T09:00"))
    let server = FakeServer()
    let requirement = RepositoryError.invalid("Needs backend 0.13.0 or later")

    func setUp() throws -> (TaskRepository, SyncEngine) {
        let clock = clock, ids = TestIds()
        server.clock = { clock.now }
        server.hasProjects = false
        let repo = TaskRepository(database: try AppDatabase.inMemory(), clock: { clock.now }, newId: { ids.next() })
        let tokens = DeviceTokens(
            serverUrl: FakeServer.site, deviceToken: FakeServer.deviceToken, api: PairingAPI(transport: server),
            onRevoked: {}, clock: { clock.now }
        )
        let remote = ConvexRemote(deploymentUrl: FakeServer.cloud, tokens: tokens, transport: server)
        return (repo, SyncEngine(repository: repo, sender: remote, source: remote, onStatus: { _ in }))
    }

    func sent() -> [(String, JSONValue)] {
        server.requests.filter { $0.path == "/api/mutation" }.map { ($0.body["path"]?.string ?? "", $0.body["args"]?.array?.first ?? .null) }
    }

    @Test func itSyncsAsBeforeAndProjectCallsReportTheRequirement() async throws {
        let (repo, engine) = try setUp()
        server.addElsewhere("From the CLI")
        let mine = try await repo.add(title: "Mine", dueDate: nil, dueTime: nil)
        // Before any snapshot: the server answers that it has no such function.
        await #expect(throws: requirement) { try await engine.addProject(name: "Dom") }
        #expect(try await repo.projectSupport() == .unsupported)
        #expect(try await repo.projects().isEmpty)
        #expect(try await repo.pendingOps().map(\.mutation) == [Mutations.add])
        for _ in 0..<3 {
            guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        }
        #expect(server.mutationsSent() == [Mutations.addProject, Mutations.add])
        #expect(try await repo.task(mine.localId)?.serverId != nil)
        #expect(try await repo.allTasks().count == 2)
        // Known now: refused on the Mac, nothing sent.
        await #expect(throws: requirement) { try await engine.addProject(name: "Dom") }
        await #expect(throws: requirement) { try await repo.setProject(mine.localId, "x") }
        #expect(server.mutationsSent() == [Mutations.addProject, Mutations.add])
    }

    @Test func taskChangesReachItWithoutTheirProjectAndKeepTheirMembershipHere() async throws {
        let (repo, engine) = try setUp()
        server.hasProjects = true
        let home = server.addProjectElsewhere("Dom")
        let t = server.addElsewhere("T")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        // Queued while the server had projects; it is rolled back to 0.12 before they are sent.
        let fresh = try await repo.add(title: "Written before the rollback", dueDate: nil, dueTime: nil, note: "Keep this note", projectLocalId: home)
        try await repo.setProject(t, home)
        try await repo.setNote(t, "Edited")
        server.hasProjects = false
        let before = sent().count
        guard case .synced = await engine.round() else { Issue.record("expected synced on the old server"); return }
        let calls = Array(sent().dropFirst(before))
        // The first change is refused once for its `projectId`; from then on none carries it.
        #expect(calls.map(\.0) == [Mutations.add, Mutations.add, Mutations.update, Mutations.update])
        #expect(calls.map { $0.1["projectId"] != nil } == [true, false, false, false])
        #expect(server.task(titled: "Written before the rollback")?["note"] == "Keep this note")
        #expect(server.task(titled: "T")?["note"] == "Edited")
        #expect(server.allTasks.allSatisfy { $0["projectId"] == nil })
        #expect(try await repo.task(fresh.localId)?.serverId != nil)
        #expect(try await repo.task(fresh.localId)?.projectLocalId == home)
        #expect(try await repo.task(t)?.projectLocalId == home)
        #expect(try await repo.projects().map(\.localId) == [home])
        #expect(try await repo.projectSupport() == .unsupported)
        #expect(try await repo.pendingOps().isEmpty)
        let sentNow = server.mutationsSent()
        guard case .synced = await engine.round() else { Issue.record("expected synced again"); return }
        #expect(server.mutationsSent() == sentNow)
    }

    @Test func projectsSyncedBeforeStayAndCannotChangeUntilAnUpgrade() async throws {
        let (repo, engine) = try setUp()
        server.hasProjects = true
        let home = server.addProjectElsewhere("Dom")
        let t = server.addElsewhere("T")
        server.editElsewhere(t, ["projectId": .string(home)])
        var support = repo.observeProjectSupport().makeAsyncIterator()
        #expect(try await support.next() == .unknown)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        server.hasProjects = false
        server.editElsewhere(t, ["note": "A newer task without a project field"])
        guard case .synced = await engine.round() else { Issue.record("expected synced on the old server"); return }
        var seen = try await support.next()
        while seen != nil && seen != .unsupported { seen = try await support.next() }
        #expect(seen == .unsupported)
        #expect(try await repo.task(t)?.note == "A newer task without a project field")
        #expect(try await repo.task(t)?.projectLocalId == home)
        await #expect(throws: requirement) { try await engine.updateProject(home, name: "Dom 2", color: nil, icon: "", note: "") }
        await #expect(throws: requirement) { try await engine.setArchived(home, true) }
        await #expect(throws: requirement) { try await engine.deleteProject(home, moveTasksTo: nil) }
        #expect(try await repo.projects().map(\.name) == ["Dom"])
        #expect(try await repo.pendingOps().isEmpty)

        // After the upgrade the Mac shows the server's projects and memberships, and can change projects again.
        server.editElsewhere(t, ["projectId": .null])
        server.hasProjects = true
        guard case .synced = await engine.round() else { Issue.record("expected synced after the upgrade"); return }
        seen = try await support.next()
        while seen != nil && seen != .supported { seen = try await support.next() }
        #expect(seen == .supported)
        #expect(try await repo.task(t)?.projectLocalId == nil)
        try await engine.setArchived(home, true)
        #expect(server.project(named: "Dom")?["archived"] == true)
        #expect(try await repo.pendingOps().isEmpty)
    }
}
