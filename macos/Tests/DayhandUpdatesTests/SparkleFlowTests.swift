import Combine
import Foundation
import Sparkle
import Testing
@testable import DayhandUpdates

/**
 * The real Sparkle against an appcast on this Mac: a stand-in app (`TestApp`) at build 100 asks a `LocalServer` for
 * its appcast, and the tests check what the update window would show. Sparkle compares the builds, reads the items,
 * picks the channel and downloads; `Updater` turns that into the state. One at a time, on the main thread.
 */
@MainActor
@Suite(.serialized)
struct SparkleFlowTests {
    let server: LocalServer
    let archive = Data(repeating: 7, count: 200_000)

    init() throws {
        server = try LocalServer()
    }

    private func item(_ build: String, _ version: String, _ app: TestApp, change: (inout AppcastItem) -> Void = { _ in }) throws -> AppcastItem {
        let path = "/Dayhand-\(version).zip"
        server.set(path, .init(body: archive))
        var item = AppcastItem(build: build, version: version, archive: server.url(path), length: archive.count, signature: try app.signature(archive))
        change(&item)
        return item
    }

    private func check(_ updater: Updater) async -> Bool {
        updater.checkForUpdates()
        return await waitUntil {
            switch updater.state.activity {
            case .available, .upToDate, .failed: return true
            default: return false
            }
        }
    }

    @Test func theNewestNewerBuildIsOfferedWithItsNotes() async throws {
        let app = try TestApp(feed: server.url("/appcast.xml"))
        defer { app.remove() }
        server.set("/appcast.xml", .init(body: appcast([
            try item("98", "0.0.9", app),
            // Builds compare as numbers: 120 is newer than 98, though "98" sorts after "120" as text.
            try item("120", "0.2.0", app) { $0.notes = "<h2>Dayhand 0.2.0</h2><ul><li>Faster sync</li><li>Fixes &amp; polish</li></ul>" },
            // Newer, but for a macOS that does not exist yet: skipped.
            try item("1000", "9.0.0", app) { $0.minimumSystemVersion = "99.0" },
        ]), contentType: "application/rss+xml"))
        let updater = Updater(bundle: app.bundle, defaults: app.defaults)
        #expect(updater.isAvailable)

        #expect(await check(updater))
        #expect(updater.state.activity == .available)
        #expect(updater.state.offer == UpdateOffer(version: "0.2.0", build: "120", notes: "Dayhand 0.2.0\n• Faster sync\n• Fixes & polish"))
        #expect(updater.state.hasUpdate)
        #expect(updater.isPresented)

        // Later: the window closes, the button stays.
        updater.dismiss()
        _ = await waitUntil(1) { false }
        #expect(!updater.isPresented)
        #expect(updater.state.activity == .available)
        #expect(updater.state.hasUpdate)
    }

    @Test func theSameBuildIsUpToDate() async throws {
        let app = try TestApp(feed: server.url("/appcast.xml"))
        defer { app.remove() }
        server.set("/appcast.xml", .init(body: appcast([try item("100", "0.1.0", app), try item("99", "0.0.9", app)])))
        let updater = Updater(bundle: app.bundle, defaults: app.defaults)

        #expect(await check(updater))
        #expect(updater.state.activity == .upToDate)
        #expect(!updater.state.hasUpdate)
        #expect(updater.isPresented)

        updater.dismiss()
        #expect(updater.state.activity == .idle)
        #expect(!updater.isPresented)
    }

    @Test func previewVersionsOnlyWhenTheUserAsks() async throws {
        let app = try TestApp(feed: server.url("/appcast.xml"))
        defer { app.remove() }
        server.set("/appcast.xml", .init(body: appcast([
            try item("120", "0.2.0", app),
            try item("130", "0.3.0-preview.1", app) { $0.channel = Updater.previewChannel },
        ])))

        let stable = Updater(bundle: app.bundle, defaults: app.defaults)
        #expect(await check(stable))
        #expect(stable.state.offer?.version == "0.2.0")
        #expect(stable.state.offer?.isPreview == false)
        stable.dismiss()
        _ = await waitUntil(1) { false }

        app.defaults.set(true, forKey: Updater.Keys.includesPreviews)
        let previews = Updater(bundle: app.bundle, defaults: app.defaults)
        #expect(await check(previews))
        #expect(previews.state.offer?.version == "0.3.0-preview.1")
        #expect(previews.state.offer?.isPreview == true)
        previews.dismiss()
    }

