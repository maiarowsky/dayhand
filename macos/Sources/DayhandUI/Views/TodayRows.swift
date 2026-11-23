import DayhandCore
import DayhandLocalization
import SwiftUI

/// The measures Today's agenda and its "To plan" column share.
enum TodayStyle {
    /// The agenda's left and right margin.
    static let margin: CGFloat = 28
    /// The width of the time column: room for "14:00", or for "12:30 PM" where clocks have 12 hours.
    static var timeWidth: CGFloat { DateText.time("12:30").count > 5 ? 62 : 44 }
    /// Where a row's title starts: past the time column, the status bar and the gaps between them.
    static var titleInset: CGFloat { timeWidth + 24 }
}

/// A task of Today's agenda: its time (none for an overdue one), a bar in its status's colour, the title and its line,
/// and the box that ticks it off.
struct TodayRow: View {
    let task: TaskItem
    let today: String
    var overdue = false

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            TimeColumn(text: overdue ? nil : task.dueTime.map(DateText.time))
            StatusBar(status: task.status)
            // The line beside the title while both fit, under it when they do not.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    title.lineLimit(1).fixedSize()
                    TaskLine(task: task, today: today, overdue: overdue).fixedSize()
                }
                VStack(alignment: .leading, spacing: 2) {
                    title.lineLimit(2)
                    TaskLine(task: task, today: today, overdue: overdue)
                }
            }
            Spacer(minLength: 4)
            DoneBox(task: task)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, 1)
        .contextMenu { TaskMenu(task: task) }
        .draggable(TaskDrag.payload(task.localId)) { DragPreview(title: task.title) }
        .accessibilityElement(children: .combine)
    }

    private var title: some View {
        Text(task.title)
            .font(.system(size: 14))
            .strikethrough(task.status == .done)
            .foregroundStyle(task.status == .done ? .secondary : .primary)
    }
}

/// The task being worked on now: "Now" in the time column and "where I stopped" under the title.
struct TodayNowRow: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem
    let today: String

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Text(tr("Now"))
                .font(.callout.weight(.semibold))
                .foregroundStyle(PlannerStyle.blue)
                .frame(width: TodayStyle.timeWidth, alignment: .trailing)
            StatusBar(status: task.status)
            VStack(alignment: .leading, spacing: 3) {
                Text(task.title).font(.system(size: 14, weight: .semibold))
                Text(task.resumeNote.map { tr("Where I stopped: \($0)") } ?? tr("Where I stopped: add a note in the details"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TaskLine(task: task, today: today)
            }
            Spacer(minLength: 4)
            Button(tr("Not now")) { model.clearNow() }
                .buttonStyle(.borderless)
                .controlSize(.small)
            DoneBox(task: task)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.vertical, 1)
        .contextMenu { TaskMenu(task: task) }
        .draggable(TaskDrag.payload(task.localId)) { DragPreview(title: task.title) }
        .accessibilityElement(children: .combine)
    }
}

/// The line under a task's title on Today: in progress, then its project, day, repeat and checklist.
struct TaskLine: View {
    let task: TaskItem
    let today: String
    var overdue = false
    var showsDay = false

    var body: some View {
        HStack(spacing: 10) {
            if task.status == .doing {
                Meta(icon: StatusStyle.icon(.doing), text: StatusStyle.name(.doing))
                    .font(.caption)
            }
            TaskMeta(task: task, today: today, overdue: overdue, showsDay: showsDay)
        }
    }
}

/// The time of a task, right-aligned in the agenda's time column; empty for a task without one.
struct TimeColumn: View {
    let text: String?

    var body: some View {
        Text(text ?? "")
            .font(.callout.monospacedDigit())
            .foregroundStyle(.secondary)
            .frame(width: TodayStyle.timeWidth, alignment: .trailing)
    }
}

/// A thin bar in the plan's colour of a status (lime, olive, graphite); the status is also said in words.
struct StatusBar: View {
    let status: TaskStatus

    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(PlannerStyle.fill(status))
            .frame(width: 4)
            .frame(minHeight: 18, maxHeight: .infinity)
            .accessibilityHidden(true)
    }
}
