import Foundation

/// What a plan health read came to.
public enum HealthRefresh: Hashable, Sendable {
    /// The server sent a report and it is kept.
    case fresh
    /// The server did not answer (or sent no report): the last report stays.
    case kept
    /// No server connected.
    case noServer
}

/**
 * Reads the plan health report (`app:planHealth`) and keeps the last one in the database, so the card above Today
 * shows it also offline, as the Android app's `HealthCardViewModel` (which keeps it only while the app runs).
 */
public struct PlanHealthSync: Sendable {
    let runner: @Sendable () async -> QueryRunner?
    let repository: TaskRepository

    public init(repository: TaskRepository, runner: @escaping @Sendable () async -> QueryRunner?) {
        self.repository = repository
        self.runner = runner
    }

    public func refresh() async -> HealthRefresh {
        guard let queries = await runner() else { return .noServer }
        guard case .applied(let value) = await queries.query(RemoteJSON.queryPlanHealth, args: [:]),
              PlanHealth.parse(value) != nil else { return .kept }
        do {
            try await repository.savePlanHealth(value)
            return .fresh
        } catch {
            return .kept
        }
    }
}
