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
                .frame(minWidth: 720, minHeight: 460)
                // Drawn again in a new language, with dates in its locale.
                .id(model.language)
                .environment(\.locale, Localization.current.locale)
        }
        .defaultSize(width: 960, height: 640)
        .commands {
            CommandGroup(after: .appInfo) {
                Button(tr("Check for Updates…")) {
                    model.showMainWindow()
                    updater.checkForUpdates()
                }
            }
            CommandGroup(replacing: .newItem) {
                Button(tr("New Task…")) { QuickAddPanel.shared.show() }
                    .keyboardShortcut("n")
            }
            CommandMenu(tr("Task")) {
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

    func show() {
        let panel = panel ?? makePanel()
        self.panel = panel
        panel.contentView = NSHostingView(rootView: QuickAddView(onDone: { [weak self] in self?.close() }).environmentObject(AppModel.shared))
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
