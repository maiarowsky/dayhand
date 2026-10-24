import Foundation
import Testing
@testable import DayhandCore

/**
 * The sync loop's wait, many times over. A release build once aborted in `swift_task_dealloc` when the wait's timer
 * child task ended (macOS 0.2.1), so `swift test -c release --filter SignalTests` is the check that matters here.
 */
struct SignalTests {
    @Test func aWaitWithNobodyFiringEndsAtItsTimeout() async {
        let signal = Signal()
        for _ in 0..<300 {
            await signal.wait(timeout: .milliseconds(1))
        }
    }

    @Test func aFireBeforeTheWaitEndsItAtOnce() async {
        let signal = Signal()
        for _ in 0..<300 {
            signal.fire()
            await signal.wait(timeout: .seconds(60))
        }
    }

    @Test func aFireDuringTheWaitEndsIt() async {
        let signal = Signal()
        for _ in 0..<100 {
            let firing = Task.detached { signal.fire() }
            await signal.wait(timeout: .seconds(60))
            await firing.value
        }
    }

    @Test func aWaitInACancelledTaskStillReturns() async {
        let signal = Signal()
        let waiting = Task { await signal.wait(timeout: .seconds(60)) }
        waiting.cancel()
        signal.fire()
        await waiting.value
    }

    @Test func theNanosecondsOfATimeoutAreClampedNotTrapped() {
        #expect(Signal.nanoseconds(.milliseconds(15)) == 15_000_000)
        #expect(Signal.nanoseconds(.seconds(-1)) == 0)
        #expect(Signal.nanoseconds(.seconds(Int64.max)) == UInt64.max)
    }

    @Test func theLoopKeepsPollingAServerThatDoesNotAnswer() async throws {
        let server = FakeServer()
        server.offline = true
        let repo = TaskRepository(database: try AppDatabase.inMemory())
        let tokens = DeviceTokens(serverUrl: FakeServer.site, deviceToken: FakeServer.deviceToken, api: PairingAPI(transport: server), onRevoked: {})
        let remote = ConvexRemote(deploymentUrl: FakeServer.cloud, tokens: tokens, transport: server)
        let log = StatusLog()
        let engine = SyncEngine(repository: repo, sender: remote, source: remote, pollInterval: .milliseconds(2), onStatus: { log.append($0) })
        await engine.start()
        for _ in 0..<500 where log.count < 100 {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        await engine.stop()
        #expect(log.count >= 100)
        guard case .offline = log.last else { Issue.record("expected offline, got \(String(describing: log.last))"); return }
    }
}
