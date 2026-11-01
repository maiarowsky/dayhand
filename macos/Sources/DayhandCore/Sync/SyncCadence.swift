import Foundation

/// Only successful, unchanged merges count as idle. Failures keep retrying at the base interval; a round that found
/// no network at all (the Mac just woke, Wi-Fi not back yet) is retried sooner a few times, as it reached no server.
struct SyncCadence: Sendable {
    static let baseInterval: Duration = .seconds(60)
    static let maximumInterval: Duration = .seconds(300)
    static let unchangedRoundsBeforeBackoff = 3
    static let noNetworkRetryInterval: Duration = .seconds(5)
    static let noNetworkRetries = 3

    let base: Duration
    private(set) var active = true
    private(set) var unchangedRounds = 0
    private var foregroundInterval: Duration
    private var roundsWithoutNetwork = 0

    init(base: Duration = Self.baseInterval) {
        self.base = base
        foregroundInterval = base
    }

    var interval: Duration {
        let usual = active ? foregroundInterval : max(base, Self.maximumInterval)
        guard (1...Self.noNetworkRetries).contains(roundsWithoutNetwork) else { return usual }
        return min(usual, Self.noNetworkRetryInterval)
    }

    /// A wake gets its own few quick retries while the network comes back.
    mutating func woke() {
        roundsWithoutNetwork = 0
    }

    mutating func roundEnded(withoutNetwork: Bool) {
        roundsWithoutNetwork = withoutNetwork ? roundsWithoutNetwork + 1 : 0
    }

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
