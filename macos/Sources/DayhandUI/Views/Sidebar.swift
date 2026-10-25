import DayhandCore
import DayhandLocalization
import SwiftUI

/**
 * The left column: the inbox, Today, every task and those without a project, the projects (hidden while the server has
 * none), the labels, the done and archived tasks and the trash, each with the number of its open tasks, red while
 * some are overdue. A task dragged onto a project, No Project or Today goes there. The update button sits in the
 * bottom corner while a newer version is known.
 */
struct Sidebar: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        List(selection: Binding(get: { model.place }, set: { if let place = $0 { model.show(place) } })) {
            Section {
                PlaceRow(place: .inbox, icon: "tray", title: tr("Inbox"), count: inboxCount)
                PlaceRow(place: .today, icon: "sun.max", title: tr("Today"),
                         count: SidebarCounts.Count(open: model.sections.openCount, overdue: model.sections.overdue.count))
                PlaceRow(place: .all, icon: "list.bullet", title: tr("All Tasks"), count: model.counts.all)
                if model.showsProjects {
                    PlaceRow(place: .noProject, icon: "circle.dashed", title: tr("No Project"), count: model.counts.noProject)
                }
            }
            if model.showsProjects { projectsSection }
            if !model.counts.labelNames.isEmpty { labelsSection }
            Section {
                PlaceRow(place: .done, icon: "checkmark.circle", title: tr("Done and Archived"))
                PlaceRow(place: .trash, icon: "trash", title: tr("Trash"))
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom, spacing: 0) { UpdateCorner() }
    }

    /// Approval requests and proposals waiting for the owner, from the last plan health report.
    private var inboxCount: SidebarCounts.Count {
        SidebarCounts.Count(open: (model.health?.pendingApprovals ?? 0) + (model.health?.proposals ?? 0))
    }

    private var projectsSection: some View {
        Section {
            if model.projectsExpanded {
                ForEach(model.activeProjects) { project in
                    ProjectRow(project: project).tag(Place.project(project.localId))
                }
                .onMove { model.moveProjects(from: $0, to: $1) }
                if model.activeProjects.isEmpty {
                    Button(tr("Add a project…")) { model.projectEditor = ProjectEditorRequest() }
                        .buttonStyle(.link)
                }
                if !model.archivedProjects.isEmpty {
                    PlaceRow(place: .archivedProjects, icon: "archivebox",
                             title: tr("Archived (\(model.archivedProjects.count))"))
                }
            }
        } header: {
            SectionHeader(title: tr("Projects"), expanded: $model.projectsExpanded) {
                Button { model.projectEditor = ProjectEditorRequest() } label: { Image(systemName: "plus") }
                    .buttonStyle(.borderless)
                    .help(tr("New project (⌥⌘N)"))
                    .accessibilityLabel(tr("New Project…"))
            }
        }
    }

    private var labelsSection: some View {
        Section {
            if model.labelsExpanded {
                ForEach(model.counts.labelNames, id: \.self) { label in
                    PlaceRow(place: .label(label), icon: "number", title: label, count: model.counts.label(label))
                }
            }
        } header: {
            SectionHeader(title: tr("Labels"), expanded: $model.labelsExpanded) { EmptyView() }
        }
    }
}

/// A section title that folds its section (`Section(isExpanded:)` needs macOS 14), with room for a button.
struct SectionHeader<Trailing: View>: View {
    let title: String
    @Binding var expanded: Bool
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 4) {
            Button { expanded.toggle() } label: {
                HStack(spacing: 4) {
                    Text(title)
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                }
            }
            .buttonStyle(.plain)
            .accessibilityHint(expanded ? tr("Hides the section") : tr("Shows the section"))
            Spacer()
            trailing()
        }
        // In line with the numbers of the rows below.
        .padding(.trailing, 10)
    }
}

