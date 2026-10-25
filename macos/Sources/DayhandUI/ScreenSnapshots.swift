import AppKit
import DayhandCore
import DayhandLocalization
import DayhandUpdates
import KeyboardShortcuts
import SwiftUI

/**
 * Renders the main screens to PNG files from synthetic tasks, without a display and without screen recording
 * permission: each view is drawn into an off-screen window (`NSHostingView.cacheDisplay`). The model runs on a
 * database in memory, with the sign-in in memory and no server, so nothing on the Mac is read or changed.
 *
 *     swift run DayhandSnapshots <output folder> [language]
 *
 * The language is one of `Localization.supported` (English by default), so each language can be checked on screen.
 */
public enum ScreenSnapshots {
    @MainActor
    public static func run(outputDirectory: URL, language: String = "en") {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        UserDefaults.standard.register(defaults: [AppModel.Keys.useOffline: true, AppModel.Keys.language: language])
        AppModel.makeEnvironment = {
            // A failure here is a bug in the tool; it reports and stops.
            AppEnvironment(
                database: try! AppDatabase.inMemory(),
                credentials: MemoryCredentialStore(),
                notifications: false,
                defaults: .standard
            )
        }
        // A newer version found, with no Sparkle behind it: nothing is fetched.
        Updater.make = { Updater(preview: UpdateState(activity: .available, offer: demoOffer)) }
        Task { @MainActor in
            do {
                try registerShortcut()
                try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
                try await renderAll(to: outputDirectory)
                #if DEBUG
                // Every text on the screens drawn must be in the string catalog.
                let missing = Localization.missingKeys
                if !missing.isEmpty {
                    FileHandle.standardError.write(Data("Not in Localizable.xcstrings: \(missing.sorted())\n".utf8))
                    exit(1)
                }
                #endif
                exit(0)
            } catch {
                FileHandle.standardError.write(Data("Snapshots failed: \(error)\n".utf8))
                exit(1)
            }
        }
        app.run()
    }

