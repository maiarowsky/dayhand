import AppKit
import DayhandLocalization
import SwiftUI

/**
 * The main window as macOS lays it out: a titled window whose content runs under the title bar and the toolbar, as
 * the `Window` scene makes it. `ScreenSnapshots` lays it out at a few sizes, with the sidebar open and closed, and
 * fails when the content does not fit the window or quick add sits under the title bar and its window buttons. The
 * window is never shown, so nothing is drawn: SwiftUI draws nothing into an off-screen window with a title bar.
 */
@MainActor
enum WindowLayoutCheck {
    struct Case {
        let name: String
        let size: CGSize
        var sidebar = true
        var dark = false
    }

    /// The default size and the smallest the window gets (DayhandApp), where the status line wraps the most, with the
    /// sidebar open and closed, light and dark.
    static let cases: [Case] = [CGSize(width: 1100, height: 700), CGSize(width: 820, height: 500)].flatMap { size in
        [true, false].flatMap { sidebar in
            [false, true].map { dark in
                Case(
                    name: "window-\(Int(size.width))\(sidebar ? "" : "-no-sidebar")\(dark ? "-dark" : "")",
                    size: size, sidebar: sidebar, dark: dark
                )
            }
        }
    }

    /// What is wrong with the layout in each case (nothing when all is well).
    static func run(_ root: some View) async throws -> [String] {
        var problems: [String] = []
        for check in cases {
            problems += try await layOut(root, check)
        }
        return problems
    }

    static func layOut(_ root: some View, _ check: Case) async throws -> [String] {
        let controller = NSHostingController(rootView: root)
        controller.sizingOptions = []
        if #available(macOS 14, *) { controller.sceneBridgingOptions = [.toolbars, .title] }
        let window = NSWindow(contentViewController: controller)
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: check.dark ? .darkAqua : .aqua)
        window.setContentSize(check.size)
        defer { window.close() }
        try await settle(window)
        if !check.sidebar {
            guard let sidebar = (splitView(in: controller.view)?.delegate as? NSSplitViewController)?.splitViewItems.first else {
                return ["\(check.name): the sidebar could not be closed"]
            }
            sidebar.isCollapsed = true
            try await settle(window)
        }
        return problems(in: window, check)
    }

    /// The content's views stay inside the window, and quick add below the title bar.
    static func problems(in window: NSWindow, _ check: Case) -> [String] {
        guard let content = window.contentView else { return ["\(check.name): no content"] }
        var problems = content.subviews.filter { !content.bounds.insetBy(dx: -0.5, dy: -0.5).contains($0.frame) }.map {
            "\(check.name): the content is \(Int($0.frame.height)) pt tall in a window of \(Int(content.bounds.height)) pt"
        }
        let placeholder = tr("Add a task (try: Pay rent fri 9am)")
        guard let field = textFields(in: content).first(where: { $0.placeholderString == placeholder }) else {
            return problems + ["\(check.name): quick add is missing"]
        }
        // Window coordinates grow upwards: the title bar starts where the content layout rect ends.
        let overlap = field.convert(field.bounds, to: nil).maxY - window.contentLayoutRect.maxY
        if overlap > 0 { problems.append("\(check.name): quick add is \(Int(overlap)) pt under the title bar") }
        return problems
    }

    private static func settle(_ window: NSWindow) async throws {
        for _ in 0..<3 {
            window.contentView?.layoutSubtreeIfNeeded()
            try await Task.sleep(for: .milliseconds(300))
        }
    }

    private static func splitView(in view: NSView) -> NSSplitView? {
        if let split = view as? NSSplitView { return split }
        return view.subviews.lazy.compactMap { splitView(in: $0) }.first
    }

    private static func textFields(in view: NSView) -> [NSTextField] {
        (view as? NSTextField).map { [$0] } ?? view.subviews.flatMap { textFields(in: $0) }
    }
}
