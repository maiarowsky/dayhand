import Foundation
import Sparkle
import Testing
@testable import DayhandUpdates

struct UpdateStateTests {
    let offer = UpdateOffer(version: "0.2.0", build: "120", notes: "Faster sync")

    private func run(_ events: [UpdateEvent], from start: UpdateState = UpdateState()) -> UpdateState {
        var state = start
        for event in events { state.apply(event) }
        return state
    }

    @Test func aBackgroundCheckThatFindsAnUpdateShowsTheButtonOnly() {
        let state = run([.found(offer)])
        #expect(state.activity == .available)
        #expect(state.hasUpdate)
        #expect(!state.isWorking)
    }

    @Test func aCheckTheUserAskedForEndsUpToDateUntilTheWindowCloses() {
        var state = run([.checkStarted])
        #expect(state.activity == .checking)
        #expect(state.isWorking)
        #expect(!state.hasUpdate)
        state = run([.notFound(userInitiated: true), .sessionEnded], from: state)
        #expect(state.activity == .upToDate)
        state.apply(.acknowledged)
        #expect(state.activity == .idle)
    }

    @Test func theDownloadReportsItsProgress() {
        var state = run([.found(offer), .downloadStarted])
        #expect(state.activity == .downloading(received: 0, expected: nil))
        #expect(state.downloadProgress == nil)
        state = run([.expectedLength(1000), .received(250), .received(250)], from: state)
        #expect(state.activity == .downloading(received: 500, expected: 1000))
        #expect(state.downloadProgress == 0.5)
        state = run([.received(900)], from: state)
        #expect(state.downloadProgress == 1)
        state = run([.extracting(nil), .extracting(0.5), .readyToInstall, .installing], from: state)
        #expect(state.activity == .installing)
        #expect(state.offer == offer)
    }

    @Test func anUnknownSizeKeepsTheProgressOpenEnded() {
        let state = run([.found(offer), .downloadStarted, .expectedLength(0), .received(10)])
        #expect(state.activity == .downloading(received: 10, expected: nil))
        #expect(state.downloadProgress == nil)
    }

    @Test func bytesOutsideADownloadAreIgnored() {
        let state = run([.found(offer), .received(10), .expectedLength(100)])
        #expect(state.activity == .available)
    }

    @Test func aFailedDownloadKeepsTheOfferForTryAgain() {
        var state = run([.found(offer), .downloadStarted, .received(10), .failed(.download), .sessionEnded])
        #expect(state.activity == .failed(.download))
        #expect(state.hasUpdate)
        state.apply(.acknowledged)
        #expect(state.activity == .available)
    }

    @Test func aCancelledDownloadGoesBackToTheOffer() {
        let state = run([.found(offer), .downloadStarted, .received(10), .sessionEnded])
        #expect(state.activity == .available)
        #expect(state.offer == offer)
    }

    @Test func laterKeepsTheOffer() {
        let state = run([.found(offer), .sessionEnded, .acknowledged])
        #expect(state.activity == .available)
        #expect(state.hasUpdate)
    }

    @Test func aLaterCheckWithoutTheUpdateRemovesTheButton() {
        let state = run([.found(offer), .sessionEnded, .notFound(userInitiated: false)])
        #expect(state.activity == .idle)
        #expect(!state.hasUpdate)
    }

    @Test func notesFetchedLaterJoinTheOffer() {
        let state = run([.found(UpdateOffer(version: "0.2.0", build: "120")), .notesLoaded("From the link")])
        #expect(state.offer?.notes == "From the link")
        #expect(run([.notesLoaded("No offer")]).offer == nil)
    }

    @Test func anUnavailableUpdaterIgnoresEverything() {
        let start = UpdateState(activity: .unavailable(.noKey))
        let state = run([.checkStarted, .found(offer), .failed(.other), .sessionEnded, .acknowledged], from: start)
        #expect(state == start)
    }
}

struct UpdateConfigurationTests {
    let key = Data(repeating: 1, count: 32).base64EncodedString()

    private func info(_ change: (inout [String: Any]) -> Void = { _ in }) -> [String: Any] {
        var info: [String: Any] = [
            "CFBundleVersion": "412", "CFBundleShortVersionString": "0.2.0",
            "SUFeedURL": "https://github.com/maiarowsky/helm/releases/download/dayhand-macos-appcast/appcast.xml",
            "SUPublicEDKey": key,
        ]
        change(&info)
        return info
    }

