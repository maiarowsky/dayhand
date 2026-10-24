import AppKit
import DayhandCore
import Foundation
import SwiftUI

/**
 * The app's state on the main thread: the tasks from the local database (the only source the screens read), the
 * Today sections computed from them, the server connection and the user's actions. Every action goes through
 * `TaskRepository`, which changes the row and queues the server mutation together, so nothing waits for the network.
 */
@MainActor
final class AppModel: ObservableObject {
    /// What the shared model is built from; the snapshot tool replaces it before the first use.
    static var makeEnvironment: () -> AppEnvironment = { AppEnvironment.standard() }
    static let shared = AppModel(makeEnvironment())

    @Published private(set) var tasks: [TaskItem] = []
    @Published private(set) var sections: TodaySections = .empty
    @Published private(set) var pending = 0
    @Published private(set) var status: SyncStatus = .notConnected
    @Published private(set) var settings = ReminderSettings()
    @Published private(set) var credential: DeviceCredential?
    @Published var selection: String?
    @Published var showConnect = false
    @Published var connectPrefill: PairingLink?
    @Published var alert: String?
    @Published var useOffline: Bool {
        didSet { defaults.set(useOffline, forKey: Keys.useOffline) }
    }

    let repository: TaskRepository
    let notifications: NotificationScheduler?
    /// Opens the main window; set by the first view that has SwiftUI's `openWindow`.
    var openMainWindow: (() -> Void)?

    private let credentials: CredentialStore
    private let defaults: UserDefaults
    private let engineBox = EngineBox()
    private var engine: SyncEngine?
    private var clockTimer: Timer?
    private var planTask: Task<Void, Never>?

    enum Keys {
        static let useOffline = "useOffline"
        static let lastServer = "lastServerUrl"
    }

    init(_ environment: AppEnvironment) {
        let box = engineBox
        repository = TaskRepository(database: environment.database, onOutboxChanged: { box.poke() })
        credentials = environment.credentials
        defaults = environment.defaults
        notifications = environment.notifications ? NotificationScheduler() : nil
        useOffline = environment.defaults.bool(forKey: Keys.useOffline)
        observe()
        clockTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { _ in
            Task { @MainActor in AppModel.shared.recompute() }
        }
        do {
            credential = try credentials.load()
        } catch {
            alert = "The Keychain could not be read, so Dayhand starts without a server."
        }
        if let credential {
            startSession(credential)
        } else if !useOffline {
            showConnect = true
        }
    }

    // MARK: Reading

    func task(_ localId: String) -> TaskItem? { tasks.first { $0.localId == localId } }

    var today: String { HelmDates.localDate(Clock.nowMs(), settings.timezone) }

    private func observe() {
        let repository = repository
        Task { @MainActor [weak self] in
            do {
                for try await tasks in repository.observeTasks() {
                    self?.tasks = tasks
                    self?.recompute()
                    self?.planNotifications()
                }
            } catch {
                self?.alert = "Reading tasks failed: \(error)"
            }
        }
        Task { @MainActor [weak self] in
            for try await count in repository.observePendingCount() { self?.pending = count }
        }
        Task { @MainActor [weak self] in
            for try await settings in repository.observeSettings() {
                self?.settings = settings
                self?.recompute()
                self?.planNotifications()
            }
        }
    }

    /// The Today sections now; called on every change and every 30 seconds, so the screen moves on at midnight.
    func recompute() {
        let next = todaySections(tasks, nowMs: Clock.nowMs(), timezone: settings.timezone)
        if next != sections { sections = next }
    }

