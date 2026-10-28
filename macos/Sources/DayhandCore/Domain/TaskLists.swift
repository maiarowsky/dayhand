import Foundation

/// Which tasks a list of the sidebar shows: every task, one project's or those without a project.
public enum TaskFilter: Hashable, Sendable {
    case all, noProject, project(String)

    /**
     * Whether [task] belongs to the list. [projects] are the `localId`s of the projects this Mac has: a task naming
     * any other (its project not merged yet, or gone) counts as having no project.
     */
    public func matches(_ task: TaskItem, projects: Set<String>) -> Bool {
        switch self {
        case .all: return true
        case .noProject: return task.projectIn(projects) == nil
        case .project(let id): return task.projectLocalId == id && projects.contains(id)
        }
    }
}

extension TaskItem {
    /// The task's project when this Mac has it.
    public func projectIn(_ projects: Set<String>) -> String? {
        projectLocalId.flatMap { projects.contains($0) ? $0 : nil }
    }
}

/// A list of the sidebar in sections, top to bottom: overdue, today, later (by day), no day, and the latest done.
public struct TaskListSections: Hashable, Sendable {
    public let date: String
    public let overdue: [TaskItem]
    public let today: [TaskItem]
    public let later: [TaskItem]
    public let noDay: [TaskItem]
    /// The most recently done first, at most `doneLimit`.
    public let done: [TaskItem]
    /// Every done task of the list, also those [done] leaves out.
    public let doneCount: Int

    public var openCount: Int { overdue.count + today.count + later.count + noDay.count }
    public var isEmpty: Bool { openCount == 0 && doneCount == 0 }

    public static let doneLimit = 50
    public static let empty = TaskListSections(date: "", overdue: [], today: [], later: [], noDay: [], done: [], doneCount: 0)
}

/// Splits the active tasks (neither archived nor in the trash) of [filter] into the list's sections at [nowMs].
public func taskListSections(
    _ tasks: [TaskItem], filter: TaskFilter, projects: Set<String>, nowMs: Int64, timezone: String?
) -> TaskListSections {
    let today = HelmDates.localDate(nowMs, timezone)
    let listed = tasks.filter { $0.isActive && filter.matches($0, projects: projects) }
    let open = listed.filter { $0.status != .done }
    let done = listed.filter { $0.status == .done }.sorted { ($0.completedAt ?? 0) > ($1.completedAt ?? 0) }
    return TaskListSections(
        date: today,
        overdue: open.filter { HelmDates.isOverdue($0, today: today) }.sorted(by: bySchedule),
        today: open.filter { $0.dueDate == today }.sorted(by: bySchedule),
        later: open.filter { ($0.dueDate ?? "") > today }.sorted(by: bySchedule),
        noDay: open.filter { $0.dueDate == nil }.sorted(by: bySchedule),
        done: Array(done.prefix(TaskListSections.doneLimit)),
        doneCount: done.count
    )
}

/**
 * The numbers next to the places of the sidebar: open tasks (active and not done) and how many of them are overdue,
 * counted from the local database, so they hold offline.
 */
public struct SidebarCounts: Hashable, Sendable {
    public struct Count: Hashable, Sendable {
        public var open = 0
        public var overdue = 0

        public init(open: Int = 0, overdue: Int = 0) {
            self.open = open
            self.overdue = overdue
        }
    }

    public var all = Count()
    public var noProject = Count()
    /// By project `localId`, archived projects included; a project without open tasks is absent.
    public var projects: [String: Count] = [:]
    public var archivedProjects = 0

    public init() {}

    public func project(_ localId: String) -> Count { projects[localId] ?? Count() }

    public static let empty = SidebarCounts()
}

public func sidebarCounts(_ tasks: [TaskItem], projects: [Project], today: String) -> SidebarCounts {
    var counts = SidebarCounts()
    let known = Set(projects.map(\.localId))
    for task in tasks where task.isActive && task.status != .done {
        let overdue = HelmDates.isOverdue(task, today: today) ? 1 : 0
        func add(_ count: inout SidebarCounts.Count) {
            count.open += 1
            count.overdue += overdue
        }
        add(&counts.all)
        if let project = task.projectIn(known) { add(&counts.projects[project, default: SidebarCounts.Count()]) } else { add(&counts.noProject) }
    }
    counts.archivedProjects = projects.filter(\.isArchived).count
    return counts
}
