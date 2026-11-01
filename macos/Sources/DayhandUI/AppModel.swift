import AppKit
import DayhandCore
import DayhandLocalization
import Foundation
import os
import SwiftUI

/**
 * The app's state on the main thread: the tasks and projects from the local database, the Today sections and the
 * sidebar's counts computed from them, the server connection and the user's actions. Every action goes through
 * `TaskRepository`, which changes the row and queues the server mutation together, so nothing waits for the network.
 */
@MainActor
final class AppModel: ObservableObject {
    /// What the shared model is built from; the snapshot tool replaces it before the first use.
    static var makeEnvironment: () -> AppEnvironment = { AppEnvironment.standard() }
    static let shared = AppModel(makeEnvironment())

    @Published private(set) var tasks: [TaskItem] = []
    @Published private(set) var sections: TodaySections = .empty
    /// The tasks in the trash, the most recently deleted first.
    @Published private(set) var trash: [TaskItem] = []
    @Published private(set) var pending = 0
    @Published private(set) var status: SyncStatus = .notConnected {
        didSet {
            if Self.historyRecovered(from: oldValue, to: status) { historyRefreshRevision += 1 }
            if Self.healthDue(status, lastRead: healthReadAt, now: Clock.nowMs()) { refreshHealth() }
        }
    }
    /// Moves on when the connection comes back and on Sync Now, so an open task's history is fetched again.
    @Published private(set) var historyRefreshRevision = 0
    @Published private(set) var settings = ReminderSettings()
    /// The last plan health report from the server, kept offline; nil hides the card above Today.
    @Published private(set) var health: PlanHealth?
    @Published private(set) var credential: DeviceCredential?
    /// The projects, archived ones included, in the sidebar's order (`AppModel+Projects.swift`).
    @Published private(set) var projects: [Project] = []
    /// Whether the server has projects; a server without them (0.12.x) hides them.
    @Published private(set) var projectSupport: ProjectSupport = .unknown
    /// The numbers next to the sidebar's places.
    @Published private(set) var counts: SidebarCounts = .empty
    /// The tasks of the place picked in the sidebar in sections, for the places that list them (`Place.filter`).
    @Published private(set) var list: TaskListSections = .empty
    /// What is typed in the toolbar's search field; it narrows every list.
    @Published var search = "" {
        didSet { if search != oldValue { recompute() } }
    }
    @Published var selection: String?
    /// The place picked in the sidebar (`show(_:)` changes it).
    @Published private(set) var place: Place = .today
    /// Board, plan or list, as last picked in the toolbar.
    @Published var viewMode: ViewMode {
        didSet { defaults.set(viewMode.rawValue, forKey: Keys.viewMode) }
    }
    /// Whether the sidebar shows its Projects section open, as last left.
    @Published var projectsExpanded: Bool {
        didSet { defaults.set(projectsExpanded, forKey: Keys.projectsExpanded) }
    }
    /// The project editor sheet, open for a new project or one to edit.
    @Published var projectEditor: ProjectEditorRequest?
    /// The task whose project is being picked (Move to Project…, ⇧⌘M).
    @Published var movingTask: TaskPick?
    /// The project whose deletion asks where its tasks go.
    @Published var deletingProject: ProjectPick?
    @Published var showConnect = false
    @Published var connectPrefill: PairingLink?
    @Published var alert: String?
    @Published var useOffline: Bool {
        didSet { defaults.set(useOffline, forKey: Keys.useOffline) }
    }
    /// "system" or one of `Localization.supported`, as picked in Settings.
    @Published private(set) var languageChoice: String
    /// The language Dayhand speaks now; the windows are drawn again when it changes.
    @Published private(set) var language: String

    let repository: TaskRepository
    let defaults: UserDefaults
    let history: TaskHistorySync
    let healthSync: PlanHealthSync
    let notifications: NotificationScheduler?
    /// Opens the main window; set by the first view that has SwiftUI's `openWindow`.
    var openMainWindow: (() -> Void)?

    private let credentials: CredentialStore
    private let engineBox = EngineBox()
    /// The connected server's sync engine; nil without a pairing.
    private(set) var engine: SyncEngine?
    private var syncActive = false
    private var clockTimer: Timer?
    private var planTask: Task<Void, Never>?
    private var healthTask: Task<Void, Never>?
    /// When the plan health was last asked for (Unix ms).
    private var healthReadAt: Int64 = 0
    private let launchLanguage: String