    @MainActor
    static func renderAll(to folder: URL) async throws {
        let model = AppModel.shared
        try await seed(model)
        try await Task.sleep(nanoseconds: 800_000_000)
        model.recompute()
        let updater = Updater.shared
        let window = { MainWindow().environmentObject(model).environmentObject(updater) }
        // The sidebar's translucent background does not draw off screen, so the window's shots draw it over its column.
        let sidebar = { AnyView(Sidebar().environmentObject(model).environmentObject(updater)) }
        let wide = CGSize(width: 1100, height: 700), narrow = CGSize(width: 820, height: 500)
        func png(_ name: String) -> URL { folder.appendingPathComponent("\(name).png") }
        func task(_ title: String) -> TaskItem? { model.tasks.first { $0.title == title } }

        // Today and a project with a task's panel open, at both widths and in both appearances; every task.
        let bakery = model.projects.first { $0.name == "Bakery website" }
        let places: [(String, Place, String?)] = [
            ("today", .today, "Call the accountant"),
            ("project", .project(bakery?.localId ?? ""), "Send the invoice to Anna"),
            ("all", .all, nil),
        ]
        for (name, place, selected) in places {
            model.show(place)
            model.selection = selected.flatMap(task)?.localId
            for dark in [false, true] {
                let suffix = dark ? "-dark" : ""
                try await render(window(), wide, dark, png("\(name)-1100\(suffix)"), sidebar: sidebar())
                if selected != nil { try await render(window(), narrow, dark, png("\(name)-820\(suffix)"), sidebar: sidebar()) }
            }
        }
        // The same places as a board.
        model.viewMode = .board
        for (name, place, selected) in places where selected != nil {
            model.show(place)
            model.selection = selected.flatMap(task)?.localId
            for dark in [false, true] {
                let suffix = dark ? "-dark" : ""
                try await render(window(), wide, dark, png("board-\(name)-1100\(suffix)"), sidebar: sidebar())
                try await render(window(), narrow, dark, png("board-\(name)-820\(suffix)"), sidebar: sidebar())
            }
        }
        model.show(.today)
        model.selection = task("Call the accountant")?.localId
        var layoutProblems: [String] = []
        for mode in ViewMode.allCases {
            model.viewMode = mode
            layoutProblems += try await WindowLayoutCheck.run(window()).map { "\(mode.rawValue): \($0)" }
        }
        if !layoutProblems.isEmpty { throw SnapshotError.layout(layoutProblems) }
        for dark in [false, true] {
            try await render(sidebar(), CGSize(width: 250, height: 700), dark, png("sidebar\(dark ? "-dark" : "")"))
        }
        try await renderPanels(model, folder)
        try await renderProjectSheets(model, folder)
        for (name, place) in [("done", Place.done), ("archived-projects", .archivedProjects), ("no-project", .noProject), ("label", .label("home"))] {
            model.show(place)
            model.selection = nil
            try await render(window(), wide, false, png(name), sidebar: sidebar())
        }
        model.show(.inbox)
        try await render(InboxPlace().environmentObject(model), CGSize(width: 700, height: 300), false, png("inbox-offline"))
        try await render(AgentInboxView(preview: .loaded(demoInbox)).environmentObject(model), CGSize(width: 480, height: 460), false, png("agent-inbox"))
        model.show(.trash)
        model.selection = model.trash.first?.localId
        for dark in [false, true] {
            try await render(window(), wide, dark, png("trash\(dark ? "-dark" : "")"), sidebar: sidebar())
        }
        model.show(.today)
        model.selection = nil
        try await render(MenuBarView().environmentObject(model), CGSize(width: 340, height: 430), false, png("menu-bar"))
        try await render(
            QuickAddView(line: "Call the accountant fri 2pm +home", onDone: {}).environmentObject(model),
            CGSize(width: 560, height: 96), false, png("quick-add")
        )
        model.connectPrefill = PairingInput.parseLink("dayhand://pair?url=http%3A%2F%2F127.0.0.1%3A3211&code=E6M8-FE02-XSNT")
        try await render(ConnectView().environmentObject(model), CGSize(width: 520, height: 400), false, png("connect"))
        try await render(SettingsView().environmentObject(model).environmentObject(updater), CGSize(width: 520, height: 420), false, png("settings"))
        try await render(GeneralSettings().environmentObject(model), CGSize(width: 520, height: 700), false, png("settings-notifications"))
        try await renderUpdates(to: folder)
    }

    /// The task panel from top to bottom for the tasks that fill each part, and the repeat and reminder editors.
    @MainActor
    static func renderPanels(_ model: AppModel, _ folder: URL) async throws {
        let size = CGSize(width: 1000, height: 1100)
        let shots = [
            ("panel", "Call the accountant"), ("panel-agent", "Ship the release notes"),
            ("panel-proof", "Publish the newsletter"), ("panel-history-offline-empty", "Buy milk"),
        ]
        for (name, title) in shots {
            guard let task = model.tasks.first(where: { $0.title == title }) else { continue }
            for dark in [false, true] where name == "panel" || !dark {
                try await render(
                    TaskPanel(task: task, available: 2000, pinnedHeight: size.height).environmentObject(model), size, dark,
                    folder.appendingPathComponent("\(name)\(dark ? "-dark" : "").png")
                )
            }
        }
        guard let call = model.tasks.first(where: { $0.title == "Call the accountant" }) else { return }
        // The same task repeating monthly on its nth weekday, counted from completion, six times including this one.
        var monthly = call
        if let due = call.dueDate.flatMap(CivilDate.init) {
            monthly.repeat = RepeatRule(
                every: .month, from: .completion,
                weekdayOfMonth: WeekdayOfMonth(nth: RepeatDraft.nthOfMonth(due), weekday: due.weekday), count: 6
            )
        }
        let today = model.today
        try await render(Form { RepeatEditor(task: monthly, today: today) }.formStyle(.grouped).environmentObject(model), CGSize(width: 480, height: 560), false, folder.appendingPathComponent("repeat-month.png"))
        if let plants = model.tasks.first(where: { $0.title == "Water the plants" }) {
            try await render(Form { RepeatEditor(task: plants, today: today) }.formStyle(.grouped).environmentObject(model), CGSize(width: 480, height: 520), false, folder.appendingPathComponent("repeat-week.png"))
            try await render(Form { ReminderEditor(task: plants, defaults: model.settings.reminderMinutes) }.formStyle(.grouped).environmentObject(model), CGSize(width: 460, height: 400), false, folder.appendingPathComponent("reminders-settings.png"))
        }
        try await render(Form { ReminderEditor(task: call, defaults: model.settings.reminderMinutes) }.formStyle(.grouped).environmentObject(model), CGSize(width: 460, height: 400), false, folder.appendingPathComponent("reminders-custom.png"))
    }