    @Test func aBuildWithTheKeyAndASecureFeedCanUpdate() throws {
        let configuration = try UpdateConfiguration.read(info()).get()
        #expect(configuration.feedURL.host == "github.com")
        #expect(configuration.version == "0.2.0")
        #expect(configuration.build == "412")
    }

    @Test func withoutTheKeyUpdatesAreUnavailable() {
        #expect(UpdateConfiguration.read(info { $0["SUPublicEDKey"] = nil }) == .failure(.noKey))
        #expect(UpdateConfiguration.read(info { $0["SUPublicEDKey"] = "  " }) == .failure(.noKey))
        // The template's placeholder, or a key that is not 32 bytes of Ed25519.
        #expect(UpdateConfiguration.read(info { $0["SUPublicEDKey"] = "__SPARKLE_PUBLIC_KEY__" }) == .failure(.invalidKey))
        #expect(UpdateConfiguration.read(info { $0["SUPublicEDKey"] = Data(repeating: 1, count: 16).base64EncodedString() }) == .failure(.invalidKey))
    }

    @Test func theFeedMustBeSecure() {
        #expect(UpdateConfiguration.read(info { $0["SUFeedURL"] = nil }) == .failure(.noFeed))
        #expect(UpdateConfiguration.read(info { $0["SUFeedURL"] = "not a url" }) == .failure(.noFeed))
        #expect(UpdateConfiguration.read(info { $0["SUFeedURL"] = "http://example.com/appcast.xml" }) == .failure(.insecureFeed))
        #expect(UpdateConfiguration.read(info { $0["SUFeedURL"] = "ftp://example.com/appcast.xml" }) == .failure(.insecureFeed))
        // Plain HTTP only to this Mac, for trying an update from a local appcast.
        #expect((try? UpdateConfiguration.read(info { $0["SUFeedURL"] = "http://127.0.0.1:8000/appcast.xml" }).get()) != nil)
        #expect((try? UpdateConfiguration.read(info { $0["SUFeedURL"] = "http://localhost/appcast.xml" }).get()) != nil)
    }

    @Test func withoutABundleThereIsNothingToUpdate() {
        #expect(UpdateConfiguration.read(nil) == .failure(.noBundle))
        #expect(UpdateConfiguration.read(info { $0["CFBundleVersion"] = nil }) == .failure(.noBundle))
    }

    @Test func everyReasonHasItsOwnWords() {
        let reasons: [UpdateConfiguration.Unavailable] = [.noBundle, .noKey, .invalidKey, .noFeed, .insecureFeed, .updaterFailed]
        for reason in reasons {
            #expect(reason.message.hasPrefix("Updates aren’t available in this build"))
        }
        #expect(UpdateConfiguration.Unavailable.noKey.message.contains("signing key"))
    }
}

struct ReleaseNotesTests {
    @Test func htmlBecomesShortLines() {
        let html = "<h2>Dayhand 0.2.0</h2>\n<p>Sync is <b>faster</b>.</p><ul><li>Fix: reminders&nbsp;after sleep</li><li>Quotes &quot;work&quot; &amp; &#8220;more&#x201D;</li></ul><script>alert(1)</script>"
        #expect(ReleaseNotes.plainText(html) == "Dayhand 0.2.0\nSync is faster.\n• Fix: reminders after sleep\n• Quotes \"work\" & “more”")
    }

    @Test func markdownAndPlainText() {
        #expect(ReleaseNotes.plainText("## New\n- **Faster** sync\n- See [the notes](https://example.com)", format: "markdown") == "New\n• Faster sync\n• See the notes")
        #expect(ReleaseNotes.plainText("  Just text <b>kept</b>  ", format: "plain-text") == "Just text <b>kept</b>")
    }

    @Test func emptyNotesAreNone() {
        #expect(ReleaseNotes.plainText(nil) == nil)
        #expect(ReleaseNotes.plainText("<p> </p>") == nil)
    }

    @Test func longNotesAreCutAtALine() throws {
        let lines = (1...100).map { "<li>Change number \($0)</li>" }.joined()
        let notes = try #require(ReleaseNotes.plainText("<ul>\(lines)</ul>"))
        #expect(notes.count <= ReleaseNotes.maxLength + 2)
        #expect(notes.hasSuffix("\n…"))
        #expect(notes.hasPrefix("• Change number 1\n"))
    }
}