    @Test func anUnreadableAppcastIsAPlainError() async throws {
        let app = try TestApp(feed: server.url("/appcast.xml"))
        defer { app.remove() }
        server.set("/appcast.xml", .init(body: Data("<html>Maintenance</html".utf8), contentType: "text/html"))
        let updater = Updater(bundle: app.bundle, defaults: app.defaults)

        #expect(await check(updater))
        #expect(updater.state.activity == .failed(.unreadable))
        #expect(updater.isPresented)
        updater.dismiss()
        #expect(updater.state.activity == .idle)
    }

    @Test func anUnreachableServerSaysSo() async throws {
        // The port of a server that has stopped: nothing answers there.
        let feed = try LocalServer().url("/appcast.xml")
        let app = try TestApp(feed: feed)
        defer { app.remove() }
        let updater = Updater(bundle: app.bundle, defaults: app.defaults)

        #expect(await check(updater))
        #expect(updater.state.activity == .failed(.offline))
    }

    @Test func aBrokenDownloadShowsItsProgressThenAnError() async throws {
        let app = try TestApp(feed: server.url("/appcast.xml"))
        defer { app.remove() }
        let offered = try item("120", "0.2.0", app)
        server.set("/appcast.xml", .init(body: appcast([offered])))
        // The archive's answer promises 200 000 bytes and stops at half.
        server.set("/Dayhand-0.2.0.zip", .init(body: archive, truncateAt: 100_000))
        let updater = Updater(bundle: app.bundle, defaults: app.defaults)
        var seen: [UpdateActivity] = []
        let watch = updater.$state.sink { seen.append($0.activity) }
        defer { watch.cancel() }

        #expect(await check(updater))
        updater.install()
        #expect(await waitUntil {
            if case .failed = updater.state.activity { return true }
            return false
        })
        let downloads = seen.compactMap { activity -> (UInt64, UInt64?)? in
            if case .downloading(let received, let expected) = activity { return (received, expected) }
            return nil
        }
        #expect(downloads.first.map { $0.0 == 0 } == true)
        #expect(downloads.contains { $0.1 == 200_000 })
        #expect(downloads.contains { $0.0 > 0 })
        #expect([UpdateActivity.failed(.download), .failed(.offline)].contains(updater.state.activity))
        // The offer stays, so the button and Try Again do too.
        #expect(updater.state.offer?.version == "0.2.0")
        #expect(server.requested.contains("/Dayhand-0.2.0.zip"))
    }

    @Test func withoutAKeyNothingIsFetched() async throws {
        let app = try TestApp(feed: server.url("/appcast.xml"), withKey: false)
        defer { app.remove() }
        server.set("/appcast.xml", .init(body: appcast([try item("120", "0.2.0", app)])))
        let updater = Updater(bundle: app.bundle, defaults: app.defaults)

        #expect(!updater.isAvailable)
        #expect(updater.state.activity == .unavailable(.noKey))
        updater.checkForUpdates()
        _ = await waitUntil(1) { false }
        #expect(updater.isPresented)
        #expect(updater.state.activity == .unavailable(.noKey))
        #expect(server.requested.isEmpty)
    }

    @Test func theInstallRecordIsReadOnce() throws {
        let app = try TestApp(feed: nil)
        defer { app.remove() }
        let defaults = app.defaults
        let record = InstallRecord(version: "0.2.0", build: "120", startedAt: Date(timeIntervalSince1970: 1_800_000_000))
        record.save(to: defaults)
        #expect(InstallRecord.take(from: defaults) == record)
        #expect(InstallRecord.take(from: defaults) == nil)
    }

    @Test func aFailedInstallIsReportedAtTheNextStart() throws {
        let app = try TestApp(build: "100", feed: nil)
        defer { app.remove() }
        InstallRecord(version: "0.2.0", build: "120", startedAt: Date()).save(to: app.defaults)
        let updater = Updater(bundle: app.bundle, defaults: app.defaults)
        #expect(updater.lastInstall == .notInstalled(version: "0.2.0"))
        #expect(updater.state.activity == .unavailable(.noFeed))
        #expect(Updater(bundle: app.bundle, defaults: app.defaults).lastInstall == nil)
    }
}
