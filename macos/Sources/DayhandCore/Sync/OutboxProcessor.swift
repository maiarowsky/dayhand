import Foundation

/// Durable queue of local changes, as the processor needs it.
public protocol OutboxStore: Sendable {
    /// The oldest waiting change, or nil when everything was sent.
    func next() async throws -> OutboxOp?
    func serverIdOf(_ taskLocalId: String) async throws -> String?
    /// The server id of the project with [localId], or nil when it is not on this Mac.
    func projectRef(_ localId: String) async throws -> String?
    /// Whether the server has projects, as the last snapshot or project call said.
    func projectSupport() async throws -> ProjectSupport
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
 * The outbox holds task changes and settings only, and nothing in it waits for anything but the change before it.
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
            let args: JSONValue
            switch try await argsFor(op) {
            case .send(let ready): args = ready
            case .refuse(let reason):
                try await store.reject(op, reason: reason)
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

    /// The arguments as sent, or why the change cannot be sent at all.
    enum Prepared {
        case send(JSONValue)
        case refuse(String)
    }

    /// Stored arguments plus the task's server id, which a task created offline gets only after its `add`, and the
    /// server id of the task's project.
    private func argsFor(_ op: OutboxOp) async throws -> Prepared {
        guard case .object(var args) = JSONValue.decode(op.argsJson) else { return .refuse("unreadable change") }
        args.removeValue(forKey: Mutations.shownNext)
        if let reason = try await resolveProject(op, &args) { return .refuse(reason) }
        guard let localId = op.taskLocalId, op.mutation != Mutations.add else { return .send(.object(args)) }
        guard let serverId = try await store.serverIdOf(localId) else { return .refuse("task never reached the server") }
        args["taskId"] = .string(serverId)
        return .send(.object(args))
    }

    /**
     * Swaps the project's `localId` in `projectId` for its server id. A server without projects gets no `projectId`,
     * nor does a change sent again after the server refused its project. A project no longer on this Mac is refused
     * as the server words it, so the change goes again without it. Returns the reason for a refusal.
     */
    private func resolveProject(_ op: OutboxOp, _ args: inout [String: JSONValue]) async throws -> String? {
        guard let project = args["projectId"] else { return nil }
        let unsupported = try await store.projectSupport() == .unsupported
        if unsupported || op.lastError.map(RemoteJSON.refusesProject) == true {
            args.removeValue(forKey: "projectId")
            return nil
        }
        // null takes the task out of its project.
        guard let localId = project.string else { return nil }
        guard let serverId = try await store.projectRef(localId) else { return "Project \"\(localId)\" not found" }
        args["projectId"] = .string(serverId)
        return nil
    }
}