    enum Keys {
        static let useOffline = "useOffline"
        static let lastServer = "lastServerUrl"
        static let language = "language"
        static let projectsExpanded = "sidebarProjectsExpanded"
        static let viewMode = "viewMode"
        /// macOS's own per-app language, which the menus that come with AppKit follow from the next start.
        static let appleLanguages = "AppleLanguages"
    }

    static let systemLanguageChoice = "system"

    init(_ environment: AppEnvironment) {
        let box = engineBox
        repository = TaskRepository(
            database: environment.database, onOutboxChanged: { box.poke() }, repeatsOnMac: { !box.hasServer }
        )
        history = TaskHistorySync(repository: repository, runner: { box.queries })
        healthSync = PlanHealthSync(repository: repository, runner: { box.queries })
        credentials = environment.credentials
        defaults = environment.defaults
        let choice = environment.defaults.string(forKey: Keys.language) ?? Self.systemLanguageChoice
        let language = Self.applyLanguage(choice)
        languageChoice = choice
        self.language = language
        launchLanguage = language
        notifications = environment.notifications ? NotificationScheduler() : nil
        useOffline = environment.defaults.bool(forKey: Keys.useOffline)
        projectsExpanded = environment.defaults.object(forKey: Keys.projectsExpanded) as? Bool ?? true
        viewMode = environment.defaults.string(forKey: Keys.viewMode).flatMap(ViewMode.init) ?? .list
        observe()
        clockTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { _ in
            Task { @MainActor in AppModel.shared.recompute() }
        }
        do {
            credential = try credentials.load()
        } catch {
            alert = tr("The Keychain could not be read, so Dayhand starts without a server.")
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
                    self?.refreshHealth()
                }
            } catch {
                self?.alert = tr("Reading tasks failed: \(String(describing: error))")
            }
        }
        Task { @MainActor [weak self] in
            for try await count in repository.observePendingCount() { self?.pending = count }
        }
        Task { @MainActor [weak self] in
            for try await health in repository.observePlanHealth() { self?.health = health }
        }
        Task { @MainActor [weak self] in
            for try await projects in repository.observeProjects() {
                self?.projects = projects
                self?.leaveGonePlace()
                self?.recompute()
            }
        }
        Task { @MainActor [weak self] in
            for try await support in repository.observeProjectSupport() {
                self?.projectSupport = support
                self?.leaveGonePlace()
                self?.recompute()
            }
        }
        Task { @MainActor [weak self] in
            for try await settings in repository.observeSettings() {
                self?.settings = settings
                self?.recompute()
                self?.planNotifications()
            }
        }
    }

    /// A project deleted elsewhere, or projects gone with an older server, leave its place for Today.
    private func leaveGonePlace() {
        switch place {
        case .project(let id) where !showsProjects || project(id) == nil: show(.today)
        case .noProject, .archivedProjects: if !showsProjects { show(.today) }
        default: break
        }
    }

    /// Called on changes and every 30 seconds; publish even equal sections for midnight labels and cached claim expiry.
    func recompute() {
        objectWillChange.send()
        let now = Clock.nowMs()
        let next = todaySections(tasks, nowMs: now, timezone: settings.timezone)
        if next != sections { sections = next }
        let nextCounts = sidebarCounts(tasks, projects: showsProjects ? projects : [], today: next.date)
        if nextCounts != counts { counts = nextCounts }
        let shown = isSearching ? tasks.filter(matchesSearch) : tasks
        let nextList = place.filter.map {
            taskListSections(shown, filter: $0, projects: showsProjects ? projectIds : [], nowMs: now, timezone: settings.timezone)
        } ?? .empty
        if nextList != list { list = nextList }
        let deleted = shown.filter(\.inTrash).sorted { ($0.deletedAt ?? 0) > ($1.deletedAt ?? 0) }
        if deleted != trash { trash = deleted }
    }

    /// Fetches a task's history from the server into the cache; without a server the cached copy stays.
    func refreshHistory(_ serverId: String?) async -> HistoryState {
        await history.refresh(serverId: serverId)
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

    /**
     * Reads the plan health report again a moment after the last change (changes come in bursts from a sync), when
     * a server is connected. Approval requests and proposals change on the server without a task changing, so a
     * synced poll also reads it once it is a minute old (`healthDue`).
     */
    func refreshHealth(afterNanoseconds delay: UInt64 = 1_000_000_000) {
        guard engineBox.hasServer else { return }
        healthTask?.cancel()
        let sync = healthSync
        healthTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: delay)
            guard !Task.isCancelled else { return }
            self?.healthReadAt = Clock.nowMs()
            _ = await sync.refresh()
        }
    }

    /// How old the report may get while polls keep succeeding.
    static let healthMaxAgeMs: Int64 = 60_000

    static func healthDue(_ status: SyncStatus, lastRead: Int64, now: Int64) -> Bool {
        guard case .synced = status else { return false }
        return now - lastRead >= healthMaxAgeMs
    }

    /// The approval requests and proposals waiting for the owner, from the server (Review on the health card).
    func loadInbox() async -> Result<AgentInbox, AgentInbox.LoadError> {
        await AgentInbox.load(engineBox.queries)
    }

    // MARK: Actions

    /**
     * Adds a task from one line of quick add: a date phrase at its end sets the day and time, otherwise the day of
     * [place] (today on Today, none in the other lists); a `+project` word sets the project, otherwise the project of
     * [place] while it takes tasks.
     */
    @discardableResult
    func quickAdd(_ line: String, readPhrase: Bool = true, in place: Place = .today) -> Bool {
        let input = parseQuickAdd(line, readPhrase: readPhrase)
        guard TaskRules.title(input.title) != nil else { return false }
        let context = quickAddContext(place)
        let date = input.when?.date ?? context.date
        let project = input.projectLocalId ?? context.project
        run { try await $0.add(title: input.title, dueDate: date, dueTime: input.when?.time, projectLocalId: project) }
        return true
    }

    /// What quick add takes from [place]; its project only while the server has projects.
    func quickAddContext(_ place: Place) -> QuickAddContext {
        QuickAddContext(place, today: today, projects: showsProjects ? projects : [])
    }

    /// One line of quick add as it will be added; without [readPhrase] the date words stay in the title.
    func parseQuickAdd(_ line: String, readPhrase: Bool) -> QuickAddInput {
        QuickAdd.parse(line, now: Clock.nowMs(), timezone: settings.timezone, projects: showsProjects ? projects : [], readDate: readPhrase)
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

    /// Opens a place of the sidebar; a selected task that is not there is let go. A project opens its section.
    func show(_ place: Place) {
        guard place != self.place else { return }
        self.place = place
        recompute()
        if case .project = place { projectsExpanded = true }
        if let id = selection, let task = task(id), !place.lists(task, projects: projectIds) { selection = nil }
    }

    func setNow(_ id: String) { run { try await $0.setNow(id) } }
    func clearNow() { run { try await $0.clearNow() } }
    func setStatus(_ id: String, _ status: TaskStatus) { run { try await $0.move(id, to: status) } }
    func rename(_ id: String, _ title: String) { run { try await $0.rename(id, to: title) } }
    func setNote(_ id: String, _ note: String) { run { try await $0.setNote(id, note) } }
    func setResumeNote(_ id: String, _ note: String) { run { try await $0.setResumeNote(id, note) } }
    func setDue(_ id: String, date: String?, time: String?) { run { try await $0.setDue(id, date: date, time: time) } }
    func setRepeat(_ id: String, _ rule: RepeatRule?) { run { try await $0.setRepeat(id, rule) } }
    func setReminders(_ id: String, _ reminders: [TaskReminder]?) { run { try await $0.setReminders(id, reminders) } }
    func archive(_ id: String) { run { try await $0.archive(id) } }
    func moveToTrash(_ id: String) { run { try await $0.moveToTrash(id) } }
    func restore(_ id: String) { run { try await $0.restore(id) } }
    func toggleItem(_ id: String, _ itemId: String) { run { try await $0.toggleItem(id, itemId) } }
    func addItem(_ id: String, _ title: String) { run { try await $0.addItem(id, title) } }
    func removeItem(_ id: String, _ itemId: String) { run { try await $0.removeItem(id, itemId) } }
    func setSummaryTime(_ time: String) { run { try await $0.updateSettings(summaryTime: time) } }
    func setDefaultReminders(_ minutes: [Int]) { run { try await $0.updateSettings(reminderMinutes: minutes) } }

    /// Sets the due day and time from a phrase ("fri 2pm"); false when the phrase is not understood.
    func setDue(_ id: String, phrase: String) -> Bool {
        guard let when = try? WhenParser.parse(phrase, now: Clock.nowMs(), timezone: settings.timezone) else { return false }
        setDue(id, date: when.date, time: when.time)
        return true
    }

    /**
     * A project change, made on the server at once (`ProjectCalls.swift`), with a failure in the alert: without a
     * connected server, or when it cannot be reached, the change needs a connection and nothing is queued.
     */
    func runOnServer(_ action: @escaping @Sendable (SyncEngine) async throws -> Void) {
        guard let engine else {
            alert = Self.needsConnection
            return
        }
        Task { @MainActor [weak self] in
            do {
                try await action(engine)
            } catch {
                self?.alert = Self.failure(error)
            }
        }
    }

    static var needsConnection: String { tr("Requires a connection to the server.") }

    /// What the user is told when a change fails.
    static func failure(_ error: Error) -> String {
        if case RepositoryError.invalid(let message) = error { return message }
        return tr("The change could not be saved: \(String(describing: error))")
    }

    func run(_ action: @escaping @Sendable (TaskRepository) async throws -> Void) {
        let repository = repository
        Task { @MainActor [weak self] in
            do {
                try await action(repository)
            } catch {
                self?.alert = Self.failure(error)
            }
        }
    }

    // MARK: Language

    /// The language "system" stands for: the first of the Mac's languages Dayhand speaks.
    var systemLanguage: String { Localization.resolve(choice: nil, preferredLanguages: Self.macLanguages()) }

    /// The menus that come with macOS still speak the language Dayhand started in.
    var languageNeedsRestart: Bool { language != launchLanguage }

    /// Only an app bundle can open itself again.
    var canRelaunch: Bool { Bundle.main.bundleIdentifier != nil }

    /// Speaks `choice` ("system" or a language) at once: the windows are drawn again and the notifications planned
    /// again in it. macOS's menus follow at the next start.
    func chooseLanguage(_ choice: String) {
        guard choice != languageChoice else { return }
        defaults.set(choice, forKey: Keys.language)
        if canRelaunch {
            if choice == Self.systemLanguageChoice {
                defaults.removeObject(forKey: Keys.appleLanguages)
            } else {
                defaults.set([choice], forKey: Keys.appleLanguages)
            }
        }
        languageChoice = choice
        language = Self.applyLanguage(choice)
        notifications?.registerCategories()
        planNotifications()
    }

    /// Quits and opens the app again once this process has ended, so the new language reaches every menu.
    func relaunch() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [
            "-c", "while kill -0 \"$1\" 2>/dev/null; do sleep 0.2; done; /usr/bin/open \"$2\"",
            "relaunch", String(ProcessInfo.processInfo.processIdentifier), Bundle.main.bundlePath,
        ]
        do {
            try process.run()
            NSApp.terminate(nil)
        } catch {
            alert = tr("Dayhand could not restart. Quit it and open it again.")
        }
    }

    /**
     * Makes `choice` the language of the texts and returns the language it is. `DAYHAND_LANG` (a language code)
     * overrides the choice, for trying the app in a language without changing Settings. The Mac's languages come from
     * the global preferences, which an earlier choice in this app does not mask.
     */
    static func applyLanguage(_ choice: String) -> String {
        let forced = ProcessInfo.processInfo.environment["DAYHAND_LANG"].flatMap(Localization.match)
        let picked = forced ?? (choice == systemLanguageChoice ? nil : choice)
        let language = Localization.resolve(choice: picked, preferredLanguages: macLanguages())
        let localization = picked == nil
            ? Localization(language: language, locale: .autoupdatingCurrent)
            : Localization(language: language, region: Locale.current.region?.identifier)
        Localization.use(localization)
        // One line in the system log, so a running app's language can be checked: log show --predicate 'subsystem == "io.github.maiarowsky.dayhand"'
        Logger(subsystem: "io.github.maiarowsky.dayhand", category: "language")
            .notice("Texts in \(language, privacy: .public) (choice \(choice, privacy: .public)): \(tr("Today"), privacy: .public)")
        return language
    }

    static func macLanguages() -> [String] {
        let global = CFPreferencesCopyValue(
            Keys.appleLanguages as CFString, kCFPreferencesAnyApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost
        )
        return global as? [String] ?? Locale.preferredLanguages
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
            alert = tr("The sign-in could not be removed from the Keychain: \(String(describing: error))")
        }
        credential = nil
        status = .notConnected
        forgetHealth()
    }

    /// Without a server there is no report to show; the card goes.
    private func forgetHealth() {
        healthTask?.cancel()
        let repository = repository
        Task { try? await repository.forgetPlanHealth() }
    }

    /// The server answers again after it did not (or after connecting); a poll that stays synced is not a recovery.
    static func historyRecovered(from previous: SyncStatus, to current: SyncStatus) -> Bool {
        switch (previous, current) {
        case (.offline, .synced), (.signedOut, .synced), (.connecting, .synced): return true
        default: return false
        }
    }

    func setSyncActive(_ active: Bool) {
        guard active != syncActive else { return }
        syncActive = active
        if let engine { Task { await engine.setActive(active) } }
    }

    func syncUserActivity() {
        if let engine { Task { await engine.userActivity() } }
    }

    func syncNow() async {
        if let engine { await engine.round() }
        historyRefreshRevision += 1
        refreshHealth(afterNanoseconds: 0)
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
        engineBox.set(engine, queries: remote)
        let active = syncActive
        Task {
            await engine.setActive(active)
            await engine.start()
        }
        refreshHealth(afterNanoseconds: 0)
    }

    private func stopSession() {
        guard let engine else { return }
        self.engine = nil
        engineBox.set(nil, queries: nil)
        Task { await engine.stop() }
    }

    /// `401` from `/auth/token`: the device was revoked. The token goes; tasks and waiting changes stay.
    private func signedOut() {
        guard credential != nil else { return }
        stopSession()
        try? credentials.delete()
        credential = nil
        status = .signedOut
        forgetHealth()
    }
}

