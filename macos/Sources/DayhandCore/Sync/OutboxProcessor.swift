import Foundation

/// Durable queue of local changes, as the processor needs it.
public protocol OutboxStore: Sendable {
    /// The oldest waiting change, or nil when everything was sent.
    func next() async throws -> OutboxOp?
    func serverIdOf(_ taskLocalId: String) async throws -> String?
    /// The server applied [op]: forget it (and remember the server id of a new task).
    func acknowledge(_ op: OutboxOp, value: JSONValue) async throws
    /// The server refused [op] for good: forget it and let the next snapshot repair the row.
    func reject(_ op: OutboxOp, reason: String) async throws
    func recordFailure(_ op: OutboxOp, reason: String) async throws
}

public enum DrainResult: Hashable, Sendable {
    case done, moreLeft, retryLater, unauthorized
}

/**
 * Sends the outbox strictly in order, one change at a time, as the Android app's `OutboxProcessor`. A change leaves
 * the queue only when the server answered; on any doubt the processor stops, so nothing behind it can overtake it.
 * Resending after a lost answer is safe because every change carries the `clientId` the backend deduplicates on.
 */
public struct OutboxProcessor: Sendable {
    public static let maxOpsPerRun = 200

    let store: OutboxStore
    let sender: MutationSender
    let maxOps: Int

    public init(store: OutboxStore, sender: MutationSender, maxOps: Int = OutboxProcessor.maxOpsPerRun) {
        self.store = store
        self.sender = sender
        self.maxOps = maxOps
    }

    public func drain() async throws -> DrainResult {
        for _ in 0..<maxOps {
            guard let op = try await store.next() else { return .done }
            guard let args = try await argsFor(op) else {
                try await store.reject(op, reason: "task never reached the server")
                continue
            }
            switch await sender.send(mutation: op.mutation, args: args) {
            case .applied(let value):
                try await store.acknowledge(op, value: value)
            case .rejected(let message):
                try await store.reject(op, reason: message)
            case .unauthorized:
                try await store.recordFailure(op, reason: "unauthorized")
                return .unauthorized
            case .failed(let message):
                try await store.recordFailure(op, reason: message)
                return .retryLater
            }
        }
        return try await store.next() == nil ? .done : .moreLeft
    }

    /// Stored arguments plus the task's server id, which a task created offline gets only after its `add`.
    private func argsFor(_ op: OutboxOp) async throws -> JSONValue? {
        guard case .object(var args) = JSONValue.decode(op.argsJson) else { return nil }
        guard let localId = op.taskLocalId, op.mutation != Mutations.add else { return .object(args) }
        guard let serverId = try await store.serverIdOf(localId) else { return nil }
        args["taskId"] = .string(serverId)
        return .object(args)
    }
}
