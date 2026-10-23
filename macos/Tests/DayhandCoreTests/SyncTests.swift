import Foundation
import Testing
@testable import DayhandCore

struct ConvexRemoteTests {
    @Test func onlyAFunctionThatRanAndRefusedIsFinal() {
        #expect(ConvexRemote.classify(HTTPReply(status: 200, json: ["status": "success", "value": ["id": "s1"]])) == .applied(["id": "s1"]))
        #expect(ConvexRemote.classify(HTTPReply(status: 560, json: ["status": "error", "errorMessage": "Task not found"])) == .rejected("Task not found"))
        #expect(ConvexRemote.classify(HTTPReply(status: 560, json: ["status": "error", "errorMessage": "x", "errorData": ["code": "unauthenticated"]])) == .unauthorized)
        #expect(ConvexRemote.classify(HTTPReply(status: 401, body: Data())) == .unauthorized)
        #expect(ConvexRemote.classify(HTTPReply(status: 502, body: Data())) == .failed("HTTP 502"))
        #expect(ConvexRemote.classify(HTTPReply(status: 404, body: Data("<html>".utf8))) == .failed("HTTP 404"))
        #expect(ConvexRemote.classify(HTTPReply(status: 200, body: Data("not json".utf8))) == .failed("unreadable answer"))
    }

    @Test func theRequestIsTheConvexHTTPAPIsShape() {
        let body = JSONValue.decode(ConvexRemote.requestBody(path: "app:add", args: ["title": "Milk", "interval": 1]))
        #expect(body == ["path": "app:add", "format": "convex_encoded_json", "args": [["title": "Milk", "interval": 1]]])
        // Whole numbers go out as integers, not `1.0`.
        #expect(ConvexRemote.requestBody(path: "p", args: ["n": 1]).contains("\"n\":1}"))
    }

    @Test func aRefusedTokenIsRefreshedAndTheCallTriedOnceMore() async {
        let server = FakeServer()
        let tokens = DeviceTokens(serverUrl: FakeServer.site, deviceToken: FakeServer.deviceToken, api: PairingAPI(transport: server), onRevoked: {})
        let remote = ConvexRemote(deploymentUrl: FakeServer.cloud, tokens: tokens, transport: server)
        guard case .applied = await remote.send(mutation: Mutations.add, args: ["title": "First"]) else { Issue.record("not applied"); return }
        server.expireTokens()
        guard case .applied = await remote.send(mutation: Mutations.add, args: ["title": "Second"]) else { Issue.record("not applied"); return }
        let bearers = server.requests.filter { $0.path == "/api/mutation" }.map(\.bearer)
        #expect(bearers == ["jwt-1", "jwt-1", "jwt-2"])
        #expect(server.allTasks.count == 2)
    }

    @Test func aSnapshotHasTheTasksTheTrashAndTheSettings() async throws {
        let server = FakeServer()
        let kept = server.addElsewhere("Kept", dueDate: "2026-10-22")
        let trashed = server.addElsewhere("Trashed")
        server.editElsewhere(trashed, ["deletedAt": 5])
        let remote = ConvexRemote(
            deploymentUrl: FakeServer.cloud,
            tokens: DeviceTokens(serverUrl: FakeServer.site, deviceToken: FakeServer.deviceToken, api: PairingAPI(transport: server), onRevoked: {}),
            transport: server
        )
        let snapshot = try await remote.snapshot().get()
        #expect(Set(snapshot.tasks.map(\.id)) == [kept, trashed])
        #expect(snapshot.tasks.first { $0.id == trashed }?.deletedAt == 5)
        #expect(snapshot.settings == ReminderSettings(timezone: "Europe/London", summaryTime: "05:00", reminderMinutes: [0]))
    }

