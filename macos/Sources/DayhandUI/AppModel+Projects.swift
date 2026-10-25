import DayhandCore
import DayhandLocalization
import Foundation

/// The project editor sheet: a new project, or one to edit.
struct ProjectEditorRequest: Identifiable, Equatable {
    let id = UUID()
    var project: Project?
}

/// A task or a project a sheet or a dialog is about, by `localId`.
struct TaskPick: Identifiable, Equatable { let id: String }
struct ProjectPick: Identifiable, Equatable { let id: String }

/// The projects of the sidebar, the lists it opens, and the changes made from them (backend 0.13.0).
extension AppModel {
    /// A server without projects (0.12.x) hides them; before the first snapshot, and without a server, they show.
    var showsProjects: Bool { projectSupport != .unsupported }

    var projectIds: Set<String> { Set(projects.map(\.localId)) }

    /// The projects that take tasks, in the sidebar's order.
    var activeProjects: [Project] { projects.filter { !$0.isArchived } }

    var archivedProjects: [Project] { projects.filter(\.isArchived) }

    func project(_ localId: String?) -> Project? {
        guard let localId else { return nil }
        return projects.first { $0.localId == localId }
    }

    /// The task's project when this Mac has it and the server has projects.
    func projectOf(_ task: TaskItem) -> Project? {
        showsProjects ? project(task.projectLocalId) : nil
    }

    /// The project to name on a task's row or card: none inside that project's own place, where it goes without saying.
    func projectLine(_ task: TaskItem) -> Project? {
        projectOf(task).flatMap { place == .project($0.localId) ? nil : $0 }
    }

    /// Whether a task added in the place lands in it: not in an archived project's place, which takes no new tasks.
    var placeTakesTasks: Bool {
        guard case .project(let id) = place else { return true }
        return project(id)?.isArchived != true
    }

    /// The first six projects, for ⌘4 to ⌘9.
    var shortcutProjects: [Project] { Array(activeProjects.prefix(Self.projectShortcuts)) }

    static let projectShortcuts = 6

    /// Whether something besides spaces is typed in the search field, so the lists may hide tasks.
    var isSearching: Bool { !searchQuery.isEmpty }

    private var searchQuery: String { search.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Whether [task] matches what is typed in the search field (title, note or labels; case and accents ignored).
    func matchesSearch(_ task: TaskItem) -> Bool {
        let query = searchQuery
        guard !query.isEmpty else { return true }
        let options: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]
        return task.title.range(of: query, options: options) != nil
            || (task.note?.range(of: query, options: options) != nil)
            || task.labels.contains { $0.range(of: query, options: options) != nil }
    }

    /// Today's sections with only the tasks the search matches.
    var searchedToday: TodaySections { sections.filter(matchesSearch) }

    /// The line in Today's section when it lists no task; none while a search may be hiding them.
    var todayPlaceholder: String? {
        guard !isSearching, sections.today.isEmpty else { return nil }
        return sections.overdue.isEmpty && sections.now == nil ? tr("Nothing left for today.") : tr("Nothing else planned for today.")
    }

    /// The open and overdue tasks of the place's list as in the sidebar, so a search hiding them leaves the count.
    var listCount: SidebarCounts.Count {
        switch place.filter {
        case .all: return counts.all
        case .noProject: return counts.noProject
        case .project(let id): return counts.project(id)
        case .label(let name): return counts.label(name)
        case nil: return SidebarCounts.Count()
        }
    }

    /// The line over the trash: how long tasks stay there, or that it is empty, unless a search hides what is in it.
    var trashHeader: String {
        let days = TaskItem.trashRetentionDays
        if !trash.isEmpty { return tr("Tasks stay here for \(days) days, then they are deleted for good.") }
        return isSearching ? tr("No task matches the search.") : tr("The trash is empty. Deleted tasks stay here for \(days) days.")
    }

