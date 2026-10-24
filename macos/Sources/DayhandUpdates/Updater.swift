import Foundation
import os
import Sparkle

/**
 * Dayhand's updates: Sparkle finds, downloads, checks (EdDSA signature) and installs a new version; this object turns
 * what Sparkle reports into an `UpdateState` for the screens, and the user's choices back into Sparkle's replies. It
 * is Sparkle's user driver, so Sparkle shows no windows of its own: the update button and its window are SwiftUI.
 *
 * A build without the update key or a secure appcast address (`UpdateConfiguration`) never creates Sparkle's updater,
 * so it never fetches anything; the state says why updates are unavailable.
 */
@MainActor
public final class Updater: NSObject, ObservableObject {
    @Published public private(set) var state: UpdateState
    /// The update window (a popover on the update button) is open.
    @Published public private(set) var isPresented = false
    /// How the update started in the last run went, once, from its `InstallRecord`.
    @Published public private(set) var lastInstall: InstallRecord.Outcome?

    /// The running version and build.
    public let version: String
    public let build: String

    public static let previewChannel = "preview"
    public enum Keys {
        public static let includesPreviews = "updateIncludesPreviews"
    }

    private let defaults: UserDefaults
    private var updater: SPUUpdater?
    private var driver: UserDriver?
    /// Sparkle's question "install this update?", answered by Update and Relaunch or Later.
    private var pendingChoice: ((SPUUserUpdateChoice) -> Void)?
    private var cancelDownload: (() -> Void)?
    /// Update and Relaunch was pressed with no question waiting; the next one found is answered "install".
    private var wantsInstall = false
    private var userCheckInProgress = false
    private let log = Logger(subsystem: "io.github.maiarowsky.dayhand", category: "updates")

    /// The updater of `bundle` (the app itself, or a stand-in in tests), started at once when the bundle allows it.
    public init(bundle: Bundle = .main, defaults: UserDefaults = .standard) {
        let info = bundle.infoDictionary
        version = info?["CFBundleShortVersionString"] as? String ?? "development"
        build = info?["CFBundleVersion"] as? String ?? ""
        self.defaults = defaults
        state = UpdateState()
        super.init()
        if let record = InstallRecord.take(from: defaults) {
            lastInstall = record.outcome(currentBuild: build) { SUStandardVersionComparator.default.compareVersion($0, toVersion: $1) }
        }
        switch UpdateConfiguration.read(info) {
        case .failure(let reason):
            state = UpdateState(activity: .unavailable(reason))
        case .success:
            let driver = UserDriver(owner: self)
            let updater = SPUUpdater(hostBundle: bundle, applicationBundle: bundle, userDriver: driver, delegate: self)
            do {
                try updater.start()
                self.driver = driver
                self.updater = updater
            } catch {
                log.error("The updater did not start: \(error.localizedDescription, privacy: .public)")
                state = UpdateState(activity: .unavailable(.updaterFailed))
            }
        }
    }

    /// A fixed state with no Sparkle behind it, for drawing the screens (DayhandSnapshots).
    public init(preview: UpdateState, presented: Bool = false, version: String = "0.1.0", build: String = "1", lastInstall: InstallRecord.Outcome? = nil) {
        self.version = version
        self.build = build
        defaults = UserDefaults(suiteName: "io.github.maiarowsky.dayhand.preview") ?? .standard
        state = preview
        isPresented = presented
        self.lastInstall = lastInstall
        super.init()
    }

    public var isAvailable: Bool {
        if case .unavailable = state.activity { return false }
        return true
    }

    /// Check once a day by itself (on by default, `SUEnableAutomaticChecks`); Sparkle keeps the choice.
    public var automaticallyChecks: Bool {
        get { updater?.automaticallyChecksForUpdates ?? true }
        set {
            objectWillChange.send()
            updater?.automaticallyChecksForUpdates = newValue
        }
    }

    /// Also offer preview versions (the appcast's `preview` channel); off by default.
    public var includesPreviews: Bool {
        get { defaults.bool(forKey: Keys.includesPreviews) }
        set {
            objectWillChange.send()
            defaults.set(newValue, forKey: Keys.includesPreviews)
            if updater?.sessionInProgress == false { updater?.checkForUpdatesInBackground() }
        }
    }

    public var lastCheck: Date? { updater?.lastUpdateCheckDate }

    // MARK: The user's actions

    /// Check for Updates: opens the update window, which shows the check and its result.
    public func checkForUpdates() {
        isPresented = true
        guard let updater else { return }
        if updater.canCheckForUpdates { updater.checkForUpdates() }
    }

    /// The update button.
    public func showWindow() {
        isPresented = true
    }

    /// Update and Relaunch: download, check and install the offered version, then start it.
    public func install() {
        if let reply = pendingChoice {
            pendingChoice = nil
            reply(.install)
        } else {
            // Sparkle's question was answered Later; ask it again and answer at once.
            wantsInstall = true
            updater?.checkForUpdates()
        }
    }

    /// Later, or the window closed: the button stays while the newer version is known.
    public func dismiss() {
        isPresented = false
        if let reply = pendingChoice {
            pendingChoice = nil
            reply(.dismiss)
        }
        state.apply(.acknowledged)
    }

    public func cancelDownloading() {
        cancelDownload?()
        cancelDownload = nil
    }

    // MARK: From Sparkle

    fileprivate func apply(_ event: UpdateEvent) {
        state.apply(event)
    }

    fileprivate func userCheckStarted() {
        userCheckInProgress = true
        apply(.checkStarted)
        isPresented = true
    }

