import AppKit
import DayhandCore
import SwiftUI

/**
 * Renders the main screens to PNG files from synthetic tasks, without a display and without screen recording
 * permission: each view is drawn into an off-screen window (`NSHostingView.cacheDisplay`). The model runs on a
 * database in memory, with the sign-in in memory and no server, so nothing on the Mac is read or changed.
 *
 *     swift run DayhandSnapshots <output folder>
 */
public enum ScreenSnapshots {
    @MainActor
    public static func run(outputDirectory: URL) {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        UserDefaults.standard.register(defaults: [AppModel.Keys.useOffline: true])
        AppModel.makeEnvironment = {
            // A failure here is a bug in the tool; it reports and stops.
            AppEnvironment(
                database: try! AppDatabase.inMemory(),
                credentials: MemoryCredentialStore(),
                notifications: false,
                defaults: .standard
            )
        }
        Task { @MainActor in
            do {
                try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
                try await renderAll(to: outputDirectory)
                try removePreferences()
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

        for dark in [false, true] {
            let suffix = dark ? "-dark" : ""
            try await render(MainWindow().environmentObject(model), CGSize(width: 1040, height: 680), dark, folder.appendingPathComponent("today\(suffix).png"))
        }
        try await render(TodayView().environmentObject(model), CGSize(width: 400, height: 680), false, folder.appendingPathComponent("today-list.png"))
        try await render(MenuBarView().environmentObject(model), CGSize(width: 340, height: 430), false, folder.appendingPathComponent("menu-bar.png"))
        try await render(
            QuickAddView(line: "Call the accountant fri 2pm", onDone: {}).environmentObject(model),
            CGSize(width: 560, height: 96), false, folder.appendingPathComponent("quick-add.png")
        )
        model.connectPrefill = PairingInput.parseLink("dayhand://pair?url=http%3A%2F%2F127.0.0.1%3A3211&code=E6M8-FE02-XSNT")
        try await render(ConnectView().environmentObject(model), CGSize(width: 520, height: 400), false, folder.appendingPathComponent("connect.png"))
        try await render(SettingsView().environmentObject(model), CGSize(width: 520, height: 360), false, folder.appendingPathComponent("settings.png"))
    }

    /// The shortcut recorder stores its default in the tool's preferences; the tool leaves none behind. macOS keeps
    /// an empty file for a removed domain, so that goes too.
    static func removePreferences() throws {
        let domain = ProcessInfo.processInfo.processName
        UserDefaults.standard.removePersistentDomain(forName: domain)
        CFPreferencesAppSynchronize(domain as CFString)
        let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Preferences/\(domain).plist")
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
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
        ]
        try await model.repository.apply(Snapshot(
            tasks: tasks, settings: ReminderSettings(timezone: zone, summaryTime: "07:00", reminderMinutes: [0, 15])
        ))
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
