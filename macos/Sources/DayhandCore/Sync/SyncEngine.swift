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
 * (`OutboxProcessor`), then read the whole plan and merge it (`SnapshotMerger`). Rounds run every [pollInterval]
 * (the "live" view of changes made elsewhere) and at once after every local change ([poke]). Sending and reading
 * never overlap, so a snapshot is always taken after the changes before it were sent.
 */
public actor SyncEngine {
    /// Polling every 15 seconds stays far under the server's limits (docs/architecture.md) and feels live enough.
    public static let defaultPollInterval: Duration = .seconds(15)

    private let repository: TaskRepository
    private let sender: MutationSender
    private let source: SnapshotSource
    private let pollInterval: Duration
    private let onStatus: @Sendable (SyncStatus) -> Void
    private let signal = Signal()
    private var loop: Task<Void, Never>?
    private var roundInProgress = false
    private var roundWaiters: [CheckedContinuation<Void, Never>] = []

    public init(
        repository: TaskRepository, sender: MutationSender, source: SnapshotSource,
        pollInterval: Duration = SyncEngine.defaultPollInterval, onStatus: @escaping @Sendable (SyncStatus) -> Void
    ) {
        self.repository = repository
        self.sender = sender
        self.source = source
        self.pollInterval = pollInterval
        self.onStatus = onStatus
    }

    public func start() {
        guard loop == nil else { return }
        onStatus(.connecting)
        loop = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let status = await self.round()
                if status == .signedOut { return }
                await self.signal.wait(timeout: self.pollInterval)
            }
        }
    }

    public func stop() {
        loop?.cancel()
        loop = nil
        signal.fire()
    }

    /// A local change is waiting: run a round now instead of at the next poll.
    public nonisolated func poke() { signal.fire() }

    /// One round: the outbox, then a snapshot. Also callable directly (tests, "Sync now").
    @discardableResult
    public func round() async -> SyncStatus {
        if roundInProgress {
            await withCheckedContinuation { roundWaiters.append($0) }
        }
        roundInProgress = true
        defer {
            if roundWaiters.isEmpty {
                roundInProgress = false
            } else {
                roundWaiters.removeFirst().resume()
            }
        }
        let status = await sendAndRead()
        onStatus(status)
        return status
    }

    private func sendAndRead() async -> SyncStatus {
        do {
            let processor = OutboxProcessor(store: repository, sender: sender)
            var drained = try await processor.drain()
            while drained == .moreLeft { drained = try await processor.drain() }
            switch drained {
            case .unauthorized: return .signedOut
            case .retryLater:
                // Read anyway: changes made elsewhere still show, and the waiting ones keep their fields.
                break
            case .done, .moreLeft: break
            }
            let knownTaskIds = try await repository.allTasks().compactMap(\.serverId)
            switch await source.snapshot(knownTaskIds: knownTaskIds) {
            case .success(let snapshot):
                try await repository.apply(snapshot)
                if drained == .retryLater {
                    let waiting = try await repository.next()
                    return .offline(waiting?.lastError ?? "a change could not be sent")
                }
                return .synced(at: Clock.nowMs())
            case .failure(.unauthorized):
                return .signedOut
            case .failure(.failed(let reason)):
                return .offline(reason)
            }
        } catch {
            return .offline(String(describing: type(of: error)))
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