    fileprivate func found(_ item: SUAppcastItem, userInitiated: Bool, reply: @escaping (SPUUserUpdateChoice) -> Void) {
        apply(.found(Self.offer(item)))
        if wantsInstall {
            wantsInstall = false
            reply(.install)
        } else {
            pendingChoice = reply
        }
        if userInitiated { isPresented = true }
    }

    fileprivate func notFound() {
        apply(.notFound(userInitiated: true))
    }

    fileprivate func failed(_ error: Error) {
        log.error("Update failed: \(error.localizedDescription, privacy: .public)")
        let shown = state.isWorking || isPresented
        var downloading = false
        if case .downloading = state.activity { downloading = true }
        wantsInstall = false
        apply(.failed(UpdateFailure.from(error, downloading: downloading)))
        if shown { isPresented = true }
    }

    fileprivate func downloadStarted(cancellation: @escaping () -> Void) {
        cancelDownload = cancellation
        apply(.downloadStarted)
    }

    fileprivate func extractionStarted() {
        cancelDownload = nil
        apply(.extracting(nil))
    }

    fileprivate func sessionEnded() {
        pendingChoice = nil
        cancelDownload = nil
        userCheckInProgress = false
        apply(.sessionEnded)
    }

    static func offer(_ item: SUAppcastItem) -> UpdateOffer {
        UpdateOffer(
            version: item.displayVersionString,
            build: item.versionString,
            notes: ReleaseNotes.plainText(item.itemDescription, format: item.itemDescriptionFormat),
            isPreview: item.channel == previewChannel
        )
    }
}

extension Updater: SPUUpdaterDelegate {
    public func allowedChannels(for updater: SPUUpdater) -> Set<String> {
        includesPreviews ? [Self.previewChannel] : []
    }

    public func updaterShouldPromptForPermissionToCheck(forUpdates updater: SPUUpdater) -> Bool { false }

    /// Notes from `sparkle:releaseNotesLink` only when the item carries none of its own.
    public func updater(_ updater: SPUUpdater, shouldDownloadReleaseNotesForUpdate updateItem: SUAppcastItem) -> Bool {
        updateItem.itemDescription == nil
    }

    /// A scheduled check found nothing newer (or not any more): the button goes.
    public func updaterDidNotFindUpdate(_ updater: SPUUpdater, error: any Error) {
        if !userCheckInProgress { apply(.notFound(userInitiated: false)) }
    }

    /// Written just before Sparkle quits the app to install, and read at the next start.
    public func updater(_ updater: SPUUpdater, willInstallUpdate item: SUAppcastItem) {
        InstallRecord(version: item.displayVersionString, build: item.versionString, startedAt: Date()).save(to: defaults)
    }
}

/// Sparkle's user driver: every call becomes an event of the owning `Updater`; Sparkle calls it on the main thread.
@MainActor
private final class UserDriver: NSObject, SPUUserDriver {
    private weak var owner: Updater?

    init(owner: Updater) {
        self.owner = owner
    }

    func show(_ request: SPUUpdatePermissionRequest, reply: @escaping (SUUpdatePermissionResponse) -> Void) {
        reply(SUUpdatePermissionResponse(automaticUpdateChecks: true, sendSystemProfile: false))
    }

    func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {
        owner?.userCheckStarted()
    }

    func showUpdateFound(with appcastItem: SUAppcastItem, state: SPUUserUpdateState, reply: @escaping (SPUUserUpdateChoice) -> Void) {
        guard let owner else { return reply(.dismiss) }
        owner.found(appcastItem, userInitiated: state.userInitiated, reply: reply)
    }

    func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {
        let text = String(data: downloadData.data, encoding: .utf8) ?? String(decoding: downloadData.data, as: UTF8.self)
        let format = downloadData.mimeType?.contains("html") == false ? "plain-text" : nil
        if let notes = ReleaseNotes.plainText(text, format: format) { owner?.apply(.notesLoaded(notes)) }
    }

    func showUpdateReleaseNotesFailedToDownloadWithError(_ error: any Error) {}

    func showUpdateNotFoundWithError(_ error: any Error, acknowledgement: @escaping () -> Void) {
        owner?.notFound()
        acknowledgement()
    }

    func showUpdaterError(_ error: any Error, acknowledgement: @escaping () -> Void) {
        owner?.failed(error)
        acknowledgement()
    }

    func showDownloadInitiated(cancellation: @escaping () -> Void) {
        owner?.downloadStarted(cancellation: cancellation)
    }

    func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {
        owner?.apply(.expectedLength(expectedContentLength))
    }

    func showDownloadDidReceiveData(ofLength length: UInt64) {
        owner?.apply(.received(length))
    }

    func showDownloadDidStartExtractingUpdate() {
        owner?.extractionStarted()
    }

    func showExtractionReceivedProgress(_ progress: Double) {
        owner?.apply(.extracting(progress))
    }

    /// Only Update and Relaunch starts a download (automatic downloads stay off), so the answer is already given.
    func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) {
        owner?.apply(.readyToInstall)
        reply(.install)
    }

    func showInstallingUpdate(withApplicationTerminated applicationTerminated: Bool, retryTerminatingApplication: @escaping () -> Void) {
        owner?.apply(.installing)
    }

    func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) {
        acknowledgement()
    }

    func dismissUpdateInstallation() {
        owner?.sessionEnded()
    }

    func showUpdateInFocus() {
        owner?.showWindow()
    }
}
