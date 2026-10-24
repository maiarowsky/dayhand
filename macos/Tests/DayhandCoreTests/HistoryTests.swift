import Foundation
import Testing
@testable import DayhandCore

/// Reading one history event, as the Android app's `HistoryEntriesTest`.
struct HistoryEntryTests {
    @Test func aNewTaskShowsOnlyTheFieldsItSet() {
        let event = TaskEvent(
            taskServerId: "s1", at: 1, actor: "app", action: "create",
            afterJson: #"{"title":"Milk","status":"todo","isNow":false,"labels":[],"dueDate":"2026-10-22","completedAt":null}"#
        )
        let entry = event.entry
        #expect(entry.actor == .app)
        #expect(entry.changes.map(\.field) == [.title, .status, .dueDate])
        #expect(entry.changes.first == FieldChange(field: .title, before: .null, after: "Milk"))
    }

    @Test func anEditShowsWhatChangedInTheOrderOfTheDetails() {
        let event = TaskEvent(
            taskServerId: "s1", at: 1, actor: "agent", actorName: "claude", action: "update",
            beforeJson: #"{"note":null,"dueTime":"11:00","completedAt":5,"labels":["home"]}"#,
            afterJson: #"{"note":"Ask about VAT","dueTime":"14:00","completedAt":null,"labels":["home"]}"#
        )
        let entry = event.entry
        #expect(entry.actor == .agent(name: "claude"))
        // Timestamps are left out (the action says it) and an unchanged value is not a change.
        #expect(entry.changes == [
            FieldChange(field: .dueTime, before: "11:00", after: "14:00"),
            FieldChange(field: .note, before: .null, after: "Ask about VAT"),
        ])
    }

    @Test func whoMadeTheChange() {
        #expect(HistoryActor.fromWire("app", name: nil) == .app)
        #expect(HistoryActor.fromWire("cli", name: "laptop") == .cli)
        #expect(HistoryActor.fromWire("agent", name: "") == .agent(name: nil))
        // Anything unknown is never shown as the user's own change.
        #expect(HistoryActor.fromWire("robot", name: nil) == .agent(name: nil))
    }

    @Test func theServersHistoryIsReadNewestFirstWithNumbersAsDoubles() throws {
        let value = try #require(JSONValue.decode(#"""
        {"task":{"id":"s1"},"history":[
          {"at":1.0,"actor":"app","actorName":null,"by":"app","action":"create","before":null,"after":{"title":"T"}},
          {"at":3.0,"actor":"agent","actorName":"claude","by":"agent: claude","action":"complete","before":{"status":"todo"},"after":{"status":"done"}},
          {"at":2.0,"actor":"cli","action":"update","before":{"title":"T"},"after":{"title":"U"}}
        ]}
        """#))
        let events = RemoteJSON.history(value, serverId: "s1")
        #expect(events.map(\.at) == [3, 2, 1])
        #expect(events[0].actorName == "claude")
        #expect(events[0].action == "complete")
        #expect(events[2].beforeJson == nil)
        #expect(events.allSatisfy { $0.taskServerId == "s1" })
    }

    @Test func aTaskInTheTrashKnowsWhenItGoesForGood() {
        let deleted = utc("2026-10-22T10:00")
        let item = task("t") { $0.deletedAt = deleted }
        #expect(item.goneForGoodAt == deleted + 30 * 86_400_000)
        #expect(task("u").goneForGoodAt == nil)
    }
}

/// The history against the fake server: fetched, cached, shown offline.
struct TaskHistorySyncTests {
    let clock = TestClock(utc("2026-10-22T09:00"))
    let server = FakeServer()

    func setUp() throws -> (TaskRepository, SyncEngine, ConvexRemote) {
        let clock = clock, ids = TestIds()
        server.clock = { clock.now }
        let repo = TaskRepository(database: try AppDatabase.inMemory(), clock: { clock.now }, newId: { ids.next() })
        let tokens = DeviceTokens(
            serverUrl: FakeServer.site, deviceToken: FakeServer.deviceToken, api: PairingAPI(transport: server),
            onRevoked: {}, clock: { clock.now }
        )
        let remote = ConvexRemote(deploymentUrl: FakeServer.cloud, tokens: tokens, transport: server)
        return (repo, SyncEngine(repository: repo, sender: remote, source: remote, onStatus: { _ in }), remote)
    }

    @Test func theHistoryShowsWhoChangedWhatAndStaysOfflineFromTheCache() async throws {
        let (repo, engine, remote) = try setUp()
        let history = TaskHistorySync(repository: repo, runner: { remote })
        let added = try await repo.add(title: "Call the accountant", dueDate: "2026-10-22", dueTime: nil)
        await engine.round()
        let serverId = try #require(try await repo.task(added.localId)?.serverId)

        clock.advance(60_000)
        try await repo.setDue(added.localId, date: "2026-10-23", time: "14:00")
        await engine.round()
        clock.advance(60_000)
        server.editElsewhere(serverId, ["status": "done", "completedAt": .of(clock.now)], action: "complete")
        await engine.round()

        #expect(await history.refresh(serverId: serverId) == .fresh)
        let entries = try await repo.history(serverId).map(\.entry)
        #expect(entries.map(\.action) == ["complete", "update", "create"])
        #expect(entries.map(\.actor) == [.agent(name: "claude"), .app, .app])
        #expect(entries[0].changes.first == FieldChange(field: .status, before: "todo", after: "done"))
        #expect(entries[1].changes == [
            FieldChange(field: .dueDate, before: "2026-10-22", after: "2026-10-23"),
            FieldChange(field: .dueTime, before: .null, after: "14:00"),
        ])

        // Offline: the cached copy stays and says so.
        server.offline = true
        #expect(await history.refresh(serverId: serverId) == .cached)
        #expect(try await repo.history(serverId).map(\.action) == ["complete", "update", "create"])
        // No server connected at all: the same.
        #expect(await TaskHistorySync(repository: repo, runner: { nil }).refresh(serverId: serverId) == .cached)
    }

    @Test func theServersCopyReplacesTheCacheAndGoesWithItsTask() async throws {
        let (repo, engine, remote) = try setUp()
        let history = TaskHistorySync(repository: repo, runner: { remote })
        let id = server.addElsewhere("From the agent")
        await engine.round()
        try await repo.saveHistory(id, [TaskEvent(taskServerId: id, at: 1, actor: "app", action: "stale")])
        #expect(await history.refresh(serverId: id) == .fresh)
        #expect(try await repo.history(id).map(\.action) == ["create"])

        // Gone from the server for good (purged from the trash): the task and its history leave the Mac.
        server.editElsewhere(id, ["deletedAt": .of(clock.now)], action: "delete")
        await engine.round()
        #expect(try await repo.task(id)?.inTrash == true)
        #expect(try await repo.history(id).count == 1)
        server.purge(id)
        await engine.round()
        #expect(try await repo.task(id) == nil)
        #expect(try await repo.history(id).isEmpty)
    }

    @Test func eraseAllForgetsTheHistory() async throws {
        let repo = TaskRepository(database: try AppDatabase.inMemory())
        try await repo.saveHistory("s1", [TaskEvent(taskServerId: "s1", at: 1, actor: "app", action: "create")])
        try await repo.eraseAll()
        #expect(try await repo.history("s1").isEmpty)
    }
}

/// The trash as the sidebar lists it: restored tasks leave it, also offline.
struct TrashTests {
    @Test func restoringATaskTakesItOutOfTheTrashAndQueuesRestore() async throws {
        let clock = TestClock(utc("2026-10-22T09:00"))
        let ids = TestIds()
        let repo = TaskRepository(database: try AppDatabase.inMemory(), clock: { clock.now }, newId: { ids.next() })
        let first = try await repo.add(title: "First", dueDate: nil, dueTime: nil)
        let second = try await repo.add(title: "Second", dueDate: nil, dueTime: nil)
        try await repo.moveToTrash(first.localId)
        clock.advance(1000)
        try await repo.moveToTrash(second.localId)
        #expect(try await repo.allTasks().filter(\.inTrash).count == 2)

        try await repo.restore(first.localId)
        let rows = try await repo.allTasks()
        #expect(rows.filter(\.inTrash).map(\.localId) == [second.localId])
        #expect(rows.first { $0.localId == first.localId }?.isActive == true)
        #expect(try await repo.pendingOps().map(\.mutation).suffix(3) == [Mutations.softDelete, Mutations.softDelete, Mutations.restore])
    }
}
