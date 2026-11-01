import AppKit
import Combine
import Foundation

/// AppKit, rather than a scene's phase: closing/minimizing the last window leaves the menu-bar app running.
@MainActor
final class SyncActivity {
    private var observations = Set<AnyCancellable>()
    private var eventMonitor: Any?

    init(model: AppModel) {
        let names: [Notification.Name] = [
            NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification,
            NSApplication.didHideNotification, NSApplication.didUnhideNotification,
            NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification,
            NSWindow.didMiniaturizeNotification, NSWindow.didDeminiaturizeNotification,
            NSWindow.didChangeOcclusionStateNotification, NSWindow.willCloseNotification,
        ]
        for name in names {
            NotificationCenter.default.publisher(for: name).sink { [weak model] _ in
                // Recheck after AppKit has completed a close/minimize, not inside willClose.
                Task { @MainActor in Self.update(model) }
            }.store(in: &observations)
        }
        eventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown, .scrollWheel]) { [weak model] event in
            MainActor.assumeIsolated { model?.syncUserActivity() }
            return event
        }
        Self.update(model)
    }

    private static func update(_ model: AppModel?) {
        // Ignore the status item's own window: it stays visible even after every content window closes.
        let visible = NSApp.windows.contains {
            $0.canBecomeKey && $0.isVisible && !$0.isMiniaturized && $0.occlusionState.contains(.visible)
        }
        model?.setSyncActive(NSApp.isActive && !NSApp.isHidden && visible)
    }

    func stop() {
        observations.removeAll()
        if let eventMonitor { NSEvent.removeMonitor(eventMonitor) }
        eventMonitor = nil
    }
}
