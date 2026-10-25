import DayhandCore
import DayhandLocalization
import SwiftUI

/// How the main area shows the tasks of a place: a board of status columns, the week's plan, or a list in sections.
enum ViewMode: String, CaseIterable {
    case board, plan, list

    var title: String {
        switch self {
        case .board: return tr("Board")
        case .plan: return tr("Plan")
        case .list: return tr("List")
        }
    }

    /// ⌃⌘1, ⌃⌘2, ⌃⌘3 in the View menu.
    var key: KeyEquivalent {
        switch self {
        case .board: return "1"
        case .plan: return "2"
        case .list: return "3"
        }
    }
}

/// The tasks of the place picked in the sidebar, by status, for the board.
struct BoardColumns: Equatable {
    var todo: [TaskItem] = []
    var doing: [TaskItem] = []
    var done: [TaskItem] = []
    /// All the done tasks of the place, though the column shows only the latest.
    var doneCount = 0

    func tasks(_ status: TaskStatus) -> [TaskItem] {
        switch status {
        case .todo: return todo
        case .doing: return doing
        case .done: return done
        }
    }

    func count(_ status: TaskStatus) -> Int {
        status == .done ? doneCount : tasks(status).count
    }

    /// The open tasks in the order of the list (overdue, today, later, no day) and the latest done.
    init(open: [TaskItem], done: [TaskItem], doneCount: Int) {
        todo = open.filter { $0.status == .todo }
        doing = open.filter { $0.status == .doing }
        self.done = done
        self.doneCount = doneCount
    }

    init() {}
}

extension AppModel {
    /// The board of the place picked in the sidebar: Today's plan, or the tasks of a list place.
    var board: BoardColumns {
        switch place {
        case .today:
            let s = searchedToday
            return BoardColumns(open: s.overdue + (s.now.map { [$0] } ?? []) + s.today, done: s.done, doneCount: s.done.count)
        case .all, .noProject, .project, .label:
            return BoardColumns(
                open: list.overdue + list.today + list.later + list.noDay, done: list.done, doneCount: list.doneCount
            )
        case .inbox, .archivedProjects, .done, .trash:
            return BoardColumns()
        }
    }

    /// Moves a task dropped on the board's [status] column there; false when it is unknown or already in it.
    func drop(_ taskId: String, onColumn status: TaskStatus) -> Bool {
        guard let task = task(taskId), task.status != status else { return false }
        setStatus(taskId, status)
        return true
    }

    /// Whether the place shows tasks that the board and the list can both show.
    var placeHasViews: Bool {
        switch place {
        case .today, .all, .noProject, .project, .label: return true
        case .inbox, .archivedProjects, .done, .trash: return false
        }
    }
}

/// The board: To do, In progress and Done side by side. Dragging a card to another column changes its status, and a
/// selected card opens its panel along the bottom.
struct BoardView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        let board = model.board
        HStack(alignment: .top, spacing: 14) {
            ForEach([TaskStatus.todo, .doing, .done], id: \.self) { status in
                BoardColumn(status: status, tasks: board.tasks(status), count: board.count(status))
            }
        }
        // The columns' own inset, so their cards line up with quick add and the lists.
        .padding(.horizontal, Metrics.gutter - BoardColumn.inset)
        .padding(.bottom, 12)
    }
}

/// One status column: its line icon and name with the number of cards, then the cards. A card dropped on it takes
/// its status.
struct BoardColumn: View {
    @EnvironmentObject private var model: AppModel
    let status: TaskStatus
    let tasks: [TaskItem]
    let count: Int
    @State private var targeted = false

