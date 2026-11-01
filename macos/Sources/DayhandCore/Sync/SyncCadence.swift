import Foundation

/// Only successful, unchanged merges count as idle. Failures keep retrying at the base interval.
struct SyncCadence: Sendable {
    static let baseInterval: Duration = .seconds(60)
    static let maximumInterval: Duration = .seconds(300)
    static let unchangedRoundsBeforeBackoff = 3

    let base: Duration
    private(set) var active = true
    private(set) var unchangedRounds = 0
    private var foregroundInterval: Duration

    init(base: Duration = Self.baseInterval) {
        self.base = base
        foregroundInterval = base
    }

    var interval: Duration { active ? foregroundInterval : max(base, Self.maximumInterval) }

    mutating func reset() {
        unchangedRounds = 0
        foregroundInterval = base
    }

    mutating func setActive(_ active: Bool) {
        self.active = active
        if active { reset() }
    }

    mutating func merged(changed: Bool) {
        guard !changed else { reset(); return }
        unchangedRounds += 1
        if unchangedRounds >= Self.unchangedRoundsBeforeBackoff {
            foregroundInterval = min(foregroundInterval * 2, max(base, Self.maximumInterval))
            unchangedRounds = 0
        }
    }
}
