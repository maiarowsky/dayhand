import DayhandLocalization
import Foundation

/**
 * Whether this build of Dayhand can update itself, read from its `Info.plist`. Updates need two things written into
 * the bundle when it is built (scripts/build-app.sh): the appcast address (`SUFeedURL`) and the public half of the
 * maintainer's EdDSA key (`SUPublicEDKey`). Without either, the updater is never started, so nothing is ever fetched,
 * and Settings says why.
 */
public struct UpdateConfiguration: Equatable, Sendable {
    public let feedURL: URL
    public let publicKey: String
    /// `CFBundleShortVersionString`, what the user sees ("0.2.0").
    public let version: String
    /// `CFBundleVersion`, what Sparkle compares with `sparkle:version` in the appcast.
    public let build: String

    public enum Keys {
        public static let feedURL = "SUFeedURL"
        public static let publicKey = "SUPublicEDKey"
    }

    /// Why a build cannot update itself; `message` is for Settings and the update window.
    public enum Unavailable: Error, Equatable, Sendable {
        case noBundle
        case noKey
        case invalidKey
        case noFeed
        case insecureFeed
        case updaterFailed

        public var message: String {
            switch self {
            case .noBundle:
                return tr("Updates aren’t available in this build: it runs without an app bundle (swift run).")
            case .noKey, .invalidKey:
                return tr("Updates aren’t available in this build: it was built without the update signing key.")
            case .noFeed, .insecureFeed:
                return tr("Updates aren’t available in this build: it has no secure address to check for new versions.")
            case .updaterFailed:
                return tr("Updates aren’t available in this build: the updater could not start.")
            }
        }
    }

    /// The configuration in `info` (a bundle's `infoDictionary`), or why there is none.
    public static func read(_ info: [String: Any]?) -> Result<UpdateConfiguration, Unavailable> {
        guard let info, let build = info["CFBundleVersion"] as? String, !build.isEmpty else {
            return .failure(.noBundle)
        }
        let key = (info[Keys.publicKey] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !key.isEmpty else { return .failure(.noKey) }
        guard isEd25519PublicKey(key) else { return .failure(.invalidKey) }
        let address = (info[Keys.feedURL] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !address.isEmpty, let url = URL(string: address), url.host != nil else { return .failure(.noFeed) }
        guard isSecure(url) else { return .failure(.insecureFeed) }
        let version = info["CFBundleShortVersionString"] as? String ?? build
        return .success(UpdateConfiguration(feedURL: url, publicKey: key, version: version, build: build))
    }

    /// Sparkle's public key: 32 bytes of an Ed25519 key in base64, as `generate_keys` prints it.
    static func isEd25519PublicKey(_ text: String) -> Bool {
        Data(base64Encoded: text)?.count == 32
    }

    /// HTTPS, or HTTP to this Mac only (a local appcast for trying an update); never plain HTTP over the network.
    static func isSecure(_ url: URL) -> Bool {
        switch url.scheme?.lowercased() {
        case "https": return true
        case "http": return ["127.0.0.1", "localhost", "::1"].contains(url.host?.lowercased() ?? "")
        default: return false
        }
    }
}
