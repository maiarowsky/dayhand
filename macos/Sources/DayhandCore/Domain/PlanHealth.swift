import Foundation

/**
 * The plan health report (`app:planHealth`, docs/agent-work.md#8-the-plan-health-report) as the card above Today
 * needs it: how many tasks each section counts (the server lists at most 20 per section; `count` counts them all).
 */
public struct PlanHealth: Hashable, Sendable {
    /// When the server made the report (Unix ms).
    public var at: Int64
    public var agentsPaused: Bool
    public var overdue: Int
    public var dueToday: Int
    public var inProgress: Int
    public var expiredClaims: Int
    public var blocked: Int
    public var pendingApprovals: Int
    public var proposals: Int
    public var completedToday: Int
    public var withoutProof: Int
    /// How old the oldest open task is, in whole days; nil when nothing is open.
    public var oldestOpenDays: Int?

    public init(
        at: Int64 = 0, agentsPaused: Bool = false, overdue: Int = 0, dueToday: Int = 0, inProgress: Int = 0,
        expiredClaims: Int = 0, blocked: Int = 0, pendingApprovals: Int = 0, proposals: Int = 0, completedToday: Int = 0,
        withoutProof: Int = 0, oldestOpenDays: Int? = nil
    ) {
        self.at = at
        self.agentsPaused = agentsPaused
        self.overdue = overdue
        self.dueToday = dueToday
        self.inProgress = inProgress
        self.expiredClaims = expiredClaims
        self.blocked = blocked
        self.pendingApprovals = pendingApprovals
        self.proposals = proposals
        self.completedToday = completedToday
        self.withoutProof = withoutProof
        self.oldestOpenDays = oldestOpenDays
    }

    /// A report as the server sends it (numbers as doubles); nil when it is not a report at all.
    public static func parse(_ value: JSONValue) -> PlanHealth? {
        guard value.object != nil, let at = value["at"]?.int64 else { return nil }
        func count(_ section: String) -> Int { value[section]?["count"]?.int ?? 0 }
        return PlanHealth(
            at: at,
            agentsPaused: value["agentsPaused"]?.bool ?? false,
            overdue: count("overdue"),
            dueToday: count("dueToday"),
            inProgress: count("inProgress"),
            expiredClaims: count("expiredClaims"),
            blocked: count("blocked"),
            pendingApprovals: value["awaitingApproval"]?["pendingApprovals"]?.int ?? 0,
            proposals: count("proposals"),
            completedToday: count("completedToday"),
            withoutProof: value["completedToday"]?["withoutProof"]?.int ?? 0,
            oldestOpenDays: value["oldestOpen"]?["ageDays"]?.int
        )
    }
}

/// One fact of the plan health card, by how much it asks for a look (the Android app's `HealthKind`).
public enum HealthKind: Hashable, Sendable, CaseIterable {
    case paused, overdue, expiredClaims, approvals, blocked, proposals, withoutProof, dueToday, inProgress, doneToday, oldestOpen
}

public struct HealthItem: Hashable, Sendable {
    public let kind: HealthKind
    public let count: Int

    public init(kind: HealthKind, count: Int) {
        self.kind = kind
        self.count = count
    }
}

/// Red, amber or calm.
public enum HealthTone: Hashable, Sendable {
    case calm, look, act
}

/// The report as the card above Today says it, as the Android app's `HealthSummary`: only what is there, the most
/// pressing first.
public enum HealthSummary {
    /// An open task this old is worth a word on the card.
    public static let oldDays = 14

    public static func items(_ health: PlanHealth) -> [HealthItem] {
        var items = [HealthItem(kind: .paused, count: health.agentsPaused ? 1 : 0)]
        items += [
            HealthItem(kind: .overdue, count: health.overdue),
            HealthItem(kind: .expiredClaims, count: health.expiredClaims),
            HealthItem(kind: .approvals, count: health.pendingApprovals),
            HealthItem(kind: .blocked, count: health.blocked),
            HealthItem(kind: .proposals, count: health.proposals),
            HealthItem(kind: .withoutProof, count: health.withoutProof),
            HealthItem(kind: .dueToday, count: health.dueToday),
            HealthItem(kind: .inProgress, count: health.inProgress),
            HealthItem(kind: .doneToday, count: health.completedToday),
        ]
        if let days = health.oldestOpenDays, days >= oldDays { items.append(HealthItem(kind: .oldestOpen, count: days)) }
        return items.filter { $0.count > 0 }
    }

    /// Red when agents are paused or something is late, amber when the owner is asked for something.
    public static func tone(_ items: [HealthItem]) -> HealthTone {
        let kinds = Set(items.map(\.kind))
        if !kinds.isDisjoint(with: [.paused, .overdue, .expiredClaims]) { return .act }
        if !kinds.isDisjoint(with: [.approvals, .blocked, .proposals, .withoutProof]) { return .look }
        return .calm
    }

    /// Whether the card offers Review, which lists the approval requests and proposals waiting for the owner.
    public static func needsOwner(_ items: [HealthItem]) -> Bool {
        items.contains { [.paused, .approvals, .proposals].contains($0.kind) }
    }
}
