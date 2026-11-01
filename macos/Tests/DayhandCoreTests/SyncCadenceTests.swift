import Foundation
import Testing
@testable import DayhandCore

/// Virtual elapsed time, but the real scheduler, SQLite merge, outbox and ConvexRemote HTTP query path.
struct SyncCadenceTests {
    let clock = TestClock(0)
    let server = FakeServer()

    func setup() throws -> (TaskRepository, SyncEngine) {
        let clock = clock
        server.clock = { clock.now }
        let repo = TaskRepository(database: try AppDatabase.inMemory(), clock: { clock.now })
        let tokens = DeviceTokens(serverUrl: FakeServer.site, deviceToken: FakeServer.deviceToken, api: PairingAPI(transport: server), onRevoked: {})
        let remote = ConvexRemote(deploymentUrl: FakeServer.cloud, tokens: tokens, transport: server)
        let engine = SyncEngine(repository: repo, sender: remote, source: remote, now: { .milliseconds(clock.now) }, onStatus: { _ in })
        return (repo, engine)
    }

    var queries: [String] {
        server.requests.filter { $0.path == "/api/query" }.compactMap { $0.body["path"]?.string }
    }

    func assertReads(_ rounds: Int) {
        #expect(queries.count == rounds * 4)
        for path in [RemoteJSON.queryTasks, RemoteJSON.queryTrash, RemoteJSON.querySettings, RemoteJSON.queryProjects] {
            #expect(queries.filter { $0 == path }.count == rounds)
        }
    }

    /// Half-open hours [start, end): includes the startup read, not the read at exactly the next hour.
    func hour(_ engine: SyncEngine, startingAt start: Int64 = 0, changing id: String? = nil) async -> Int {
        var rounds = 0
        for second in start..<(start + 3600) {
            clock.set(second * 1000)
            if let id, second % 60 == 0 { server.editElsewhere(id, ["note": .string("revision \(second)")]) }
            if await engine.pollIfDue() != nil { rounds += 1 }
        }
        return rounds
    }

    @Test func hourlyReadsAtBaseWithServerChanges() async throws {
        let (_, engine) = try setup()
        let id = server.addElsewhere("Changes elsewhere")
        #expect(await hour(engine, changing: id) == 60)
        assertReads(60) // Previously: 240 rounds / 960 snapshot queries at 15 s.
        #expect(await engine.nextPollDelay == .seconds(1))
    }

    @Test func idleFirstHourAndSteadyState() async throws {
        let (_, engine) = try setup()
        #expect(await hour(engine) == 17)
        assertReads(17)
        #expect(await hour(engine, startingAt: 3600) == 12)
        assertReads(29)
    }

    @Test func anObservedServerChangeRestartsTheIdleHour() async throws {
        let (_, engine) = try setup()
        #expect(await hour(engine) == 17)
        _ = server.addElsewhere("New on server")
        // The previous idle hour last read at 3360 s: the change is discovered at 3660 s.
        #expect(await hour(engine, startingAt: 3660) == 17)
        assertReads(34)
    }

    @Test func backgroundReadsAtMostTwelveTimesPerHour() async throws {
        let (_, engine) = try setup()
        await engine.setActive(false)
        #expect(await hour(engine) == 12)
        assertReads(12)
    }

    @Test func backoffOnlyAfterThreeUnchangedMergesAtEachInterval() {
        var cadence = SyncCadence()
        #expect(cadence.interval == .seconds(60))
        for expected in [120, 240, 300, 300] {
            let previous = cadence.interval
            cadence.merged(changed: false)
            cadence.merged(changed: false)
            #expect(cadence.interval == previous)
            cadence.merged(changed: false)
            #expect(cadence.interval == .seconds(expected))
        }
        cadence.merged(changed: true)
        #expect(cadence.interval == .seconds(60))
        #expect(cadence.unchangedRounds == 0)
    }

    @Test func settingsProjectsAndTasksEachResetBackoffWhenTheMergeChanges() async throws {
        let (_, engine) = try setup()
        let id = server.addElsewhere("Task")
        let project = server.addProjectElsewhere("Project")
        for change in 0..<3 {
            for _ in 0..<12 {
                clock.advance(Int64(Signal.nanoseconds(await engine.nextPollDelay) / 1_000_000))
                await engine.pollIfDue()
            }
            #expect(await engine.nextPollDelay == .seconds(300))
            clock.advance(300_000)
            switch change {
            case 0: server.editSettingsElsewhere(["summaryTime": "08:00"])
            case 1: server.editProjectElsewhere(project, ["name": "Renamed"])
            default: server.editElsewhere(id, ["title": "Renamed"])
            }
            await engine.pollIfDue()
            #expect(await engine.nextPollDelay == .seconds(60))
        }
    }