    /// The project editor (new and editing), Move to Project… and Delete Project….
    @MainActor
    static func renderProjectSheets(_ model: AppModel, _ folder: URL) async throws {
        let bakery = model.projects.first { $0.name == "Bakery website" }
        for dark in [false, true] {
            try await render(ProjectEditor(project: nil).environmentObject(model), CGSize(width: 480, height: 400), dark, folder.appendingPathComponent("project-new\(dark ? "-dark" : "").png"))
        }
        try await render(ProjectEditor(project: bakery).environmentObject(model), CGSize(width: 480, height: 400), false, folder.appendingPathComponent("project-edit.png"))
        if let milk = model.tasks.first(where: { $0.title == "Buy milk" }) {
            try await render(ProjectPicker(taskId: milk.localId).environmentObject(model), CGSize(width: 360, height: 390), false, folder.appendingPathComponent("project-picker.png"))
        }
        if let bakery {
            try await render(DeleteProjectSheet(projectId: bakery.localId).environmentObject(model), CGSize(width: 420, height: 220), false, folder.appendingPathComponent("project-delete.png"))
        }
    }

    /// Requests and proposals as Review lists them.
    static let demoInbox = AgentInbox(
        approvals: [ApprovalRequest(
            id: "ap1", action: "Send the invoice to Anna by email", detail: "Invoice 2026/10/14, 1 200 PLN", taskRef: 1,
            taskTitle: "Send the invoice to Anna", requestedBy: "claude", options: ["Send", "Not now"],
            expiresAt: Clock.nowMs() + 2 * 3_600_000
        )],
        proposals: [
            Proposal(id: "p1", ref: 40, title: "Renew the domain dayhand.dev", dueDate: nil, requestedBy: "monitoring"),
            Proposal(id: "p2", ref: 41, title: "Answer the support email from Tom", requestedBy: "claude"),
        ]
    )

    static let demoOffer = UpdateOffer(
        version: "0.2.0", build: "412",
        notes: ReleaseNotes.plainText("<ul><li>Board and calendar on the Mac</li><li>Reminders no longer ring late after sleep</li><li>Faster sync</li></ul>")
    )

    /// The update window in each of its states, and Settings → Updates in a build without the key and in one with it.
    @MainActor
    static func renderUpdates(to folder: URL) async throws {
        let windows: [(String, UpdateState, InstallRecord.Outcome?)] = [
            ("available", UpdateState(activity: .available, offer: demoOffer), nil),
            ("checking", UpdateState(activity: .checking), nil),
            ("downloading", UpdateState(activity: .downloading(received: 4_200_000, expected: 9_600_000), offer: demoOffer), nil),
            ("installing", UpdateState(activity: .installing, offer: demoOffer), nil),
            ("failed", UpdateState(activity: .failed(.download), offer: demoOffer), nil),
            ("up-to-date", UpdateState(activity: .upToDate), nil),
            ("unavailable", UpdateState(activity: .unavailable(.noKey)), nil),
            ("not-installed", UpdateState(activity: .available, offer: demoOffer), .notInstalled(version: "0.2.0")),
        ]
        for (name, state, lastInstall) in windows {
            let updater = Updater(preview: state, presented: true, lastInstall: lastInstall)
            try await render(UpdateWindow().environmentObject(updater).fixedSize(horizontal: false, vertical: true), CGSize(width: 320, height: 300), false, folder.appendingPathComponent("update-\(name).png"))
        }
        for (name, state) in [("unavailable", UpdateState(activity: .unavailable(.noKey))), ("available", UpdateState(activity: .available, offer: demoOffer))] {
            let updater = Updater(preview: state, build: "412")
            try await render(UpdateSettings().environmentObject(updater), CGSize(width: 520, height: 360), false, folder.appendingPathComponent("settings-updates-\(name).png"))
        }
    }