    @Test func remoteTasksAreReadWithNumbersAsDoubles() throws {
        let json = JSONValue.decode(#"""
        {"id":"s1","clientId":"c1","title":"T","status":"doing","isNow":true,"createdAt":1.0,"updatedAt":2.0,
         "repeat":{"every":"month","interval":1.0,"weekdayOfMonth":{"nth":-1.0,"weekday":5.0}},
         "reminders":[{"minutesBefore":15.0},{"time":"18:00","daysBefore":1.0}],
         "checklist":[{"id":"a","title":"Milk","done":true}],"labels":["home"],"links":[{"url":"https://a.pl"}]}
        """#)
        let task = try #require(json.flatMap(RemoteJSON.task))
        #expect(task.repeat == RepeatRule(every: .month, weekdayOfMonth: WeekdayOfMonth(nth: -1, weekday: 5)))
        #expect(task.reminders == [.before(15), .at("18:00", daysBefore: 1)])
        #expect(task.checklist == [ChecklistItem(id: "a", title: "Milk", done: true)])
        #expect(task.updatedAt == 2)
        #expect(task.isNow)
    }
}

/// The repository changes the row and queues the mutation together, as the Android app's `TaskRepository`.
struct RepositoryTests {
    let clock = TestClock(utc("2026-10-22T09:00"))
    let ids = TestIds()

    func repository() throws -> TaskRepository {
        let clock = clock, ids = ids
        return TaskRepository(database: try AppDatabase.inMemory(), clock: { clock.now }, newId: { ids.next() })
    }

    @Test func addingWritesTheRowAndQueuesAddWithItsClientId() async throws {
        let repo = try repository()
        let added = try await repo.add(title: "  Call the accountant ", dueDate: "2026-10-23", dueTime: "14:00")
        #expect(added.localId == "id-1")
        #expect(added.title == "Call the accountant")
        let ops = try await repo.pendingOps()
        #expect(ops.map(\.mutation) == [Mutations.add])
        #expect(JSONValue.decode(ops[0].argsJson) == ["title": "Call the accountant", "dueDate": "2026-10-23", "dueTime": "14:00", "clientId": "id-1"])
        #expect(try await repo.task("id-1") == added)
    }

    @Test func aTimeWithoutADayIsDroppedAndBadInputIsRefused() async throws {
        let repo = try repository()
        let added = try await repo.add(title: "Untimed", dueDate: nil, dueTime: "14:00")
        #expect(added.dueTime == nil)
        await #expect(throws: RepositoryError.self) { try await repo.add(title: "   ", dueDate: nil, dueTime: nil) }
        await #expect(throws: RepositoryError.self) { try await repo.setDue(added.localId, date: "2026-02-30", time: nil) }
        #expect(try await repo.pendingOps().count == 1)
    }

    @Test func editsChangeTheRowAndQueueInOrder() async throws {
        let repo = try repository()
        let t = try await repo.add(title: "Task", dueDate: "2026-10-22", dueTime: nil)
        try await repo.rename(t.localId, to: "Renamed")
        try await repo.setDue(t.localId, date: "2026-10-24", time: "09:30")
        try await repo.setLabels(t.localId, [" home", "home", "work"])
        try await repo.complete(t.localId)
        let row = try #require(try await repo.task(t.localId))
        #expect(row.title == "Renamed")
        #expect(row.dueDate == "2026-10-24")
        #expect(row.dueTime == "09:30")
        #expect(row.labels == ["home", "work"])
        #expect(row.status == .done)
        #expect(row.completedAt == clock.now)
        let ops = try await repo.pendingOps()
        #expect(ops.map(\.mutation) == [Mutations.add, Mutations.update, Mutations.update, Mutations.update, Mutations.complete])
        #expect(JSONValue.decode(ops[2].argsJson)?["dueTime"] == "09:30")
        #expect(Set(ops.map(\.clientId)).count == ops.count)
    }

    @Test func oneNowTaskAtATime() async throws {
        let repo = try repository()
        let a = try await repo.add(title: "A", dueDate: nil, dueTime: nil)
        let b = try await repo.add(title: "B", dueDate: nil, dueTime: nil)
        try await repo.setNow(a.localId)
        try await repo.setNow(b.localId)
        #expect(try await repo.task(a.localId)?.isNow == false)
        #expect(try await repo.task(b.localId)?.isNow == true)
        #expect(try await repo.task(b.localId)?.status == .doing)
        try await repo.clearNow()
        #expect(try await repo.allTasks().allSatisfy { !$0.isNow })
        let last = try #require(try await repo.pendingOps().last)
        #expect(last.taskLocalId == nil)
        #expect(JSONValue.decode(last.argsJson)?["taskId"] == .null)
    }

    @Test func aTaskInTheTrashTakesNoChangeButRestore() async throws {
        let repo = try repository()
        let t = try await repo.add(title: "T", dueDate: nil, dueTime: nil)
        try await repo.moveToTrash(t.localId)
        try await repo.rename(t.localId, to: "Ignored")
        #expect(try await repo.task(t.localId)?.title == "T")
        try await repo.restore(t.localId)
        #expect(try await repo.task(t.localId)?.deletedAt == nil)
        #expect(try await repo.pendingOps().map(\.mutation) == [Mutations.add, Mutations.softDelete, Mutations.restore])
    }

    @Test func aRefusedAddTakesTheTaskAndItsLaterChangesAway() async throws {
        let repo = try repository()
        let t = try await repo.add(title: "T", dueDate: nil, dueTime: nil)
        try await repo.complete(t.localId)
        let add = try #require(try await repo.next())
        try await repo.reject(add, reason: "bad")
        #expect(try await repo.task(t.localId) == nil)
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test func anAcknowledgedAddGivesTheRowItsServerId() async throws {
        let repo = try repository()
        let t = try await repo.add(title: "T", dueDate: nil, dueTime: nil)
        let add = try #require(try await repo.next())
        try await repo.acknowledge(add, value: ["id": "srv1"])
        #expect(try await repo.task(t.localId)?.serverId == "srv1")
        #expect(try await repo.serverIdOf(t.localId) == "srv1")
        #expect(try await repo.next() == nil)
    }

    @Test func checklistChangesBuildOnTheCurrentList() async throws {
        let repo = try repository()
        let t = try await repo.add(title: "T", dueDate: nil, dueTime: nil)
        try await repo.addItem(t.localId, "Milk")
        try await repo.addItem(t.localId, "Bread")
        let items = try #require(try await repo.task(t.localId)?.checklist)
        try await repo.toggleItem(t.localId, items[0].id)
        #expect(try await repo.task(t.localId)?.checklist.map(\.done) == [true, false])
        let last = try #require(try await repo.pendingOps().last)
        #expect(JSONValue.decode(last.argsJson)?["checklist"]?.array?.count == 2)
    }
}

/// The outbox and the poll together, against the fake server: offline first, in order, once.
struct SyncEngineTests {
    let clock = TestClock(utc("2026-10-22T09:00"))
    let server = FakeServer()

    func setUp(onRevoked: @escaping @Sendable () async -> Void = {}) throws -> (TaskRepository, SyncEngine, StatusLog) {
        let clock = clock, ids = TestIds()
        server.clock = { clock.now }
        let repo = TaskRepository(database: try AppDatabase.inMemory(), clock: { clock.now }, newId: { ids.next() })
        let tokens = DeviceTokens(
            serverUrl: FakeServer.site, deviceToken: FakeServer.deviceToken, api: PairingAPI(transport: server),
            onRevoked: onRevoked, clock: { clock.now }
        )
        let remote = ConvexRemote(deploymentUrl: FakeServer.cloud, tokens: tokens, transport: server)
        let log = StatusLog()
        let engine = SyncEngine(repository: repo, sender: remote, source: remote, onStatus: { log.append($0) })
        return (repo, engine, log)
    }

    @Test func changesMadeOfflineReachTheServerInOrderWhenItIsBack() async throws {
        let (repo, engine, _) = try setUp()
        server.offline = true
        let t = try await repo.add(title: "Written on a plane", dueDate: "2026-10-22", dueTime: nil)
        try await repo.rename(t.localId, to: "Written on a plane, renamed")
        try await repo.complete(t.localId)
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }
        #expect(try await repo.pendingOps().count == 3)
        #expect(try await repo.task(t.localId)?.title == "Written on a plane, renamed")

        server.offline = false
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(try await repo.pendingOps().isEmpty)
        #expect(server.mutationsSent().suffix(3) == [Mutations.add, Mutations.update, Mutations.complete])
        let onServer = try #require(server.task(titled: "Written on a plane, renamed"))
        #expect(onServer["status"] == "done")
        #expect(onServer["clientId"] == .string(t.localId))
        let row = try #require(try await repo.task(t.localId))
        #expect(row.serverId == onServer["id"]?.string)
        #expect(row.serverUpdatedAt != nil)
    }

    @Test func aChangeWhoseAnswerWasLostIsResentAndAppliedOnce() async throws {
        let (repo, engine, _) = try setUp()
        _ = try await repo.add(title: "Once", dueDate: nil, dueTime: nil)
        server.loseNextAnswer = true
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }
        #expect(try await repo.pendingOps().count == 1)
        await engine.round()
        #expect(server.allTasks.filter { $0["title"] == "Once" }.count == 1)
        #expect(try await repo.allTasks().count == 1)
    }

    @Test func tasksAddedElsewhereArriveAndEditsElsewhereWinWhereNothingWaits() async throws {
        let (repo, engine, _) = try setUp()
        let id = server.addElsewhere("From the agent", dueDate: "2026-10-22")
        await engine.round()
        let row = try #require(try await repo.task(id))
        #expect(row.title == "From the agent")
        #expect(row.serverId == id)

        clock.advance(1000)
        server.editElsewhere(id, ["title": "Renamed by the agent", "updatedAt": .of(clock.now)])
        await engine.round()
        #expect(try await repo.task(id)?.title == "Renamed by the agent")
    }

    @Test func aWaitingLocalChangeKeepsItsFieldAgainstTheSnapshot() async throws {
        let (repo, engine, _) = try setUp()
        let id = server.addElsewhere("Shared", dueDate: "2026-10-22")
        await engine.round()
        try await repo.rename(id, to: "Mine")
        clock.advance(1000)
        server.editElsewhere(id, ["note": "agent note", "updatedAt": .of(clock.now)])
        // Sending fails, but the snapshot read in the same round must not undo the waiting rename.
        server.failNextMutation = true
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }
        #expect(server.task(titled: "Mine") == nil)
        let row = try #require(try await repo.task(id))
        #expect(row.title == "Mine")
        #expect(row.note == "agent note")
        await engine.round()
        #expect(server.task(titled: "Mine") != nil)
    }

    @Test func aRevokedDeviceStopsWithChangesKept() async throws {
        let revoked = Counter()
        let (repo, engine, log) = try setUp(onRevoked: { revoked.increment() })
        _ = try await repo.add(title: "Kept", dueDate: nil, dueTime: nil)
        server.revoked = true
        #expect(await engine.round() == .signedOut)
        #expect(revoked.value == 1)
        #expect(try await repo.pendingOps().count == 1)
        #expect(log.last == .signedOut)
    }

    @Test func aChangeTheServerRefusesIsDroppedAndTheNextSnapshotRepairsTheRow() async throws {
        let (repo, engine, _) = try setUp()
        let id = server.addElsewhere("Exists", dueDate: "2026-10-22")
        await engine.round()
        server.editElsewhere(id, ["deletedAt": .of(clock.now)])
        try await repo.rename(id, to: "Too late")
        await engine.round()
        #expect(try await repo.pendingOps().isEmpty)
        let row = try #require(try await repo.task(id))
        #expect(row.title == "Exists")
        #expect(row.inTrash)
    }

    @Test func theLoopRunsAtOnceWhenPoked() async throws {
        let (repo, engine, log) = try setUp()
        await engine.start()
        try await waitUntil { log.count >= 2 }
        _ = try await repo.add(title: "Poked", dueDate: nil, dueTime: nil)
        engine.poke()
        try await waitUntil { server.task(titled: "Poked") != nil }
        await engine.stop()
    }

    func waitUntil(_ condition: @escaping () -> Bool) async throws {
        for _ in 0..<200 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        Issue.record("timed out")
    }
}

final class StatusLog: @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [SyncStatus] = []
    func append(_ status: SyncStatus) { lock.locked { entries.append(status) } }
    var last: SyncStatus? { lock.locked { entries.last } }
    var count: Int { lock.locked { entries.count } }
}
