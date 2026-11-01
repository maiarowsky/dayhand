import Foundation

/// What the server connection is doing, for the status line on Today and in the menu bar.
public enum SyncStatus: Hashable, Sendable {
    case notConnected
    case connecting
    case synced(at: Int64)
    /// The server answered no (revoked device); the user has to pair again.
    case signedOut
    /// No answer or a server problem; changes wait in the outbox and the next round tries again.
    case offline(String)
}

/**
 * Keeps the local database and the server in step while the app runs, one round at a time: send the outbox in order
 * (`OutboxProcessor`), then read the whole plan and merge it (`SnapshotMerger`). Automatic rounds back off from
 * 60 to 300 seconds while unchanged (300 in the background); every local change ([poke]) runs at once. Sending and reading
 * never overlap, so a snapshot is always taken after the changes before it were sent. The project calls
 * (`ProjectCalls.swift`) take turns with the rounds the same way, so no snapshot straddles a project change.
 */
public actor SyncEngine {
    public static let defaultPollInterval: Duration = SyncCadence.baseInterval

    let repository: TaskRepository
    let sender: MutationSender
    private let source: SnapshotSource
    private var cadence: SyncCadence
    private let now: @Sendable () -> Duration
    private var lastRoundAt: Duration?
    private var immediate = true
    private var activityRevision: UInt64 = 0
    private let onStatus: @Sendable (SyncStatus) -> Void
    private let signal = Signal()
    private var loop: Task<Void, Never>?
    /// A round or a project call is running.
    private var busy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    public init(
        repository: TaskRepository, sender: MutationSender, source: SnapshotSource,
        pollInterval: Duration = SyncEngine.defaultPollInterval,
        now: @escaping @Sendable () -> Duration = { .seconds(ProcessInfo.processInfo.systemUptime) },
        onStatus: @escaping @Sendable (SyncStatus) -> Void
    ) {
        self.repository = repository
        self.sender = sender
        self.source = source
        self.cadence = SyncCadence(base: pollInterval)
        self.now = now
        self.onStatus = onStatus
    }

    public func start() {
        guard loop == nil else { return }
        requestSync()
        onStatus(.connecting)
        loop = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let status = await self.pollIfDue()
                if status == .signedOut { return }
                await self.signal.wait(timeout: self.nextPollDelay)
            }
        }
    }

    public func stop() {
        loop?.cancel()
        loop = nil
        signal.fire()
    }

    /// A local change is waiting: run a round now instead of at the next poll.
    public nonisolated func poke() { Task { await requestSync() } }

    func requestSync() {
        userActivity()
        immediate = true
        signal.fire()
    }

    /// Interaction shortens an idle wait to the base, but does not fetch once per keystroke.
    public func userActivity() {
        cadence.reset()
        activityRevision &+= 1
        signal.fire()
    }

    /// Entering the foreground refreshes immediately; leaving it only reschedules the next automatic read.
    public func setActive(_ active: Bool) {
        guard active != cadence.active else { return }
        cadence.setActive(active)
        if active { requestSync() } else { signal.fire() }
    }

    var nextPollDelay: Duration {
        guard !immediate, let lastRoundAt else { return .zero }
        return max(.zero, lastRoundAt + cadence.interval - now())
    }

    /// The timer and the virtual-clock tests take the same path, rechecking after waiting for a project/manual call.
    @discardableResult
    func pollIfDue() async -> SyncStatus? {
        await takeTurn()
        defer { passTurn() }
        guard nextPollDelay == .zero else { return nil }
        return await runRound()
    }

    /// One explicit round: the outbox, then a snapshot. Also callable directly (tests, "Sync now").
    @discardableResult
    public func round() async -> SyncStatus {
        await takeTurn()
        defer { passTurn() }
        userActivity()
        return await runRound()
    }

    private func runRound() async -> SyncStatus {
        immediate = false
        let revision = activityRevision
        let (status, changed) = await sendAndRead()
        if case .synced = status, revision == activityRevision {
            cadence.merged(changed: changed)
        } else {
            cadence.reset()
        }
        lastRoundAt = now()
        onStatus(status)
        // A manual round may have replaced a timer's deadline. A poke during I/O remains immediate.
        signal.fire()
        return status
    }

    /// Waits until no round or project call runs, then runs alone until [passTurn]; the waiting ones go in order.
    func takeTurn() async {
        if busy {
            await withCheckedContinuation { waiters.append($0) }
        }
        busy = true
    }

    func passTurn() {
        if waiters.isEmpty {
            busy = false
        } else {
            waiters.removeFirst().resume()
        }
    }

    private func sendAndRead() async -> (SyncStatus, Bool) {
        do {
            let processor = OutboxProcessor(store: repository, sender: sender)
            var drained = try await processor.drain()
            while drained == .moreLeft { drained = try await processor.drain() }
            switch drained {
            case .unauthorized: return (.signedOut, false)
            case .retryLater:
                // Read anyway: changes made elsewhere still show, and the waiting ones keep their fields.
                break
            case .done, .moreLeft: break
            }
            let knownTaskIds = try await repository.allTasks().compactMap(\.serverId)
            switch await source.snapshot(knownTaskIds: knownTaskIds) {
            case .success(let snapshot):
                let changed = try await repository.apply(snapshot)
                if drained == .retryLater {
                    let waiting = try await repository.next()
                    return (.offline(waiting?.lastError ?? "a change could not be sent"), changed)
                }
                return (.synced(at: Clock.nowMs()), changed)
            case .failure(.unauthorized):
                return (.signedOut, false)
            case .failure(.failed(let reason)):
                return (.offline(reason), false)
            }
        } catch {
            return (.offline(String(describing: type(of: error))), false)
        }
    }
}