struct UpdateFailureTests {
    private func sparkle(_ code: Int, underlying: NSError? = nil) -> NSError {
        NSError(domain: SUSparkleErrorDomain, code: code, userInfo: underlying.map { [NSUnderlyingErrorKey: $0] } ?? [:])
    }

    @Test func networkTroubleSaysSoHoweverDeepSparkleWrapsIt() {
        let offline = NSError(domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet)
        #expect(UpdateFailure.from(offline) == .offline)
        #expect(UpdateFailure.from(sparkle(Int(SUError.downloadError.rawValue), underlying: sparkle(Int(SUError.downloadError.rawValue), underlying: offline))) == .offline)
    }

    @Test func eachSparkleErrorHasPlainWords() {
        #expect(UpdateFailure.sparkleDomain == SUSparkleErrorDomain)
        #expect(UpdateFailure.from(sparkle(Int(SUError.appcastParseError.rawValue))) == .unreadable)
        #expect(UpdateFailure.from(sparkle(Int(SUError.appcastError.rawValue))) == .unreadable)
        #expect(UpdateFailure.from(sparkle(Int(SUError.downloadError.rawValue))) == .unreadable)
        #expect(UpdateFailure.from(sparkle(Int(SUError.downloadError.rawValue)), downloading: true) == .download)
        #expect(UpdateFailure.from(sparkle(Int(SUError.signatureError.rawValue))) == .untrusted)
        #expect(UpdateFailure.from(sparkle(Int(SUError.validationError.rawValue))) == .untrusted)
        #expect(UpdateFailure.from(sparkle(Int(SUError.unarchivingError.rawValue))) == .untrusted)
        #expect(UpdateFailure.from(sparkle(Int(SUError.installationError.rawValue))) == .install)
        #expect(UpdateFailure.from(sparkle(Int(SUError.runningFromDiskImageError.rawValue))).message.contains("Applications"))
        #expect(UpdateFailure.from(sparkle(Int(SUError.installationWriteNoPermissionError.rawValue))).message.contains("Applications"))
        #expect(UpdateFailure.from(sparkle(Int(SUError.downgradeError.rawValue))).message.contains("older"))
        #expect(UpdateFailure.from(sparkle(Int(SUError.installationCanceledError.rawValue))).message.contains("canceled"))
        #expect(UpdateFailure.from(sparkle(9999)) == .other)
        #expect(UpdateFailure.from(NSError(domain: "Other", code: 1)) == .other)
    }

    @Test func noMessageShowsInternals() {
        for failure in [UpdateFailure.offline, .unreadable, .download, .untrusted, .install, .other] {
            #expect(!failure.message.contains("SU"))
            #expect(!failure.message.contains("Error"))
        }
    }
}

struct VersionTests {
    private func compare(_ a: String, _ b: String) -> ComparisonResult {
        SUStandardVersionComparator.default.compareVersion(a, toVersion: b)
    }

    /// The comparison Sparkle applies to `sparkle:version` (the build number) and the install record.
    @Test func buildsAndVersionsCompareByTheirNumbers() {
        #expect(compare("98", "120") == .orderedAscending)
        #expect(compare("412", "412") == .orderedSame)
        #expect(compare("0.9.0", "0.10.0") == .orderedAscending)
        #expect(compare("0.2.0", "0.2.1") == .orderedAscending)
        #expect(compare("1.0b1", "1.0") == .orderedAscending)
        // A suffix after a dash does not count, so a preview needs a build number of its own (docs/macos.md).
        #expect(compare("1.0.0-preview.1", "1.0.0") == .orderedSame)
    }

    @Test func theInstallRecordTellsHowTheUpdateWent() {
        let record = InstallRecord(version: "0.2.0", build: "120", startedAt: Date(timeIntervalSince1970: 0))
        #expect(record.outcome(currentBuild: "120", compare: compare) == .installed(version: "0.2.0"))
        #expect(record.outcome(currentBuild: "121", compare: compare) == .installed(version: "0.2.0"))
        #expect(record.outcome(currentBuild: "100", compare: compare) == .notInstalled(version: "0.2.0"))
        #expect(InstallRecord.Outcome.notInstalled(version: "0.2.0").message.contains("did not install"))
    }
}