    /// KeyboardShortcuts stores the initial shortcut in the preferences unless its key already has a value. The tool
    /// gives it one in the registration domain, which is never written, so it leaves no preferences behind (removing
    /// them afterwards still leaves an empty file once macOS flushes its cache). The key is the package's for
    /// `.quickAdd`, spelled out because touching `.quickAdd` here would store the shortcut first.
    static func registerShortcut() throws {
        let shortcut = String(decoding: try JSONEncoder().encode(KeyboardShortcuts.Name.quickAddInitial), as: UTF8.self)
        UserDefaults.standard.register(defaults: ["KeyboardShortcuts_quickAdd": shortcut])
    }

    /// A day in Warsaw, as if it had come from the server.
    @MainActor
    static func seed(_ model: AppModel) async throws {
        let zone = "Europe/Warsaw"
        let now = Clock.nowMs()
        let today = HelmDates.localDate(now, zone)
        let day = { (offset: Int) in HelmDates.addDays(today, offset) ?? today }
        var ref = 0
        func task(_ title: String, _ change: (inout RemoteTask) -> Void = { _ in }) -> RemoteTask {
            ref += 1
            var t = RemoteTask(id: "demo\(ref)", title: title, dueDate: today, createdAt: now - Int64(ref) * 60_000, updatedAt: now - 1000, ref: ref)
            change(&t)
            return t
        }
        let projects = [
            RemoteProject(id: "p-bakery", name: "Bakery website", color: .amber, icon: "🥐", note: "The new site for Anna's bakery", position: 1024, createdAt: now, updatedAt: now),
            RemoteProject(id: "p-home", name: "Home", color: .green, position: 2048, createdAt: now, updatedAt: now),
            RemoteProject(id: "p-dayhand", name: "Dayhand", color: .indigo, position: 3072, createdAt: now, updatedAt: now),
            RemoteProject(id: "p-health", name: "Health", color: .teal, position: 4096, createdAt: now, updatedAt: now),
            RemoteProject(id: "p-blog", name: "Old blog", color: .gray, position: 5120, archivedAt: now - 86_400_000, createdAt: now, updatedAt: now),
        ]
        let tasks = [
            task("Send the invoice to Anna") { $0.dueDate = day(-2); $0.labels = ["work"]; $0.projectId = "p-bakery" },
            task("Write the project brief") {
                $0.projectId = "p-dayhand"
                $0.status = "doing"
                $0.isNow = true
                $0.resumeNote = "Section 3: the budget"
            },
            task("Call the accountant") {
                $0.projectId = "p-home"
                $0.dueTime = "14:00"
                $0.labels = ["home"]
                $0.note = "Ask about the VAT return and the new invoice numbering."
                $0.reminders = [.before(30), .at("09:00")]
            },
            task("Review pull request #42") {
                $0.projectId = "p-dayhand"
                $0.dueTime = "09:30"
                $0.checklist = [
                    ChecklistItem(id: "c1", title: "Read the diff", done: true),
                    ChecklistItem(id: "c2", title: "Run the tests"),
                    ChecklistItem(id: "c3", title: "Write the review"),
                ]
            },
            task("Buy milk") { $0.labels = ["home"] },
            // Agent work as `dayhand` and an agent set it: claimed for an hour, two of three criteria met, waiting for
            // the overdue invoice, blocked and with a plan.
            task("Ship the release notes") {
                $0.projectId = "p-dayhand"
                $0.status = "doing"
                $0.labels = ["work"]
                $0.claimedBy = "claude"
                $0.claimExpiresAt = now + 3_600_000
                $0.acceptance = [
                    AcceptanceItem(id: "a1", text: "Every change since 0.2.2 is listed", met: true),
                    AcceptanceItem(id: "a2", text: "Links to the issues work", met: true),
                    AcceptanceItem(id: "a3", text: "Reviewed by Anna"),
                ]
                $0.plan = "Collect the merged pull requests, group them by area, then ask Anna for a review."
                $0.dependsOn = ["demo1", "demo3"]
                $0.blockedReason = "Waiting for Anna to come back on Monday"
            },
            task("Publish the newsletter") {
                $0.status = "done"
                $0.completedAt = now - 1_800_000
                $0.proof = TaskProof(
                    summary: "Sent to 412 readers.",
                    links: [TaskLink(url: "https://example.com/newsletter/42", title: "Archive copy")],
                    checks: [ProofCheck(name: "spell check", result: "pass"), ProofCheck(name: "link check", result: "fail")]
                )
            },
            task("Water the plants") { $0.repeat = RepeatRule(every: .week, weekdays: [3, 7]); $0.projectId = "p-home" },
            task("Morning run") { $0.status = "done"; $0.completedAt = now - 3_600_000; $0.projectId = "p-health" },
            task("Dentist") { $0.dueDate = day(1); $0.dueTime = "10:00"; $0.projectId = "p-health" },
            task("Order business cards") { $0.dueDate = day(4); $0.projectId = "p-bakery" },
            task("Photos for the gallery") {
                $0.dueDate = nil
                $0.projectId = "p-bakery"
                $0.checklist = [ChecklistItem(id: "g1", title: "Croissants"), ChecklistItem(id: "g2", title: "The shop window", done: true)]
            },
            task("Idea for a blog post") { $0.dueDate = nil },
            task("Archive the old posts") { $0.archivedAt = now - 3 * 86_400_000; $0.projectId = "p-blog" },
            task("Old shopping list") { $0.deletedAt = now - 2 * 3_600_000; $0.labels = ["home"] },
            task("Draft of the newsletter") { $0.dueDate = day(-5); $0.deletedAt = now - 26 * 86_400_000 },
        ]
        try await model.repository.apply(Snapshot(
            tasks: tasks, settings: ReminderSettings(timezone: zone, summaryTime: "07:00", reminderMinutes: [0, 15]),
            projects: projects
        ))
        // The last plan health report, as the server would send it.
        try await model.repository.savePlanHealth([
            "at": .of(now), "agentsPaused": false, "overdue": ["count": 1], "dueToday": ["count": 5],
            "inProgress": ["count": 2], "expiredClaims": ["count": 0], "blocked": ["count": 1],
            "awaitingApproval": ["count": 1, "pendingApprovals": 1], "proposals": ["count": 2],
            "completedToday": ["count": 2, "withProof": 1, "withoutProof": 1], "oldestOpen": .null,
        ])
        // Its history as the server last sent it.
        guard let call = tasks.first(where: { $0.title == "Call the accountant" }) else { return }
        let minute: Int64 = 60_000
        try await model.repository.saveHistory(call.id, [
            TaskEvent(taskServerId: call.id, at: now - 6 * minute, actor: "cli", action: "claim"),
            TaskEvent(
                taskServerId: call.id, at: now - 12 * minute, actor: "app", action: "update",
                beforeJson: JSONValue.object(["dueTime": "11:00"]).encoded(), afterJson: JSONValue.object(["dueTime": "14:00"]).encoded()
            ),
            TaskEvent(
                taskServerId: call.id, at: now - 40 * minute, actor: "agent", actorName: "claude", action: "update",
                beforeJson: JSONValue.object(["note": .null]).encoded(),
                afterJson: JSONValue.object(["note": "Ask about the VAT return and the new invoice numbering."]).encoded()
            ),
            TaskEvent(
                taskServerId: call.id, at: now - 3 * 60 * minute, actor: "cli", action: "create",
                afterJson: JSONValue.object(["title": "Call the accountant", "dueDate": .string(day(-1)), "dueTime": "11:00", "isNow": false, "labels": ["home"]]).encoded()
            ),
        ])
        try await model.repository.setLabels(call.id, ["home", "tax"])
    }

