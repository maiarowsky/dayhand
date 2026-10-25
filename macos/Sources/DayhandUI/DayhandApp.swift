import AppKit
import DayhandCore
import DayhandLocalization
import DayhandUpdates
import KeyboardShortcuts
import SwiftUI

extension KeyboardShortcuts.Name {
    /// Quick add from anywhere; ⌃⌥N until the user records another in Settings.
    static let quickAdd = Self("quickAdd", initial: quickAddInitial)
    static let quickAddInitial = KeyboardShortcuts.Shortcut(.n, modifiers: [.control, .option])
}

public struct DayhandApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = AppModel.shared
    @StateObject private var updater = Updater.shared

    public init() {}

    public var body: some Scene {
        Window("Dayhand", id: "main") {
            MainWindow()
                .environmentObject(model)
                .environmentObject(updater)
                .frame(minWidth: 820, minHeight: 500)
                // Drawn again in a new language, with dates in its locale.
                .id(model.language)
                .environment(\.locale, Localization.current.locale)
        }
        .defaultSize(width: 1100, height: 700)
        .commands {
            CommandGroup(after: .appInfo) {
                Button(tr("Check for Updates…")) {
                    model.showMainWindow()
                    updater.checkForUpdates()
                }
            }
            CommandGroup(replacing: .newItem) {
                Button(tr("New Task…")) { QuickAddPanel.shared.show(place: model.place) }
                    .keyboardShortcut("n")
            }
            SidebarCommands()
            CommandMenu(tr("Go")) { GoCommands().environmentObject(model) }
            CommandMenu(tr("Task")) {
                Button(tr("Move to Project…")) {
                    if let id = model.selection { model.movingTask = TaskPick(id: id) }
                }
                .keyboardShortcut("m", modifiers: [.command, .shift])
                .disabled(model.selection == nil || !model.showsProjects)
                Button(tr("New Project…")) {
                    model.showMainWindow()
                    model.projectEditor = ProjectEditorRequest()
                }
                .keyboardShortcut("n", modifiers: [.command, .option])
                .disabled(!model.showsProjects)
                Divider()
                Button(tr("Sync Now")) { Task { await model.syncNow() } }
                    .keyboardShortcut("r")
                    .disabled(model.credential == nil)
            }
        }

        MenuBarExtra {
            MenuBarView()
                .environmentObject(model)
                .id(model.language)
                .environment(\.locale, Localization.current.locale)
        } label: {
            MenuBarLabel(sections: model.sections)
        }
        .menuBarExtraStyle(.window)

        Settings {
            SettingsView()
                .environmentObject(model)
                .environmentObject(updater)
                .id(model.language)
                .environment(\.locale, Localization.current.locale)
        }
    }
}

/// The Go menu: ⌘1 Today, ⌘2 All Tasks, ⌘3 No Project, ⌘4 to ⌘9 the first six projects, and the other places.
struct GoCommands: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        go(.today, tr("Today"), key: "1")
        go(.all, tr("All Tasks"), key: "2")
        if model.showsProjects {
            go(.noProject, tr("No Project"), key: "3")
            ForEach(Array(model.shortcutProjects.enumerated()), id: \.element.localId) { index, project in
                go(.project(project.localId), project.name, key: KeyEquivalent(Character(String(index + 4))))
            }
        }
        Divider()
        go(.inbox, tr("Inbox"))
        go(.done, tr("Done and Archived"))
        go(.trash, tr("Trash"))
    }

    @ViewBuilder
    private func go(_ place: Place, _ title: String, key: KeyEquivalent? = nil) -> some View {
        let button = Button(title) {
            model.showMainWindow()
            model.show(place)
        }
        if let key { button.keyboardShortcut(key, modifiers: .command) } else { button }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        MainActor.assumeIsolated {
            _ = AppModel.shared
            _ = Updater.shared
            KeyboardShortcuts.onKeyUp(for: .quickAdd) { QuickAddPanel.shared.toggle() }
        }
    }

    /// `dayhand://pair?…` and `helm://pair?…` links (the QR code of `dayhand pair`).
    func application(_ application: NSApplication, open urls: [URL]) {
        MainActor.assumeIsolated {
            for url in urls { AppModel.shared.open(url) }
        }
    }

    /// Closing the window keeps Dayhand in the menu bar, with its reminders and the quick add shortcut.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

/// The menu bar icon: how many open tasks today has, and a warning when some are overdue.
struct MenuBarLabel: View {
    let sections: TodaySections

    var body: some View {
        let open = sections.openCount
        HStack(spacing: 3) {
            Image(systemName: sections.overdue.isEmpty ? "checklist" : "exclamationmark.circle")
            if open > 0 { Text("\(open)") }
        }
        .accessibilityLabel(open == 0 ? tr("Dayhand, nothing left today") : tr("Dayhand, \(open) open today"))
    }
}

/**
 * Quick add over every app, Spotlight-style: a floating panel with one field, opened by the global shortcut. It
 * takes the keyboard without bringing the main window forward, and closes on Return, Escape or a click elsewhere.
 */
@MainActor
final class QuickAddPanel {
    static let shared = QuickAddPanel()

    private var panel: NSPanel?

    func toggle() {
        if let panel, panel.isVisible { close() } else { show() }
    }

    /// Opens the panel; a task typed without a day or project takes them from [place] (Today from other apps).
    func show(place: Place = .today) {
        let panel = panel ?? makePanel()
        self.panel = panel
        let view = QuickAddView(place: place, onDone: { [weak self] in self?.close() })
        panel.contentView = NSHostingView(rootView: view.environmentObject(AppModel.shared))
        panel.center()
        if let frame = panel.screen?.visibleFrame {
            panel.setFrameOrigin(NSPoint(x: frame.midX - panel.frame.width / 2, y: frame.minY + frame.height * 0.66))
        }
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
    }

    func close() {
        panel?.orderOut(nil)
    }

    private func makePanel() -> NSPanel {
        let panel = FloatingPanel(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 120),
            styleMask: [.titled, .fullSizeContentView, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = true
        panel.isReleasedWhenClosed = false
        panel.standardWindowButton(.closeButton)?.isHidden = true
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        panel.standardWindowButton(.zoomButton)?.isHidden = true
        return panel
    }
}

private final class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { true }

    override func resignKey() {
        super.resignKey()
        orderOut(nil)
    }

    override func cancelOperation(_ sender: Any?) {
        orderOut(nil)
    }
}
