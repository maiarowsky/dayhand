import DayhandCore
import DayhandLocalization
import SwiftUI

/**
 * Every task, those without a project, a project's or a label's, in sections: overdue, today, later (with the day),
 * no day and the latest done (folded). Quick add at the top adds to the list's project.
 */
struct TaskListView: View {
    @EnvironmentObject private var model: AppModel
    @State private var showDone = false

    var body: some View {
        let s = model.list
        VStack(spacing: 0) {
            header
            if takesTasks {
                InlineQuickAdd()
                    .padding(.horizontal, Metrics.gutter)
                    .padding(.vertical, 8)
            }
            if s.isEmpty {
                PlaceEmpty(icon: "checklist", text: model.isSearching ? tr("No task matches the search.") : emptyText)
            } else {
                List(selection: $model.selection) {
                    if !s.overdue.isEmpty {
                        Section {
                            rows(s.overdue, today: s.date, overdue: true)
                        } header: {
                            Text(tr("Overdue (\(s.overdue.count))")).foregroundStyle(Color.overdue)
                        }
                    }
                    if !s.today.isEmpty { Section(tr("Today")) { rows(s.today, today: s.date, showsDay: false) } }
                    if !s.later.isEmpty { Section(tr("Later")) { rows(s.later, today: s.date) } }
                    if !s.noDay.isEmpty { Section(tr("No Day")) { rows(s.noDay, today: s.date) } }
                    if s.doneCount > 0 {
                        Section {
                            if showDone { rows(s.done, today: s.date) }
                        } header: {
                            FoldHeader(title: tr("Done (\(s.doneCount))"), open: $showDone,
                                       hint: showDone ? tr("Hides the done tasks") : tr("Shows the done tasks"))
                        }
                    }
                }
                .cardList()
            }
        }
    }

    private func rows(_ tasks: [TaskItem], today: String, overdue: Bool = false, showsDay: Bool = true) -> some View {
        ForEach(tasks) { task in
            TaskRow(task: task, today: today, overdue: overdue, showsDay: showsDay).tag(task.localId)
        }
    }

    @ViewBuilder private var header: some View {
        let title = PlaceText.title(model.place, model: model)
        let subtitle = Self.subtitle(model.list)
        if case .project(let id) = model.place, let project = model.project(id) {
            PlaceHeader(title: title, subtitle: project.isArchived ? Formatting.pair(tr("Archived project"), subtitle) : subtitle) {
                ProjectMark(project: project, size: 12)
            } trailing: {
                Menu { ProjectMenu(project: project) } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .accessibilityLabel(tr("Project actions"))
            }
        } else {
            PlaceHeader(title: title, subtitle: subtitle)
        }
    }

    /// An archived project's list takes no new tasks, so it has no quick add.
    private var takesTasks: Bool {
        guard case .project(let id) = model.place else { return true }
        return model.project(id)?.isArchived != true
    }

    private var emptyText: String {
        switch model.place {
        case .project: return tr("No tasks in this project yet. Add one above, or drag a task onto it in the sidebar.")
        case .noProject: return tr("Every task is in a project.")
        default: return tr("No tasks here yet.")
        }
    }

    /// "5 open · 2 overdue", "5 open", or "Nothing open".
    static func subtitle(_ s: TaskListSections) -> String {
        guard s.openCount > 0 else { return tr("Nothing open") }
        return s.overdue.isEmpty ? tr("\(s.openCount) open") : Formatting.pair(tr("\(s.openCount) open"), tr("\(s.overdue.count) overdue"))
    }
}

/// The done tasks, the latest first, and the archived ones, each with a way back.
struct DoneView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        let lists = model.doneAndArchived
        let today = model.today
        VStack(spacing: 0) {
            PlaceHeader(title: tr("Done and Archived"), subtitle: tr("The latest \(TaskListSections.doneLimit) of each"))
            if lists.done.isEmpty && lists.archived.isEmpty {
                PlaceEmpty(icon: "checkmark.circle", text: model.isSearching ? tr("No task matches the search.") : tr("Done and archived tasks show here."))
            } else {
                List(selection: $model.selection) {
                    if !lists.done.isEmpty {
                        Section(tr("Done")) {
                            ForEach(lists.done) { TaskRow(task: $0, today: today).tag($0.localId) }
                        }
                    }
                    if !lists.archived.isEmpty {
                        Section(tr("Archived Tasks")) {
                            ForEach(lists.archived) { task in
                                HStack {
                                    TaskRow(task: task, today: today)
                                    Button(tr("Unarchive")) { model.restore(task.localId) }
                                        .buttonStyle(.borderless)
                                        .controlSize(.small)
                                }
                                .tag(task.localId)
                            }
                        }
                    }
                }
                .cardList()
            }
        }
    }
}

/// The archived projects: each opens its tasks, and Restore brings it back to the sidebar.
struct ArchivedProjectsView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            PlaceHeader(title: tr("Archived Projects"), subtitle: tr("They take no new tasks; their tasks stay in them."))
            if model.archivedProjects.isEmpty {
                PlaceEmpty(icon: "archivebox", text: tr("No archived projects."))
            } else {
                List {
                    ForEach(model.archivedProjects) { project in
                        HStack(spacing: 8) {
                            ProjectMark(project: project)
                            Button(project.name) { model.show(.project(project.localId)) }
                                .buttonStyle(.plain)
                            Spacer()
                            Text(tr("\(model.counts.project(project.localId).open) open"))
                                .font(.callout)
                                .foregroundStyle(.secondary)
                            Button(tr("Restore")) { model.setArchived(project.localId, false) }
                                .buttonStyle(.borderless)
                                .controlSize(.small)
                        }
                        .padding(.vertical, 3)
                        .contextMenu { ProjectMenu(project: project) }
                    }
                }
                .cardList()
            }
        }
    }
}
