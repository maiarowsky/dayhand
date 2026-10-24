import CryptoKit
import Foundation
@testable import DayhandUpdates

/**
 * A stand-in for Dayhand.app in a temporary folder: just `Contents/Info.plist` with a version, the feed and a
 * throwaway EdDSA public key made for this test (the private half signs the test archive and is never written down).
 * Sparkle keeps its settings for the stand-in under the stand-in's bundle id, one id for every test (they run one at a
 * time), cleared before and after each, so the preferences folder gets at most one file and only while tests run.
 */
struct TestApp {
    let bundle: Bundle
    let folder: URL
    let identifier: String
    let signingKey: Curve25519.Signing.PrivateKey

    init(build: String = "100", version: String = "0.1.0", feed: URL?, withKey: Bool = true) throws {
        identifier = Self.identifier
        Self.clearSettings()
        signingKey = Curve25519.Signing.PrivateKey()
        // A new folder each time: `Bundle` keeps the first bundle it opened at a path, Info.plist and all.
        folder = FileManager.default.temporaryDirectory.appendingPathComponent("Dayhand-\(UUID().uuidString).app", isDirectory: true)
        let contents = folder.appendingPathComponent("Contents", isDirectory: true)
        try FileManager.default.createDirectory(at: contents.appendingPathComponent("MacOS"), withIntermediateDirectories: true)
        var info: [String: Any] = [
            "CFBundleIdentifier": identifier,
            "CFBundleName": "Dayhand",
            "CFBundlePackageType": "APPL",
            "CFBundleShortVersionString": version,
            "CFBundleVersion": build,
            // Checks only when a test asks, never on a schedule.
            "SUEnableAutomaticChecks": false,
        ]
        if let feed { info["SUFeedURL"] = feed.absoluteString }
        if withKey { info["SUPublicEDKey"] = signingKey.publicKey.rawRepresentation.base64EncodedString() }
        let plist = try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
        try plist.write(to: contents.appendingPathComponent("Info.plist"))
        guard let bundle = Bundle(url: folder) else { throw CocoaError(.fileReadCorruptFile) }
        self.bundle = bundle
    }

    static let identifier = "io.github.maiarowsky.dayhand.updatetests"

    /// The updater's own settings (preview channel, install record), in the same domain as Sparkle's.
    var defaults: UserDefaults { UserDefaults(suiteName: identifier)! }

    func signature(_ data: Data) throws -> String {
        try signingKey.signature(for: data).base64EncodedString()
    }

    func remove() {
        try? FileManager.default.removeItem(at: folder)
        Self.clearSettings()
    }

    static func clearSettings() {
        UserDefaults.standard.removePersistentDomain(forName: identifier)
        CFPreferencesAppSynchronize(identifier as CFString)
        let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first
        if let library {
            try? FileManager.default.removeItem(at: library.appendingPathComponent("Preferences/\(identifier).plist"))
            try? FileManager.default.removeItem(at: library.appendingPathComponent("Caches/\(identifier)"))
        }
    }
}

/// One `<item>` of a test appcast.
struct AppcastItem {
    var build: String
    var version: String
    var notes: String? = nil
    var channel: String? = nil
    var minimumSystemVersion = "13.0"
    var archive: URL
    var length: Int
    var signature: String

    var xml: String {
        var lines = [
            "<item>",
            "<title>Dayhand \(version)</title>",
            "<pubDate>Sat, 24 Oct 2026 10:00:00 +0000</pubDate>",
            "<sparkle:version>\(build)</sparkle:version>",
            "<sparkle:shortVersionString>\(version)</sparkle:shortVersionString>",
            "<sparkle:minimumSystemVersion>\(minimumSystemVersion)</sparkle:minimumSystemVersion>",
        ]
        if let channel { lines.append("<sparkle:channel>\(channel)</sparkle:channel>") }
        if let notes { lines.append("<description><![CDATA[\(notes)]]></description>") }
        lines.append("<enclosure url=\"\(archive.absoluteString)\" length=\"\(length)\" type=\"application/octet-stream\" sparkle:edSignature=\"\(signature)\"/>")
        lines.append("</item>")
        return lines.joined(separator: "\n")
    }
}

func appcast(_ items: [AppcastItem]) -> Data {
    Data("""
    <?xml version="1.0" encoding="utf-8"?>
    <rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
    <channel>
    <title>Dayhand</title>
    \(items.map(\.xml).joined(separator: "\n"))
    </channel>
    </rss>
    """.utf8)
}

/// Waits, leaving the main thread free for Sparkle's callbacks, until `done` holds or the time is up.
@MainActor
func waitUntil(_ seconds: TimeInterval = 10, _ done: () -> Bool) async -> Bool {
    let end = Date().addingTimeInterval(seconds)
    while !done() && Date() < end {
        try? await Task.sleep(for: .milliseconds(50))
    }
    return done()
}