    /// The notifications ahead, planned again a moment after the last change (changes come in bursts from a sync).
    private func planNotifications() {
        guard let notifications else { return }
        planTask?.cancel()
        let tasks = tasks, settings = settings
        planTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            await notifications.apply(ReminderPlanner.plan(tasks, settings: settings, now: Clock.nowMs()))
        }
    }

    // MARK: Actions

    /// Adds a task from one line of quick add: a date phrase at its end sets the day and time, otherwise today.
    @discardableResult
    func quickAdd(_ line: String, readPhrase: Bool = true) -> Bool {
        let input = readPhrase
            ? QuickAdd.parse(line, now: Clock.nowMs(), timezone: settings.timezone)
            : QuickAddInput(title: line.trimmingCharacters(in: .whitespacesAndNewlines), when: nil, phrase: nil)
        guard TaskRules.title(input.title) != nil else { return false }
        let date = input.when?.date ?? today
        run { try await $0.add(title: input.title, dueDate: date, dueTime: input.when?.time) }
        return true
    }

    func toggleDone(_ task: TaskItem) {
        let id = task.localId
        run { repo in task.status == .done ? try await repo.reopen(id) : try await repo.complete(id) }
    }

    func moveToToday(_ id: String) { let day = today; run { try await $0.reschedule(id, to: day) } }

    func moveToTomorrow(_ id: String) {
        guard let tomorrow = HelmDates.addDays(today, 1) else { return }
        run { try await $0.reschedule(id, to: tomorrow) }
    }

    func setNow(_ id: String) { run { try await $0.setNow(id) } }
    func clearNow() { run { try await $0.clearNow() } }
    func setStatus(_ id: String, _ status: TaskStatus) { run { try await $0.move(id, to: status) } }
    func rename(_ id: String, _ title: String) { run { try await $0.rename(id, to: title) } }
    func setNote(_ id: String, _ note: String) { run { try await $0.setNote(id, note) } }
    func setResumeNote(_ id: String, _ note: String) { run { try await $0.setResumeNote(id, note) } }
    func setLabels(_ id: String, _ labels: [String]) { run { try await $0.setLabels(id, labels) } }
    func setDue(_ id: String, date: String?, time: String?) { run { try await $0.setDue(id, date: date, time: time) } }
    func archive(_ id: String) { run { try await $0.archive(id) } }
    func moveToTrash(_ id: String) { run { try await $0.moveToTrash(id) } }
    func restore(_ id: String) { run { try await $0.restore(id) } }
    func toggleItem(_ id: String, _ itemId: String) { run { try await $0.toggleItem(id, itemId) } }
    func addItem(_ id: String, _ title: String) { run { try await $0.addItem(id, title) } }
    func removeItem(_ id: String, _ itemId: String) { run { try await $0.removeItem(id, itemId) } }

    /// Sets the due day and time from a phrase ("fri 2pm"); false when the phrase is not understood.
    func setDue(_ id: String, phrase: String) -> Bool {
        guard let when = try? WhenParser.parse(phrase, now: Clock.nowMs(), timezone: settings.timezone) else { return false }
        setDue(id, date: when.date, time: when.time)
        return true
    }

    private func run(_ action: @escaping @Sendable (TaskRepository) async throws -> Void) {
        let repository = repository
        Task { @MainActor [weak self] in
            do {
                try await action(repository)
            } catch RepositoryError.invalid(let message) {
                self?.alert = message.prefix(1).uppercased() + message.dropFirst() + "."
            } catch {
                self?.alert = "The change could not be saved: \(error)"
            }
        }
    }

    // MARK: Server

    func connect(address: String, code: String) async -> ConnectError? {
        let pairing = DevicePairing(api: PairingAPI(), store: credentials)
        let name = Host.current().localizedName ?? "Mac"
        switch await pairing.connect(address: address, code: code, deviceName: name) {
        case .success(let credential):
            defaults.set(credential.serverUrl, forKey: Keys.lastServer)
            self.credential = credential
            useOffline = false
            showConnect = false
            connectPrefill = nil
            startSession(credential)
            return nil
        case .failure(let error):
            return error
        }
    }

    var lastServerUrl: String? { credential?.serverUrl ?? defaults.string(forKey: Keys.lastServer) }

    /// Forgets the sign-in on this Mac. Tasks and waiting changes stay; `dayhand revoke <deviceId>` ends it on the server.
    func disconnect() {
        stopSession()
        do {
            try credentials.delete()
        } catch {
            alert = "The sign-in could not be removed from the Keychain: \(error)"
        }
        credential = nil
        status = .notConnected
    }

    func syncNow() {
        guard let engine else { return }
        Task { await engine.round() }
    }

    /// A `dayhand://pair` or `helm://pair` link (the QR code of `dayhand pair`) opens Connect filled in.
    func open(_ url: URL) {
        guard let link = PairingInput.parseLink(url.absoluteString) else { return }
        connectPrefill = link
        showConnect = true
        showMainWindow()
    }

    func showMainWindow() {
        NSApp.activate(ignoringOtherApps: true)
        if let openMainWindow {
            openMainWindow()
        } else {
            NSApp.windows.first { $0.identifier?.rawValue.hasPrefix("main") == true }?.makeKeyAndOrderFront(nil)
        }
    }

    private func startSession(_ credential: DeviceCredential) {
        stopSession()
        let tokens = DeviceTokens(
            serverUrl: credential.serverUrl, deviceToken: credential.deviceToken, api: PairingAPI(),
            onRevoked: { await MainActor.run { AppModel.shared.signedOut() } }
        )
        let remote = ConvexRemote(deploymentUrl: credential.convexUrl, tokens: tokens)
        let engine = SyncEngine(repository: repository, sender: remote, source: remote, onStatus: { status in
            Task { @MainActor in AppModel.shared.status = status }
        })
        self.engine = engine
        engineBox.set(engine)
        Task { await engine.start() }
    }

    private func stopSession() {
        guard let engine else { return }
        self.engine = nil
        engineBox.set(nil)
        Task { await engine.stop() }
    }

    /// `401` from `/auth/token`: the device was revoked. The token goes; tasks and waiting changes stay.
    private func signedOut() {
        guard credential != nil else { return }
        stopSession()
        try? credentials.delete()
        credential = nil
        status = .signedOut
    }
}

