import DayhandCore
import DayhandLocalization
import SwiftUI

/// A task in a list: a box to tick it off, its title, a line with its project, day, repeat and checklist, and a menu of
/// its moves. It can be dragged onto a project, No Project or Today in the sidebar.
struct TaskRow: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem
    let today: String
    var overdue = false
    /// Whether the line says the day (lists other than Today, where every task is today's).
    var showsDay = true

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            DoneBox(task: task)
            VStack(alignment: .leading, spacing: 3) {
                Text(task.title)
                    .strikethrough(task.status == .done)
                    .foregroundStyle(task.status == .done ? .secondary : .primary)
                    .lineLimit(2)
                TaskMeta(task: task, today: today, overdue: overdue, showsDay: showsDay)
            }
            Spacer(minLength: 4)
            if overdue {
                Button(tr("To today")) { model.moveToToday(task.localId) }
                    .buttonStyle(.borderless)
                    .controlSize(.small)
            } else if let time = task.dueTime, !showsDay || task.dueDate == today {
                Text(DateText.time(time)).font(.callout.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 3)
        .contextMenu { TaskMenu(task: task) }
        .draggable(TaskDrag.payload(task.localId)) { DragPreview(title: task.title) }
        .accessibilityElement(children: .combine)
    }
}

/// The second line of a task: its project (a dot of its color, or its emoji), day, repeat and checklist.
struct TaskMeta: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem
    let today: String
    var overdue = false
    var showsDay = true

    var body: some View {
        let project = model.projectLine(task)
        let day = showsDay || overdue ? Formatting.due(task, today: today) : nil
        if project != nil || day != nil || task.repeat != nil || !task.checklist.isEmpty {
            HStack(spacing: 10) {
                if let project {
                    HStack(spacing: 4) {
                        ProjectMark(project: project, size: 7)
                        Text(project.name).lineLimit(1)
                    }
                }
                if let day {
                    Meta(icon: "calendar", text: day, tint: overdue ? Color.overdue : nil)
                }
                if task.repeat != nil {
                    Image(systemName: "arrow.triangle.2.circlepath").accessibilityLabel(tr("Repeats"))
                }
                if !task.checklist.isEmpty {
                    Meta(icon: "checklist", text: "\(task.checklist.filter(\.done).count)/\(task.checklist.count)")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }
}

/// A line icon with a short text, in [tint] or the secondary color.
struct Meta: View {
    let icon: String
    let text: String
    var tint: Color?

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: icon).imageScale(.small)
            Text(text).lineLimit(1)
        }
        .foregroundStyle(tint ?? .secondary)
    }
}

/// What follows the pointer while a task is dragged.
struct DragPreview: View {
    let title: String

    var body: some View {
        Text(title)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.card, in: RoundedRectangle(cornerRadius: 8))
    }
}

/// The "now" task with "where I stopped" under its title.
struct NowRow: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem
    let today: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            DoneBox(task: task)
            VStack(alignment: .leading, spacing: 3) {
                Text(task.title).fontWeight(.semibold).foregroundStyle(.primary)
                Text(task.resumeNote.map { tr("Where I stopped: \($0)") } ?? tr("Where I stopped: add a note in the details"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TaskMeta(task: task, today: today, showsDay: false)
            }
            Spacer(minLength: 4)
            Button(tr("Not now")) { model.clearNow() }
                .buttonStyle(.borderless)
                .controlSize(.small)
        }
        .padding(.vertical, 3)
        .contextMenu { TaskMenu(task: task) }
        .draggable(TaskDrag.payload(task.localId)) { DragPreview(title: task.title) }
    }
}

/// The box that ticks a task off: a line circle in the color of its status, filled once done.
struct DoneBox: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem

    var body: some View {
        Button { model.toggleDone(task) } label: {
            Image(systemName: task.status == .done ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 15))
                .foregroundStyle(task.status == .done ? StatusStyle.color(.done) : StatusStyle.color(task.status))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(task.status == .done ? tr("Mark as not done") : tr("Mark as done"))
    }
}

/// The color and line icon of each status, the same in every view.
enum StatusStyle {
    static func color(_ status: TaskStatus) -> Color {
        switch status {
        case .todo: return Color(nsColor: ProjectColors.nsColor(.orange))
        case .doing: return Color(nsColor: ProjectColors.nsColor(.purple))
        case .done: return Color(nsColor: ProjectColors.nsColor(.green))
        }
    }

    static func icon(_ status: TaskStatus) -> String {
        switch status {
        case .todo: return "circle"
        case .doing: return "circle.dotted"
        case .done: return "checkmark.circle"
        }
    }

    static func name(_ status: TaskStatus) -> String {
        switch status {
        case .todo: return tr("To do")
        case .doing: return tr("In progress")
        case .done: return tr("Done")
        }
    }
}

/// The moves of a task, shared by the context menus of the lists and the menu bar.
struct TaskMenu: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem

    var body: some View {
        Button(task.status == .done ? tr("Mark as Not Done") : tr("Mark as Done")) { model.toggleDone(task) }
        if task.status != .done {
            if task.isNow {
                Button(tr("Not Now")) { model.clearNow() }
            } else {
                Button(tr("Work on It Now")) { model.setNow(task.localId) }
            }
            Divider()
            Button(tr("To Today")) { model.moveToToday(task.localId) }
            Button(tr("To Tomorrow")) { model.moveToTomorrow(task.localId) }
        }
        if model.canMoveToProject(task.localId) {
            Divider()
            Button(tr("Move to Project…")) { model.movingTask = TaskPick(id: task.localId) }
        }
        Divider()
        Button(tr("Archive")) { model.archive(task.localId) }
        Button(tr("Move to Trash")) { model.moveToTrash(task.localId) }
    }
}