    /// The done tasks (the latest first) and the archived ones of the Done place, at most 50 each.
    var doneAndArchived: (done: [TaskItem], archived: [TaskItem]) {
        let shown = tasks.filter { !$0.inTrash && matchesSearch($0) }
        let done = shown.filter { $0.archivedAt == nil && $0.status == .done }
            .sorted { ($0.completedAt ?? 0) > ($1.completedAt ?? 0) }
        let archived = shown.filter { $0.archivedAt != nil }.sorted { ($0.archivedAt ?? 0) > ($1.archivedAt ?? 0) }
        return (Array(done.prefix(TaskListSections.doneLimit)), Array(archived.prefix(TaskListSections.doneLimit)))
    }

    // MARK: Changes

    /**
     * Saves the editor on the server: a new project at the end of the sidebar (then shown), or the changed fields of
     * one. Nil once the server has it, otherwise what the editor shows (without a connection nothing is queued).
     */
    func saveProject(_ localId: String?, name: String, color: ProjectColor?, icon: String, note: String) async -> String? {
        guard let engine else { return Self.needsConnection }
        do {
            if let localId {
                try await engine.updateProject(localId, name: name, color: color, icon: icon, note: note)
            } else {
                let project = try await engine.addProject(name: name, color: color, icon: icon, note: note)
                show(.project(project.localId))
            }
            return nil
        } catch {
            return Self.failure(error)
        }
    }

    /// Moves a project one place up or down among the projects that take tasks (the menu's Move Up / Move Down).
    func moveProject(_ localId: String, by offset: Int) {
        guard let index = activeProjects.firstIndex(where: { $0.localId == localId }) else { return }
        moveProject(localId, to: index + offset)
    }

    /// Moves a project to [index] among the other projects that take tasks (counted without it).
    func moveProject(_ localId: String, to index: Int) {
        guard let position = ProjectRules.position(moving: localId, to: index, in: activeProjects) else { return }
        runOnServer { try await $0.moveProject(localId, to: position) }
    }

    /// `List.onMove` in the sidebar: [destination] counts the moved project, which `moveProject(_:to:)` does not.
    func moveProjects(from source: IndexSet, to destination: Int) {
        guard source.count == 1, let from = source.first, activeProjects.indices.contains(from) else { return }
        moveProject(activeProjects[from].localId, to: destination > from ? destination - 1 : destination)
    }

    /// Archives a project or restores it on the server; an archived project's place gives way to the archive.
    func setArchived(_ localId: String, _ archived: Bool) {
        runOnServer { [weak self] engine in
            try await engine.setArchived(localId, archived)
            await MainActor.run {
                if archived, case .project(localId) = self?.place { self?.show(.archivedProjects) }
            }
        }
    }

    /**
     * Deletes a project on the server; its tasks move to [target] (a project's `localId`) or out of any project, and
     * its place gives way to where they went. Nil once the server has it, otherwise what the dialog shows.
     */
    func deleteProject(_ localId: String, moveTasksTo target: String?) async -> String? {
        guard let engine else { return Self.needsConnection }
        let shown = place == .project(localId)
        do {
            try await engine.deleteProject(localId, moveTasksTo: target)
            if shown { show(target.map(Place.project) ?? .noProject) }
            return nil
        } catch {
            return Self.failure(error)
        }
    }

    /// Whether Move to Project… can take [taskId]: a task out of the trash, with a server that has projects.
    func canMoveToProject(_ taskId: String?) -> Bool {
        guard showsProjects, let task = taskId.flatMap(task) else { return false }
        return !task.inTrash
    }

    func setProject(_ taskId: String, _ projectId: String?) { run { try await $0.setProject(taskId, projectId) } }

    /**
     * A task dropped on a place of the sidebar: a project takes it, No Project takes it out of its project, Today
     * plans it for today. Other places take nothing.
     */
    @discardableResult
    func drop(_ taskId: String, on place: Place) -> Bool {
        guard let task = task(taskId), !task.inTrash else { return false }
        switch place {
        case .project(let id):
            guard project(id)?.isArchived == false, task.projectLocalId != id else { return false }
            setProject(taskId, id)
        case .noProject:
            guard task.projectLocalId != nil else { return false }
            setProject(taskId, nil)
        case .today:
            moveToToday(taskId)
        default:
            return false
        }
        return true
    }
}
