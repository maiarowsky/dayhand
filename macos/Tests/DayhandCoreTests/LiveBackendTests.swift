import Foundation
import Testing
@testable import DayhandCore

/**
 * Against a real local backend (`npm run backend:start` in backend/, never production): pairs with a code from
 * `hlm pair`, works offline, syncs, and checks every change on the server. Off unless these are set:
 *
 *     DAYHAND_LIVE_SITE=http://127.0.0.1:3211   # the HTTP actions URL
 *     DAYHAND_LIVE_CODE=XXXX-XXXX-XXXX          # from hlm pair, used once
 *     DAYHAND_LIVE_CLI_TASK="<title>"           # optional: a task added with hlm before the run
 */
@Suite(.enabled(if: LiveBackend.site != nil && LiveBackend.code != nil), .serialized)
struct LiveBackendTests {
    @Test func pairWorkOfflineAndSyncAgainstARealBackend() async throws {
        let site = try #require(LiveBackend.site), code = try #require(LiveBackend.code)
        let pairing = DevicePairing(api: PairingAPI(), store: MemoryCredentialStore())
        #expect(await pairing.connect(address: site, code: "AAAA-AAAA-AAAA", deviceName: "Dayhand E2E") == .failure(.invalidCode))
        let credential = try await pairing.connect(address: site, code: code, deviceName: "Dayhand E2E").get()
        #expect(credential.deviceName == "Dayhand E2E")
        #expect(credential.deviceToken.hasPrefix("helmdev_"))

        let transport = SwitchableTransport()
        let tokens = DeviceTokens(
            serverUrl: credential.serverUrl, deviceToken: credential.deviceToken, api: PairingAPI(transport: transport), onRevoked: {}
        )
        let remote = ConvexRemote(deploymentUrl: credential.convexUrl, tokens: tokens, transport: transport)
        let repo = TaskRepository(database: try AppDatabase.inMemory())
        let engine = SyncEngine(repository: repo, sender: remote, source: remote, onStatus: { _ in })

        // The first round downloads the plan, a task the CLI added included.
        guard case .synced = await engine.round() else { Issue.record("first round did not sync"); return }
        if let cliTask = LiveBackend.cliTask {
            #expect(try await repo.allTasks().contains { $0.title == cliTask && $0.serverId != nil })
        }
        let settings = try await repo.settings()
        let now = Clock.nowMs()
        let today = HelmDates.localDate(now, settings.timezone)
        let run = String(now % 100_000)

        // Quick add with a date phrase, a task done today, and one written offline.
        let phrase = QuickAdd.parse("E2E \(run) call the accountant fri 2pm", now: now, timezone: settings.timezone)
        let accountant = try await repo.add(title: phrase.title, dueDate: phrase.when?.date, dueTime: phrase.when?.time)
        let done = try await repo.add(title: "E2E \(run) done today", dueDate: today, dueTime: nil)
        try await repo.complete(done.localId)
        transport.offline = true
        let offline = try await repo.add(title: "E2E \(run) written offline", dueDate: today, dueTime: "18:00")
        try await repo.setNow(offline.localId)
        try await repo.setResumeNote(offline.localId, "page 3")
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }
        #expect(try await repo.pendingOps().map(\.mutation) == [Mutations.add, Mutations.add, Mutations.complete, Mutations.add, Mutations.setNow, Mutations.update])
        #expect(todaySections(try await repo.allTasks(), nowMs: Clock.nowMs(), timezone: settings.timezone).now?.localId == offline.localId)

        transport.offline = false
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(try await repo.pendingOps().isEmpty)

        // What a fresh client reads from the server.
        let check = ConvexRemote(deploymentUrl: credential.convexUrl, tokens: tokens)
        let server = try await check.snapshot().get().tasks
        let onServer = { (title: String) in server.first { $0.title == title } }
        let a = try #require(onServer(phrase.title))
        #expect(a.dueDate == phrase.when?.date)
        #expect(a.dueTime == "14:00")
        #expect(a.clientId == accountant.localId)
        #expect(onServer("E2E \(run) done today")?.status == "done")
        let o = try #require(onServer("E2E \(run) written offline"))
        #expect(o.isNow)
        #expect(o.status == "doing")
        #expect(o.resumeNote == "page 3")
        #expect(o.dueTime == "18:00")

        // Edits from the Mac, then the trash: the server agrees, and a second round changes nothing.
        try await repo.rename(accountant.localId, to: "E2E \(run) call the accountant about VAT")
        try await repo.setLabels(accountant.localId, ["e2e", "home"])
        try await repo.moveToTrash(done.localId)
        try await repo.clearNow()
        await engine.round()
        let after = try await check.snapshot().get().tasks
        #expect(after.first { $0.id == a.id }?.title == "E2E \(run) call the accountant about VAT")
        #expect(after.first { $0.id == a.id }?.labels == ["e2e", "home"])
        #expect(after.first { $0.title == "E2E \(run) done today" }?.deletedAt != nil)
        #expect(after.allSatisfy { !$0.isNow })
        let before = try await repo.allTasks()
        await engine.round()
        #expect(try await repo.allTasks() == before)
    }
}

enum LiveBackend {
    static let site = ProcessInfo.processInfo.environment["DAYHAND_LIVE_SITE"]
    static let code = ProcessInfo.processInfo.environment["DAYHAND_LIVE_CODE"]
    static let cliTask = ProcessInfo.processInfo.environment["DAYHAND_LIVE_CLI_TASK"]
}

/// The real network, with a switch that makes it fail as if the Mac were offline.
final class SwitchableTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var isOffline = false
    private let inner = URLSessionTransport()

    var offline: Bool {
        get { lock.locked { isOffline } }
        set { lock.locked { isOffline = newValue } }
    }

    func post(_ url: URL, json: Data, bearer: String?) async throws -> HTTPReply {
        if offline { throw URLError(.notConnectedToInternet) }
        return try await inner.post(url, json: json, bearer: bearer)
    }
}