    static let inset: CGFloat = 8

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: StatusStyle.icon(status))
                    .foregroundStyle(StatusStyle.color(status))
                    .accessibilityHidden(true)
                Text(StatusStyle.name(status)).font(.headline)
                CountPill(count: count, tint: StatusStyle.color(status))
                Spacer()
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 8)
            .overlay(alignment: .bottom) { Divider() }
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(tasks) { TaskCard(task: $0) }
                    if status == .todo && model.placeTakesTasks { AddCard() }
                }
                .padding(.bottom, 8)
            }
        }
        .padding(Self.inset)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(targeted ? Color.accentColor.opacity(0.08) : Color.clear)
        )
        .dropDestination(for: String.self) { items, _ in
            guard let id = items.lazy.compactMap(TaskDrag.localId).first else { return false }
            return model.drop(id, onColumn: status)
        } isTargeted: { targeted = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(StatusStyle.name(status)), \(count)")
    }
}

/// A task on the board: its title, project, and chips for the day, labels and checklist. No colored stripe and no
/// round backgrounds: line icons carry the meaning.
struct TaskCard: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem

    var body: some View {
        let selected = model.selection == task.localId
        let today = model.today
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(task.title)
                    .font(.body.weight(.medium))
                    .strikethrough(task.status == .done)
                    .foregroundStyle(task.status == .done ? .secondary : .primary)
                    .lineLimit(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Menu { TaskMenu(task: task) } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .foregroundStyle(.secondary)
                    .help(tr("More"))
                    .accessibilityLabel(tr("More"))
            }
            if let project = model.projectLine(task) {
                HStack(spacing: 5) {
                    ProjectMark(project: project, size: 7)
                    Text(project.name).lineLimit(1)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            CardChips(task: task, today: today)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.card, in: RoundedRectangle(cornerRadius: Metrics.radius))
        .overlay(
            RoundedRectangle(cornerRadius: Metrics.radius)
                .strokeBorder(selected ? Color.accentColor : Color.secondary.opacity(0.18), lineWidth: selected ? 1.5 : 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: Metrics.radius))
        .onTapGesture { model.selection = selected ? nil : task.localId }
        .contextMenu { TaskMenu(task: task) }
        .draggable(TaskDrag.payload(task.localId)) { DragPreview(title: task.title) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

/// The chips under a card's title: the day (red when overdue), labels, the checklist and repeat.
struct CardChips: View {
    let task: TaskItem
    let today: String

    var body: some View {
        let overdue = HelmDates.isOverdue(task, today: today) && task.status != .done
        let day = Formatting.due(task, today: today)
        if day != nil || !task.labels.isEmpty || !task.checklist.isEmpty || task.repeat != nil {
            FlowRow(spacing: 6) {
                if let day { Chip(icon: "calendar", text: day, tint: overdue ? Color.overdue : nil) }
                ForEach(task.labels, id: \.self) { Chip(icon: "tag", text: $0) }
                if !task.checklist.isEmpty {
                    Chip(icon: "checklist", text: "\(task.checklist.filter(\.done).count)/\(task.checklist.count)")
                }
                if task.repeat != nil { Chip(icon: "arrow.triangle.2.circlepath", text: nil) }
            }
        }
    }
}

/// The number of cards in a column, in a pill of the column's color.
struct CountPill: View {
    let count: Int
    let tint: Color

    var body: some View {
        Text("\(count)")
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background(Capsule().fill(tint.opacity(0.14)))
    }
}

/// A small rounded chip: a line icon and an optional short text, tinted or secondary.
struct Chip: View {
    let icon: String
    let text: String?
    var tint: Color?

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon).imageScale(.small)
            if let text { Text(text).lineLimit(1) }
        }
        .font(.caption)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .foregroundStyle(tint ?? .secondary)
        .background((tint ?? Color.secondary).opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
    }
}

/// "+ Add task" under the To do column: quick add for the place.
struct AddCard: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Button { QuickAddPanel.shared.show(place: model.place) } label: {
            Label(tr("Add Task"), systemImage: "plus")
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .foregroundStyle(.secondary)
                .overlay(
                    RoundedRectangle(cornerRadius: Metrics.radius)
                        .strokeBorder(Color.secondary.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                )
        }
        .buttonStyle(.plain)
    }
}
