import Foundation
import Testing
@testable import DayhandCore

/// Changing the morning summary and the default reminders on the Mac: at once here, through the outbox to the
/// server, never undone by a snapshot taken while the change waits (as the Android app's `SnapshotMergerTest`).
struct SettingsSyncTests {
    let clock = TestClock(utc("2026-10-22T09:00"))
    let server = FakeServer()

    func setUp() throws -> (TaskRepository, SyncEngine) {
        let clock = clock, ids = TestIds()
        server.clock = { clock.now }
        let repo = TaskRepository(database: try AppDatabase.inMemory(), clock: { clock.now }, newId: { ids.next() }, localTimezone: { "Europe/Warsaw" })
        let tokens = DeviceTokens(
            serverUrl: FakeServer.site, deviceToken: FakeServer.deviceToken, api: PairingAPI(transport: server),
            onRevoked: {}, clock: { clock.now }
        )
        let remote = ConvexRemote(deploymentUrl: FakeServer.cloud, tokens: tokens, transport: server)
        return (repo, SyncEngine(repository: repo, sender: remote, source: remote, onStatus: { _ in }))
    }

    @Test func aWaitingChangeKeepsItsFieldsAndTheRestFollowsTheServer() {
        let local = ReminderSettings(timezone: "Europe/Warsaw", summaryTime: "07:30", reminderMinutes: [15])
        let remote = ReminderSettings(timezone: "Europe/London", summaryTime: "05:00", reminderMinutes: [0])
        let summaryOnly = OutboxOp(opId: "o1", mutation: Mutations.updateSettings, argsJson: #"{"summaryTime":"07:30","clientId":"o1"}"#, taskLocalId: nil, clientId: "o1", createdAt: 1)
        let minutesOnly = OutboxOp(opId: "o2", mutation: Mutations.updateSettings, argsJson: #"{"defaultReminderMinutes":[15],"clientId":"o2"}"#, taskLocalId: nil, clientId: "o2", createdAt: 2)
        let taskChange = OutboxOp(opId: "o3", mutation: Mutations.update, argsJson: #"{"summaryTime":"x","clientId":"o3"}"#, taskLocalId: "t", clientId: "o3", createdAt: 3)

        #expect(SnapshotMerger.settings(local: local, pending: [], remote: remote) == remote)
        #expect(SnapshotMerger.settings(local: local, pending: [summaryOnly, taskChange], remote: remote)
            == ReminderSettings(timezone: "Europe/London", summaryTime: "07:30", reminderMinutes: [0]))
        #expect(SnapshotMerger.settings(local: local, pending: [summaryOnly, minutesOnly], remote: remote)
            == ReminderSettings(timezone: "Europe/London", summaryTime: "07:30", reminderMinutes: [15]))
    }

    @Test func aChangeShowsAtOnceAndQueuesOneUpdate() async throws {
        let (repo, _) = try setUp()
        try await repo.updateSettings(summaryTime: "07:30", reminderMinutes: [30, 0, 30])
        let settings = try await repo.settings()
        #expect(settings.summaryTime == "07:30")
        #expect(settings.reminderMinutes == [0, 30])
        let ops = try await repo.pendingOps()
        #expect(ops.map(\.mutation) == [Mutations.updateSettings])
        #expect(ops[0].taskLocalId == nil)
        let args = JSONValue.decode(ops[0].argsJson)
        #expect(args?["summaryTime"] == "07:30")
        #expect(args?["defaultReminderMinutes"] == [0, 30])
        #expect(args?["clientId"]?.string == ops[0].clientId)
        #expect(args?["timezone"] == nil)
    }

    @Test func settingsTheBackendRefusesNeverReachTheOutbox() async throws {
        let (repo, _) = try setUp()
        await #expect(throws: RepositoryError.self) { try await repo.updateSettings(summaryTime: "25:00") }
        await #expect(throws: RepositoryError.self) { try await repo.updateSettings(reminderMinutes: [-5]) }
        await #expect(throws: RepositoryError.self) { try await repo.updateSettings(reminderMinutes: [TaskRules.maxReminderMinutes + 1]) }
        try await repo.updateSettings()
        #expect(try await repo.pendingOps().isEmpty)
        // No reminders at all is a choice the backend accepts.
        try await repo.updateSettings(reminderMinutes: [])
        #expect(try await repo.settings().reminderMinutes == [])
    }

    @Test func aSnapshotTakenWhileTheChangeWaitsDoesNotUndoIt() async throws {
        let (repo, engine) = try setUp()
        await engine.round()
        #expect(try await repo.settings().summaryTime == "05:00")

        // The server is busy: the change stays in the outbox, but the round still reads a snapshot.
        server.failNextMutation = true
        server.editSettingsElsewhere(["timezone": "Europe/Warsaw"])
        try await repo.updateSettings(summaryTime: "07:30", reminderMinutes: [15])
        let status = await engine.round()
        guard case .offline = status else { Issue.record("expected offline, got \(status)"); return }
        var settings = try await repo.settings()
        #expect(settings.summaryTime == "07:30")
        #expect(settings.reminderMinutes == [15])
        // A field the change does not set follows the server.
        #expect(settings.timezone == "Europe/Warsaw")

        await engine.round()
        #expect(try await repo.pendingOps().isEmpty)
        #expect(server.settings["summaryTime"] == "07:30")
        #expect(server.settings["defaultReminderMinutes"] == [15])
        settings = try await repo.settings()
        #expect(settings.summaryTime == "07:30" && settings.reminderMinutes == [15])

        // Once sent, a change made elsewhere wins again.
        server.editSettingsElsewhere(["summaryTime": "06:00"])
        await engine.round()
        #expect(try await repo.settings().summaryTime == "06:00")
    }

    @Test func aChangeMadeOfflineIsSentWhenTheServerAnswersAgain() async throws {
        let (repo, engine) = try setUp()
        await engine.round()
        server.offline = true
        try await repo.updateSettings(reminderMinutes: [0, 60])
        await engine.round()
        #expect(try await repo.settings().reminderMinutes == [0, 60])
        server.offline = false
        await engine.round()
        // The try while offline is in the requests too; the outbox is empty once the server answered.
        #expect(Set(server.mutationsSent()) == [Mutations.updateSettings])
        #expect(try await repo.pendingOps().isEmpty)
        #expect(server.settings["defaultReminderMinutes"] == [0, 60])
        #expect(try await repo.settings().reminderMinutes == [0, 60])
    }

    @Test func aRefusedChangeIsRepairedByTheNextSnapshot() async throws {
        let (repo, engine) = try setUp()
        await engine.round()
        server.rejectNextMutation = true
        try await repo.updateSettings(summaryTime: "07:30")
        await engine.round()
        #expect(try await repo.pendingOps().isEmpty)
        #expect(try await repo.settings().summaryTime == "05:00")
    }
}