/// The sync engine and the server's queries, reachable from the repository's change callback and the history on any
/// thread.
final class EngineBox: @unchecked Sendable {
    private let lock = NSLock()
    private var engine: SyncEngine?
    private var runner: QueryRunner?

    func set(_ engine: SyncEngine?, queries: QueryRunner?) {
        lock.lock()
        self.engine = engine
        runner = queries
        lock.unlock()
    }

    var hasServer: Bool {
        lock.lock()
        defer { lock.unlock() }
        return engine != nil
    }

    /// The connected server's queries, or nil without one.
    var queries: QueryRunner? {
        lock.lock()
        defer { lock.unlock() }
        return runner
    }

    func poke() {
        lock.lock()
        let engine = engine
        lock.unlock()
        engine?.poke()
    }
}

/**
 * The places of the main window's sidebar: the inbox (approval requests and proposals waiting for the owner), Today,
 * every task, the tasks without a project, a project, the archived projects, the done and archived tasks,
 * and the trash.
 */
enum Place: Hashable {
    case inbox, today, all, noProject, project(String), archivedProjects, done, trash

    /// The tasks a list place shows in sections; nil for the places with their own views.
    var filter: TaskFilter? {
        switch self {
        case .all: return .all
        case .noProject: return .noProject
        case .project(let id): return .project(id)
        case .inbox, .today, .archivedProjects, .done, .trash: return nil
        }
    }

    /// The task list the place shows (the inbox and the archived projects list no tasks).
    func lists(_ task: TaskItem, projects: Set<String>) -> Bool {
        switch self {
        case .trash: return task.inTrash
        case .done: return !task.inTrash && (task.status == .done || task.archivedAt != nil)
        case .today: return task.isActive
        case .inbox, .archivedProjects: return false
        case .all, .noProject, .project: return task.isActive && filter?.matches(task, projects: projects) == true
        }
    }
}

/// What quick add takes from the place it is typed in: the day (today on Today) and the project, if it takes tasks.
struct QuickAddContext: Equatable {
    let date: String?
    let project: String?

    init(_ place: Place, today: String, projects: [Project]) {
        switch place {
        case .inbox, .today, .archivedProjects, .done, .trash: date = today
        case .all, .noProject, .project: date = nil
        }
        if case .project(let id) = place, projects.contains(where: { $0.localId == id && !$0.isArchived }) {
            project = id
        } else {
            project = nil
        }
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
