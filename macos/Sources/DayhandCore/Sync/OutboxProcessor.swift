import Foundation

/// Durable queue of local changes, as the processor needs it.
public protocol OutboxStore: Sendable {
    /// The oldest waiting change, or nil when everything was sent.
    func next() async throws -> OutboxOp?
    func serverIdOf(_ taskLocalId: String) async throws -> String?
    /**
     * How the server names project [localId]: its server id, or its name while it has none (its `addProject` was
     * refused because the server has a project of that name, which takes the name as well); nil when this Mac has no
     * such project.
     */
    func projectRef(_ localId: String) async throws -> String?
    /// Whether the server has projects, as the last snapshot said.
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
 * A server without projects gets neither project changes nor the `projectId` of task changes.
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
    /// server ids of the projects they name.
    private func argsFor(_ op: OutboxOp) async throws -> Prepared {
        guard case .object(var args) = JSONValue.decode(op.argsJson) else { return .refuse("unreadable change") }
        if let reason = try await resolveProjects(op, &args) { return .refuse(reason) }
        guard let localId = op.taskLocalId, op.mutation != Mutations.add else { return .send(.object(args)) }
        guard let serverId = try await store.serverIdOf(localId) else { return .refuse("task never reached the server") }
        args["taskId"] = .string(serverId)
        return .send(.object(args))
    }

    /**
     * Swaps the projects' `localId`s in `projectId` and `moveTasksTo` for what the server knows them by. A server
     * without projects gets no project change and no `projectId`; a project this Mac no longer has is left out of a
     * task change, and a change of the project itself is refused. Returns the reason for a refusal.
     */
    private func resolveProjects(_ op: OutboxOp, _ args: inout [String: JSONValue]) async throws -> String? {
        let ofProject = Mutations.projectChanges.contains(op.mutation)
        guard ofProject || args["projectId"] != nil else { return nil }
        if try await store.projectSupport() == .unsupported {
            if ofProject { return RemoteJSON.noProjectsReason }
            args.removeValue(forKey: "projectId")
            return nil
        }
        for key in ["projectId", "moveTasksTo"] {
            guard let localId = args[key]?.string, localId != ProjectRules.noProject else { continue }
            if let ref = try await store.projectRef(localId) {
                args[key] = .string(ref)
            } else if ofProject {
                return "project never reached the server"
            } else {
                args.removeValue(forKey: key)
            }
        }
        return nil
    }
}
