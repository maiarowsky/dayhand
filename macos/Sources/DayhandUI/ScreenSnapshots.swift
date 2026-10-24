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
        try await Task.sleep(for: .milliseconds(800))
        model.recompute()
        model.selection = model.sections.today.first { $0.title == "Call the accountant" }?.localId

        let updater = Updater.shared
        for dark in [false, true] {
            let suffix = dark ? "-dark" : ""
            try await render(MainWindow().environmentObject(model).environmentObject(updater), CGSize(width: 960, height: 680), dark, folder.appendingPathComponent("today\(suffix).png"))
        }
        try await render(MainWindow().environmentObject(model).environmentObject(updater), CGSize(width: 720, height: 680), false, folder.appendingPathComponent("today-compact.png"))
        try await render(TodayView().environmentObject(model), CGSize(width: 400, height: 680), false, folder.appendingPathComponent("today-list.png"))
        for dark in [false, true] {
            try await render(
                Sidebar().environmentObject(model).environmentObject(updater), CGSize(width: 380, height: 680), dark,
                folder.appendingPathComponent("sidebar-update\(dark ? "-dark" : "").png")
            )
        }
        // The details from top to bottom, the change history included.
        if let task = model.selection.flatMap(model.task) {
            try await render(TaskDetailView(task: task).environmentObject(model), CGSize(width: 560, height: 1500), false, folder.appendingPathComponent("details.png"))
        }
        if let task = model.sections.today.first(where: { $0.title == "Buy milk" }) {
            try await render(TaskDetailView(task: task).environmentObject(model), CGSize(width: 560, height: 1500), false, folder.appendingPathComponent("history-offline-empty.png"))
        }
        try await render(TrashView().environmentObject(model), CGSize(width: 400, height: 680), false, folder.appendingPathComponent("trash-list.png"))
        model.show(.trash)
        model.selection = model.trash.first?.localId
        for dark in [false, true] {
            try await render(MainWindow().environmentObject(model).environmentObject(updater), CGSize(width: 960, height: 680), dark, folder.appendingPathComponent("trash\(dark ? "-dark" : "").png"))
        }
        try await render(MainWindow().environmentObject(model).environmentObject(updater), CGSize(width: 720, height: 680), false, folder.appendingPathComponent("trash-compact.png"))
        model.show(.today)
        try await render(MenuBarView().environmentObject(model), CGSize(width: 340, height: 430), false, folder.appendingPathComponent("menu-bar.png"))
        try await render(
            QuickAddView(line: "Call the accountant fri 2pm", onDone: {}).environmentObject(model),
            CGSize(width: 560, height: 96), false, folder.appendingPathComponent("quick-add.png")
        )
        model.connectPrefill = PairingInput.parseLink("dayhand://pair?url=http%3A%2F%2F127.0.0.1%3A3211&code=E6M8-FE02-XSNT")
        try await render(ConnectView().environmentObject(model), CGSize(width: 520, height: 400), false, folder.appendingPathComponent("connect.png"))
        try await render(SettingsView().environmentObject(model).environmentObject(updater), CGSize(width: 520, height: 360), false, folder.appendingPathComponent("settings.png"))
        try await renderUpdates(to: folder)
    }

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
            var t = RemoteTask(id: "demo\(ref)", title: title, dueDate: today, createdAt: now - Int64(ref) * 60_000, updatedAt: now - 1000)
            change(&t)
            return t
        }
        let tasks = [
            task("Send the invoice to Anna") { $0.dueDate = day(-2); $0.labels = ["work"] },
            task("Write the project brief") {
                $0.status = "doing"
                $0.isNow = true
                $0.resumeNote = "Section 3: the budget"
            },
            task("Call the accountant") {
                $0.dueTime = "14:00"
                $0.labels = ["home"]
                $0.note = "Ask about the VAT return and the new invoice numbering."
                $0.reminders = [.before(30), .at("09:00")]
            },
            task("Review pull request #42") {
                $0.dueTime = "09:30"
                $0.checklist = [
                    ChecklistItem(id: "c1", title: "Read the diff", done: true),
                    ChecklistItem(id: "c2", title: "Run the tests"),
                    ChecklistItem(id: "c3", title: "Write the review"),
                ]
            },
            task("Buy milk") { $0.labels = ["home"] },
            task("Water the plants") { $0.repeat = RepeatRule(every: .week, weekdays: [3, 7]) },
            task("Morning run") { $0.status = "done"; $0.completedAt = now - 3_600_000 },
            task("Dentist") { $0.dueDate = day(1); $0.dueTime = "10:00" },
            task("Old shopping list") { $0.deletedAt = now - 2 * 3_600_000; $0.labels = ["home"] },
            task("Draft of the newsletter") { $0.dueDate = day(-5); $0.deletedAt = now - 26 * 86_400_000 },
        ]
        try await model.repository.apply(Snapshot(
            tasks: tasks, settings: ReminderSettings(timezone: zone, summaryTime: "07:00", reminderMinutes: [0, 15])
        ))
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

    @MainActor
    static func render<V: View>(_ view: V, _ size: CGSize, _ dark: Bool, _ url: URL) async throws {
        let hosting = NSHostingView(rootView: view.frame(width: size.width, height: size.height))
        hosting.frame = CGRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: hosting.frame, styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = hosting
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(600))
        hosting.layoutSubtreeIfNeeded()
        hosting.display()
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { throw SnapshotError.noBitmap }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        guard let png = bitmap.representation(using: .png, properties: [:]) else { throw SnapshotError.noBitmap }
        try png.write(to: url)
        window.close()
    }

    enum SnapshotError: Error { case noBitmap }
}
