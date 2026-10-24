import DayhandLocalization
import Foundation

/**
 * A note left just before Sparkle quits Dayhand to install an update, read once at the next start. Sparkle installs
 * after the app has quit, so the app learns how it went only from the build it wakes up as: the new build means the
 * update went in, an older one means it did not, and Settings says so.
 */
public struct InstallRecord: Codable, Equatable, Sendable {
    public let version: String
    public let build: String
    public let startedAt: Date

    public init(version: String, build: String, startedAt: Date) {
        self.version = version
        self.build = build
        self.startedAt = startedAt
    }

    public static let defaultsKey = "updateInstallRecord"

    public enum Outcome: Equatable, Sendable {
        case installed(version: String)
        case notInstalled(version: String)

        public var message: String {
            switch self {
            case .installed(let version):
                return tr("Dayhand was updated to \(version).")
            case .notInstalled(let version):
                return tr("The update to \(version) did not install, so this version is still running. Try updating again.")
            }
        }
    }

    /// How the update went, from the build now running; `compare` is Sparkle's version comparison.
    public func outcome(currentBuild: String, compare: (String, String) -> ComparisonResult) -> Outcome {
        compare(currentBuild, build) == .orderedAscending ? .notInstalled(version: version) : .installed(version: version)
    }

    public func save(to defaults: UserDefaults) {
        guard let data = try? JSONEncoder().encode(self) else { return }
        defaults.set(data, forKey: Self.defaultsKey)
    }

    /// The record left by the last run, removed as it is read so it is reported once.
    public static func take(from defaults: UserDefaults) -> InstallRecord? {
        guard let data = defaults.data(forKey: defaultsKey) else { return nil }
        defaults.removeObject(forKey: defaultsKey)
        return try? JSONDecoder().decode(InstallRecord.self, from: data)
    }
}
