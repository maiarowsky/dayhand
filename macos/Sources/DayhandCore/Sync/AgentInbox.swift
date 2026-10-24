import Foundation

/// An approval request waiting for the owner (`app:listApprovals`), as the Mac lists it read-only.
public struct ApprovalRequest: Hashable, Sendable, Identifiable {
    public var id: String
    /// What the agent wants to do.
    public var action: String
    public var detail: String?
    public var taskRef: Int?
    public var taskTitle: String?
    /// The name of the agent or integration that asks.
    public var requestedBy: String
    /// The labels of the options the owner can pick.
    public var options: [String]
    public var expiresAt: Int64?

    public init(
        id: String, action: String, detail: String? = nil, taskRef: Int? = nil, taskTitle: String? = nil,
        requestedBy: String, options: [String] = [], expiresAt: Int64? = nil
    ) {
        self.id = id
        self.action = action
        self.detail = detail
        self.taskRef = taskRef
        self.taskTitle = taskTitle
        self.requestedBy = requestedBy
        self.options = options
        self.expiresAt = expiresAt
    }

    public static func parse(_ value: JSONValue) -> ApprovalRequest? {
        guard let id = value["id"]?.string, let action = value["action"]?.string else { return nil }
        return ApprovalRequest(
            id: id,
            action: action,
            detail: value["detail"]?.string,
            taskRef: value["ref"]?.int,
            taskTitle: value["taskTitle"]?.string,
            requestedBy: value["requestedBy"]?["name"]?.string ?? value["requestedBy"]?["type"]?.string ?? "agent",
            options: value["options"]?.array?.compactMap { $0["label"]?.string } ?? [],
            expiresAt: value["expiresAt"]?.int64
        )
    }
}

/// A task an agent or integration proposed (`app:listProposals`); it stays out of Today until the owner accepts it.
public struct Proposal: Hashable, Sendable, Identifiable {
    public var id: String
    public var ref: Int?
    public var title: String
    public var dueDate: String?
    public var dueTime: String?
    /// Who asked for the task, when the proposal says.
    public var requestedBy: String?

    public init(id: String, ref: Int? = nil, title: String, dueDate: String? = nil, dueTime: String? = nil, requestedBy: String? = nil) {
        self.id = id
        self.ref = ref
        self.title = title
        self.dueDate = dueDate
        self.dueTime = dueTime
        self.requestedBy = requestedBy
    }

    public static func parse(_ value: JSONValue) -> Proposal? {
        guard let task = RemoteJSON.task(value) else { return nil }
        return Proposal(
            id: task.id, ref: task.ref, title: task.title, dueDate: task.dueDate, dueTime: task.dueTime,
            requestedBy: value["requestedBy"]?.string
        )
    }
}

/// The approval requests and proposals waiting for the owner, read when Review opens; the Mac does not decide them
/// (the phone and `dayhand` do) and does not keep them.
public struct AgentInbox: Hashable, Sendable {
    public var approvals: [ApprovalRequest]
    public var proposals: [Proposal]

    public init(approvals: [ApprovalRequest] = [], proposals: [Proposal] = []) {
        self.approvals = approvals
        self.proposals = proposals
    }

    public enum LoadError: Error, Hashable, Sendable {
        case noServer
        case unauthorized
        case failed(String)
    }

    /// Both lists from the server, or why they could not be read.
    public static func load(_ queries: QueryRunner?) async -> Result<AgentInbox, LoadError> {
        guard let queries else { return .failure(.noServer) }
        let approvals = await queries.query(RemoteJSON.queryApprovals, args: ["status": "pending"])
        guard case .applied(let approvalList) = approvals else { return .failure(error(approvals)) }
        let proposals = await queries.query(RemoteJSON.queryProposals, args: [:])
        guard case .applied(let proposalList) = proposals else { return .failure(error(proposals)) }
        return .success(AgentInbox(
            approvals: approvalList["approvals"]?.array?.compactMap(ApprovalRequest.parse) ?? [],
            proposals: proposalList.array?.compactMap(Proposal.parse) ?? []
        ))
    }

    private static func error(_ result: SendResult) -> LoadError {
        switch result {
        case .unauthorized: return .unauthorized
        case .rejected(let message), .failed(let message): return .failed(message)
        case .applied: return .failed("unexpected")
        }
    }
}