/// The sync engine, reachable from the repository's change callback on any thread.
final class EngineBox: @unchecked Sendable {
    private let lock = NSLock()
    private var engine: SyncEngine?

    func set(_ engine: SyncEngine?) {
        lock.lock()
        self.engine = engine
        lock.unlock()
    }

    func poke() {
        lock.lock()
        let engine = engine
        lock.unlock()
        engine?.poke()
    }
}

/// Where the model keeps things: the database file, the sign-in and the preferences.
struct AppEnvironment {
    var database: AppDatabase
    var credentials: CredentialStore
    var notifications: Bool
    var defaults: UserDefaults

    /**
     * The app's own: `~/Library/Application Support/Dayhand/dayhand.sqlite` and the login Keychain. For trying the app
     * without touching those, `DAYHAND_DATA_DIR` names another folder for the database and `DAYHAND_CREDENTIALS=memory`
     * keeps the sign-in in memory only (it is gone when the app quits).
     */
    static func standard() -> AppEnvironment {
        let environment = ProcessInfo.processInfo.environment
        let database: AppDatabase
        do {
            database = try AppDatabase.onDisk(at: databaseURL(environment))
        } catch {
            // Without its database the app cannot show anything true; stop with the reason in the crash report.
            fatalError("Dayhand could not open its database: \(error)")
        }
        let credentials: CredentialStore = environment["DAYHAND_CREDENTIALS"] == "memory"
            ? MemoryCredentialStore()
            : KeychainCredentialStore()
        return AppEnvironment(
            database: database,
            credentials: credentials,
            notifications: Bundle.main.bundleIdentifier != nil,
            defaults: .standard
        )
    }

    static func databaseURL(_ environment: [String: String]) throws -> URL {
        if let custom = environment["DAYHAND_DATA_DIR"] {
            return URL(fileURLWithPath: custom, isDirectory: true).appendingPathComponent("dayhand.sqlite")
        }
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return support.appendingPathComponent("Dayhand", isDirectory: true).appendingPathComponent("dayhand.sqlite")
    }
}
