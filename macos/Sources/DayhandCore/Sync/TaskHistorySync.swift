import Foundation

/**
 * Fetches a task's change history (`app:getTask`) and caches it in the database, so the details show who changed
 * what (the app, `dayhand` or an agent) also offline, as the Android app's `TaskHistorySync`. History lives only on
 * the server: a change still in the outbox appears in it once it was sent.
 */
public struct TaskHistorySync: Sendable {
    /// The query runner for the connected server, or nil when no server is connected.
    let runner: @Sendable () async -> QueryRunner?
    let repository: TaskRepository

    public init(repository: TaskRepository, runner: @escaping @Sendable () async -> QueryRunner?) {
        self.repository = repository
        self.runner = runner
    }

    public func refresh(serverId: String?) async -> HistoryState {
        guard let serverId else { return .notOnServerYet }
        guard let queries = await runner() else { return .cached }
        guard case .applied(let value) = await queries.query(RemoteJSON.queryTask, args: ["taskId": .string(serverId)]) else {
            return .cached
        }
        do {
            try await repository.saveHistory(serverId, RemoteJSON.history(value, serverId: serverId))
            return .fresh
        } catch {
            return .cached
        }
    }
}