    @Test func localPokeDrainsInOrderImmediatelyEvenInBackground() async throws {
        let (repo, engine) = try setup()
        await engine.setActive(false)
        await engine.pollIfDue()
        clock.advance(1000)
        let task = try await repo.add(title: "Local", dueDate: nil, dueTime: nil)
        try await repo.rename(task.localId, to: "Renamed")
        try await repo.complete(task.localId)
        await engine.requestSync() // The actor entry used by nonisolated poke().
        #expect(await engine.nextPollDelay == .zero)
        await engine.pollIfDue()
        #expect(try await repo.pendingOps().isEmpty)
        #expect(server.mutationsSent() == [Mutations.add, Mutations.update, Mutations.complete])
        let calls = server.requests.filter { $0.path == "/api/query" || $0.path == "/api/mutation" }.compactMap { $0.body["path"]?.string }
        #expect(Array(calls.dropFirst(4).prefix(4)) == [Mutations.add, Mutations.update, Mutations.complete, RemoteJSON.queryTasks])
        #expect(await engine.nextPollDelay == .seconds(300))
        await engine.setActive(true)
        #expect(await engine.nextPollDelay == .zero)
        await engine.pollIfDue()
        #expect(await engine.nextPollDelay == .seconds(60))
    }

    @Test func pokeResetsAnIdleForegroundEvenWhenTheSnapshotDoesNotChange() async throws {
        let (_, engine) = try setup()
        _ = await hour(engine)
        await engine.requestSync()
        #expect(await engine.nextPollDelay == .zero)
        await engine.pollIfDue()
        #expect(await engine.nextPollDelay == .seconds(60))
    }

    @Test func userActionManualSyncAndForegroundResetIdleWait() async throws {
        let (_, engine) = try setup()
        _ = await hour(engine)
        await engine.userActivity()
        #expect(await engine.nextPollDelay == .zero) // Last read is older than 60 s.
        await engine.pollIfDue()
        #expect(await engine.nextPollDelay == .seconds(60))
        clock.advance(1000)
        await engine.userActivity()
        #expect(await engine.nextPollDelay == .seconds(59)) // No per-keystroke query.
        #expect(await engine.pollIfDue() == nil)
        await engine.round()
        #expect(await engine.nextPollDelay == .seconds(60))
        await engine.setActive(false)
        #expect(await engine.nextPollDelay == .seconds(300))
        clock.advance(299_000)
        #expect(await engine.pollIfDue() == nil)
        await engine.setActive(true)
        await engine.pollIfDue()
        #expect(await engine.nextPollDelay == .seconds(60))
    }

    @Test func failedReadsDoNotCountAsUnchangedAndKeepTheQueue() async throws {
        let (repo, engine) = try setup()
        server.offline = true
        _ = try await repo.add(title: "Waiting", dueDate: nil, dueTime: nil)
        #expect(await hour(engine) == 60)
        #expect(try await repo.pendingOps().count == 1)
        clock.set(3_600_000)
        server.offline = false
        await engine.pollIfDue()
        #expect(try await repo.pendingOps().isEmpty)
        #expect(await engine.nextPollDelay == .seconds(60))
    }

    @Test func pokeDuringASnapshotIsNotLostAndTheLoopSendsBeforeReadingAgain() async throws {
        let transport = HeldSnapshot(server: server)
        let tokens = DeviceTokens(serverUrl: FakeServer.site, deviceToken: FakeServer.deviceToken, api: PairingAPI(transport: transport), onRevoked: {})
        let remote = ConvexRemote(deploymentUrl: FakeServer.cloud, tokens: tokens, transport: transport)
        let repo = TaskRepository(database: try AppDatabase.inMemory())
        let log = StatusLog()
        let engine = SyncEngine(repository: repo, sender: remote, source: remote, onStatus: { log.append($0) })
        await engine.start()
        for _ in 0..<200 where !(await transport.paused) { try await Task.sleep(nanoseconds: 1_000_000) }
        #expect(await transport.paused)
        let task = try await repo.add(title: "During read", dueDate: nil, dueTime: nil)
        engine.poke()
        await transport.release()
        for _ in 0..<500 where log.count < 3 { try await Task.sleep(nanoseconds: 1_000_000) }
        await engine.stop()
        #expect(log.count == 3) // connecting, initial snapshot, immediate follow-up; no timer elapsed.
        #expect(try await repo.pendingOps().isEmpty)
        #expect(try await repo.task(task.localId)?.serverId != nil)
        #expect(server.mutationsSent() == [Mutations.add])
    }
}

private actor HeldSnapshot: HTTPTransport {
    let server: FakeServer
    private var held = false
    private var continuation: CheckedContinuation<Void, Never>?
    var paused: Bool { continuation != nil }

    init(server: FakeServer) { self.server = server }

    func post(_ url: URL, json: Data, bearer: String?) async throws -> HTTPReply {
        let reply = try await server.post(url, json: json, bearer: bearer)
        if !held, JSONValue.decode(json)?["path"]?.string == RemoteJSON.queryProjects {
            held = true
            await withCheckedContinuation { continuation = $0 }
        }
        return reply
    }

    func release() {
        continuation?.resume()
        continuation = nil
    }
}