/// A wake-up call that is not lost when nobody is waiting yet: the next wait returns at once.
final class Signal: @unchecked Sendable {
    private let lock = NSLock()
    private var pending = false
    private var continuation: CheckedContinuation<Void, Never>?

    func fire() {
        lock.lock()
        if let waiting = continuation {
            continuation = nil
            lock.unlock()
            waiting.resume()
        } else {
            pending = true
            lock.unlock()
        }
    }

    /// Returns after [fire] or after [timeout], whichever comes first.
    func wait(timeout: Duration) async {
        let nanoseconds = Self.nanoseconds(timeout)
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.waitForFire() }
            group.addTask {
                do {
                    // Not `Task.sleep(for:)`: in a release build (Swift 6.3) its specialized copy aborted in
                    // `swift_task_dealloc` ("freed pointer was not the last allocation") when the sleep ended.
                    try await Task.sleep(nanoseconds: nanoseconds)
                    self.fire()
                } catch {
                    // Cancelled because a fire came first.
                }
            }
            await group.next()
            group.cancelAll()
        }
    }

    /// [duration] in whole nanoseconds for `Task.sleep(nanoseconds:)`: none when it is not positive, the most there is
    /// when it does not fit.
    static func nanoseconds(_ duration: Duration) -> UInt64 {
        guard duration > .zero else { return 0 }
        let (seconds, attoseconds) = duration.components
        let (whole, overflow) = UInt64(seconds).multipliedReportingOverflow(by: 1_000_000_000)
        let (total, overflowAgain) = whole.addingReportingOverflow(UInt64(attoseconds / 1_000_000_000))
        return overflow || overflowAgain ? .max : total
    }

    private func waitForFire() async {
        await withCheckedContinuation { (waiting: CheckedContinuation<Void, Never>) in
            lock.lock()
            if pending {
                pending = false
                lock.unlock()
                waiting.resume()
            } else {
                continuation = waiting
                lock.unlock()
            }
        }
    }
}

extension NSLock {
    /// `withLock` for macOS 13, where Foundation's own is not available yet.
    func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try body()
    }
}
