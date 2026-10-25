import AppKit
import DayhandCore
import DayhandLocalization
import SwiftUI

/**
 * The main window: the sidebar on the left (it folds with ⌃⌘S or the toolbar button), and on the right the place
 * picked in it, with the selected task's details in a panel along the bottom. The toolbar holds search and + Task.
 */
struct MainWindow: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        NavigationSplitView {
            Sidebar()
                .navigationSplitViewColumnWidth(min: 200, ideal: 230, max: 320)
        } detail: {
            MainArea()
                .navigationTitle(PlaceText.title(model.place, model: model))
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button { QuickAddPanel.shared.show(place: model.place) } label: { Label(tr("Task"), systemImage: "plus") }
                            .labelStyle(.titleAndIcon)
                            .help(tr("New task (⌘N, or the quick add shortcut from any app)"))
                    }
                }
                .searchable(text: $model.search, placement: .toolbar, prompt: Text(tr("Search")))
        }
        .background(HiddenWindowTitle())
        .sheet(isPresented: $model.showConnect) {
            ConnectView().environmentObject(model)
        }
        .sheet(item: $model.projectEditor) { request in
            ProjectEditor(project: request.project).environmentObject(model)
        }
        .sheet(item: $model.movingTask) { pick in
            ProjectPicker(taskId: pick.id).environmentObject(model)
        }
        .sheet(item: $model.deletingProject) { pick in
            DeleteProjectSheet(projectId: pick.id).environmentObject(model)
        }
        .alert(Text(verbatim: "Dayhand"), isPresented: Binding(get: { model.alert != nil }, set: { if !$0 { model.alert = nil } })) {
            Button(tr("OK")) { model.alert = nil }
        } message: {
            Text(model.alert ?? "")
        }
        .onAppear { model.openMainWindow = { openWindow(id: "main") } }
    }
}

/// The right side: the connection line, the place, and the selected task's panel along the bottom.
struct MainArea: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                StatusLine()
                PlaceContent()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                if let id = model.selection, let task = model.task(id) {
                    TaskPanel(task: task, available: geometry.size.height)
                        .id(task.localId)
                        .transition(.move(edge: .bottom))
                }
            }
        }
        .background(Color.canvas)
    }
}

/// The place picked in the sidebar.
struct PlaceContent: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        switch model.place {
        case .inbox: InboxPlace()
        case .today: TodayView()
        case .all, .noProject, .project, .label: TaskListView()
        case .archivedProjects: ArchivedProjectsView()
        case .done: DoneView()
        case .trash: TrashView()
        }
    }
}

/// The names and subtitles of the places.
@MainActor
enum PlaceText {
    static func title(_ place: Place, model: AppModel) -> String {
        switch place {
        case .inbox: return tr("Inbox")
        case .today: return tr("Today")
        case .all: return tr("All Tasks")
        case .noProject: return tr("No Project")
        case .project(let id): return model.project(id)?.name ?? tr("Project")
        case .label(let label): return "#\(label)"
        case .archivedProjects: return tr("Archived Projects")
        case .done: return tr("Done and Archived")
        case .trash: return tr("Trash")
        }
    }
}

/// The big title of a place, with a line under it and room on the right.
struct PlaceHeader<Mark: View, Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var mark: () -> Mark
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .center, spacing: 8) {
                    mark()
                    Text(title).font(.system(size: 26, weight: .bold)).lineLimit(1)
                }
                if let subtitle {
                    Text(subtitle).font(.callout).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 14)
        .padding(.bottom, 8)
    }
}

extension PlaceHeader where Mark == EmptyView, Trailing == EmptyView {
    init(title: String, subtitle: String? = nil) {
        self.init(title: title, subtitle: subtitle, mark: { EmptyView() }, trailing: { EmptyView() })
    }
}

/// The spacing the main area keeps, so lists, cards and the panel line up.
enum Metrics {
    static let gutter: CGFloat = 20
    static let radius: CGFloat = 10
}

extension NSColor {
    /// The background of the main area, a shade off the cards so they stand out in both appearances.
    static let dayhandCanvas = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(srgbRed: 0.118, green: 0.118, blue: 0.125, alpha: 1)
            : NSColor(srgbRed: 0.957, green: 0.953, blue: 0.945, alpha: 1)
    }

    /// A card or the panel on the canvas.
    static let dayhandCard = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(srgbRed: 0.173, green: 0.173, blue: 0.180, alpha: 1)
            : .white
    }
}

extension Color {
    static let canvas = Color(nsColor: .dayhandCanvas)
    static let card = Color(nsColor: .dayhandCard)
}

/// The inbox: the approval requests and proposals waiting for the owner, read-only.
struct InboxPlace: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            PlaceHeader(title: tr("Inbox"), subtitle: tr("Read-only on this Mac. Decide on the phone, or with dayhand approvals and dayhand proposals."))
            if model.credential == nil {
                PlaceEmpty(icon: "tray", text: tr("Connect a server to see the approval requests and proposals waiting for you."))
            } else {
                AgentInboxView(embedded: true)
            }
        }
    }
}

/// A place with nothing in it: a line icon and a sentence.
struct PlaceEmpty: View {
    let icon: String
    let text: String

    var body: some View {
        VStack(spacing: 10) {
            Spacer()
            Image(systemName: icon).font(.system(size: 30, weight: .light)).foregroundStyle(.secondary)
            Text(text).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 360)
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(Metrics.gutter)
    }
}

/// Hides the window's title text: each place shows its own big title.
private struct HiddenWindowTitle: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { TitleHider() }
    func updateNSView(_ nsView: NSView, context: Context) {}

    private final class TitleHider: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            window?.titleVisibility = .hidden
        }
    }
}