/// A place of the sidebar: a line icon, its name and the number of its open tasks.
struct PlaceRow: View {
    @EnvironmentObject private var model: AppModel
    let place: Place
    let icon: String
    let title: String
    var count: SidebarCounts.Count?
    @State private var targeted = false

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .frame(width: 18)
                .foregroundStyle(.secondary)
            Text(title).lineLimit(1)
            Spacer(minLength: 4)
            if let count { CountBadge(count: count) }
        }
        .dropTarget(place, targeted: $targeted)
        .tag(place)
    }
}

/// A project in the sidebar, with its menu.
struct ProjectRow: View {
    @EnvironmentObject private var model: AppModel
    let project: Project
    @State private var targeted = false

    var body: some View {
        HStack(spacing: 8) {
            ProjectMark(project: project)
                .frame(width: 18)
            Text(project.name).lineLimit(1)
            Spacer(minLength: 4)
            CountBadge(count: model.counts.project(project.localId))
        }
        .dropTarget(.project(project.localId), targeted: $targeted)
        .contextMenu { ProjectMenu(project: project) }
        .accessibilityElement(children: .combine)
    }
}

/// The moves of a project: edit, order, archive, delete.
struct ProjectMenu: View {
    @EnvironmentObject private var model: AppModel
    let project: Project

    var body: some View {
        Button(tr("Edit…")) { model.projectEditor = ProjectEditorRequest(project: project) }
        if !project.isArchived {
            Button(tr("Move Up")) { model.moveProject(project.localId, by: -1) }
                .disabled(model.activeProjects.first?.localId == project.localId)
            Button(tr("Move Down")) { model.moveProject(project.localId, by: 1) }
                .disabled(model.activeProjects.last?.localId == project.localId)
            Divider()
            Button(tr("Archive")) { model.setArchived(project.localId, true) }
        } else {
            Button(tr("Restore")) { model.setArchived(project.localId, false) }
        }
        Button(tr("Delete…")) { model.deletingProject = ProjectPick(id: project.localId) }
    }
}

/// The number of open tasks, red with "n overdue" for VoiceOver while some are overdue; nothing at zero.
struct CountBadge: View {
    let count: SidebarCounts.Count

    var body: some View {
        if count.open > 0 {
            Text("\(count.open)")
                .font(.callout.monospacedDigit())
                .foregroundStyle(count.overdue > 0 ? Color.overdue : .secondary)
                .accessibilityLabel(count.overdue > 0 ? "\(tr("\(count.open) open")), \(tr("\(count.overdue) overdue"))" : tr("\(count.open) open"))
        }
    }
}

/// What a dragged task carries: its `localId` behind a prefix, so text dragged from other apps is not taken for one.
enum TaskDrag {
    static let prefix = "dayhand-task:"

    static func payload(_ localId: String) -> String { prefix + localId }

    static func localId(_ payload: String) -> String? {
        payload.hasPrefix(prefix) ? String(payload.dropFirst(prefix.count)) : nil
    }
}

extension View {
    /// Takes a task dropped on [place] (`AppModel.drop`), lighting the row while one is over it.
    func dropTarget(_ place: Place, targeted: Binding<Bool>) -> some View {
        modifier(DropTarget(place: place, targeted: targeted))
    }
}

private struct DropTarget: ViewModifier {
    @EnvironmentObject private var model: AppModel
    let place: Place
    @Binding var targeted: Bool

    func body(content: Content) -> some View {
        content
            .padding(.vertical, 1)
            .background(
                RoundedRectangle(cornerRadius: 5).strokeBorder(Color.accentColor, lineWidth: targeted ? 1.5 : 0)
            )
            .dropDestination(for: String.self) { items, _ in
                guard let id = items.lazy.compactMap(TaskDrag.localId).first else { return false }
                return model.drop(id, on: place)
            } isTargeted: { targeted = $0 && accepts }
    }

    private var accepts: Bool {
        switch place {
        case .project, .noProject, .today: return true
        default: return false
        }
    }
}