    /// Draws [view] at [size] into a PNG at [url]; with [sidebar], that is drawn over the view's open sidebar column, and
    /// in the light appearance the window's title bar and toolbar too (their glass does not draw dark off screen).
    @MainActor
    static func render<V: View>(_ view: V, _ size: CGSize, _ dark: Bool, _ url: URL, sidebar: AnyView? = nil) async throws {
        let (bitmap, column, titleBar) = try await draw(view, size, dark, chrome: sidebar != nil && !dark)
        if let sidebar, let column {
            // Under the title bar, as in the window.
            let below = sidebar.safeAreaInset(edge: .top, spacing: 0) { Color.clear.frame(height: titleBar) }
            let (side, _, _) = try await draw(below, column.size, dark)
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
            side.draw(in: CGRect(x: column.minX, y: bitmap.size.height - column.maxY, width: column.width, height: column.height))
            NSGraphicsContext.restoreGraphicsState()
        }
        guard let png = bitmap.representation(using: .png, properties: [:]) else { throw SnapshotError.noBitmap }
        try png.write(to: url)
    }

    /// [view] drawn off screen at [size], where its sidebar column is (from the top left) while one is open, and the
    /// height of the title bar. With [chrome], the window is the app's (title bar and toolbar over the content) and is
    /// drawn whole.
    @MainActor
    private static func draw<V: View>(
        _ view: V, _ size: CGSize, _ dark: Bool, chrome: Bool = false
    ) async throws -> (NSBitmapImageRep, CGRect?, CGFloat) {
        let hosting = NSHostingView(rootView: view.frame(width: size.width, height: size.height))
        hosting.frame = CGRect(origin: .zero, size: size)
        let style: NSWindow.StyleMask = chrome ? [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView] : [.titled]
        let window = NSWindow(contentRect: hosting.frame, styleMask: style, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        if chrome, #available(macOS 14, *) {
            window.toolbarStyle = .unified
            hosting.sceneBridgingOptions = [.toolbars, .title]
        }
        window.contentView = hosting
        let drawn = chrome ? window.contentView?.superview ?? hosting : hosting
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(nanoseconds: 600_000_000)
        drawn.layoutSubtreeIfNeeded()
        drawn.display()
        guard let bitmap = drawn.bitmapImageRepForCachingDisplay(in: drawn.bounds) else { throw SnapshotError.noBitmap }
        drawn.cacheDisplay(in: drawn.bounds, to: bitmap)
        let column = sidebarColumn(in: drawn).map { rect in
            CGRect(x: rect.minX, y: drawn.isFlipped ? rect.minY : drawn.bounds.height - rect.maxY, width: rect.width, height: rect.height)
        }
        let titleBar = chrome ? drawn.bounds.height - window.contentLayoutRect.maxY : 0
        window.close()
        return (bitmap, column, titleBar)
    }

    @MainActor
    private static func sidebarColumn(in drawn: NSView) -> CGRect? {
        func split(_ view: NSView) -> NSSplitView? { (view as? NSSplitView) ?? view.subviews.lazy.compactMap(split).first }
        guard let split = split(drawn), let column = split.arrangedSubviews.first, !split.isSubviewCollapsed(column) else { return nil }
        return column.convert(column.bounds, to: drawn)
    }

    enum SnapshotError: Error {
        case noBitmap
        /// The main window's layout is wrong (WindowLayoutCheck).
        case layout([String])
    }
}
