import DayhandCore
import DayhandLocalization
import SwiftUI

/// The drawer of the plan: the place's tasks in status columns, to drag onto the week. It folds to its title.
struct PlanDrawer: View {
    @EnvironmentObject private var model: AppModel
    @Binding var open: Bool
    /// The height of the open drawer's columns.
    let height: CGFloat

    var body: some View {
        let board = model.board
        VStack(spacing: 0) {
            Capsule().fill(Color.secondary.opacity(0.4)).frame(width: 36, height: 5).padding(.top, 6)
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(tr("Tasks")).font(.headline)
                Text(tr("Drag to the calendar")).font(.callout).foregroundStyle(.secondary)
                Spacer()
                Button { open.toggle() } label: { Image(systemName: open ? "chevron.down" : "chevron.up") }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(open ? tr("Fold the tasks") : tr("Unfold the tasks"))
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.vertical, 8)
            if open {
                HStack(alignment: .top, spacing: 14) {
                    ForEach([TaskStatus.todo, .doing, .done], id: \.self) { status in
                        DrawerColumn(status: status, tasks: board.tasks(status), count: board.count(status))
                    }
                }
                .padding(.horizontal, Metrics.gutter - BoardColumn.inset)
                .padding(.bottom, 10)
                .frame(height: height)
            }
        }
        .background(
            TopRoundedRectangle(radius: 14)
                .fill(Color.card)
                .shadow(color: .black.opacity(0.10), radius: 6, y: -2)
        )
    }
}

/// A status column of the drawer: compact cards; a card dropped here takes the status.
struct DrawerColumn: View {
    @EnvironmentObject private var model: AppModel
    let status: TaskStatus
    let tasks: [TaskItem]
    /// The column's number: Done counts every done task of the place, also those past the cards shown.
    let count: Int
    @State private var targeted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: StatusStyle.icon(status)).foregroundStyle(StatusStyle.color(status)).accessibilityHidden(true)
                Text(StatusStyle.name(status)).font(.subheadline.weight(.semibold))
                Spacer()
                CountPill(count: count, tint: StatusStyle.color(status))
            }
            .padding(.horizontal, 4)
            ScrollView {
                LazyVStack(spacing: 6) {
                    ForEach(tasks) { DrawerCard(task: $0) }
                }
            }
        }
        .padding(BoardColumn.inset)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(RoundedRectangle(cornerRadius: 10).fill(targeted ? Color.accentColor.opacity(0.08) : StatusStyle.color(status).opacity(0.06)))
        .dropDestination(for: String.self) { items, _ in
            guard let id = items.lazy.compactMap(TaskDrag.localId).first else { return false }
            return model.drop(id, onColumn: status)
        } isTargeted: { targeted = $0 }
    }
}

/// A task in the drawer: a bar of its color, a grip, its title and project, and its day (beside them, or under the
/// title when the column is narrow).
struct DrawerCard: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem

    var body: some View {
        let day = task.dueDate.map { Formatting.day($0, today: model.today) }
        let tint = HelmDates.isOverdue(task, today: model.today) && task.status != .done ? Color.overdue : nil
        let project = model.projectLine(task)
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                grip
                VStack(alignment: .leading, spacing: 1) {
                    title
                    if let project { Text(project.name).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 4)
                if let day { due(day, tint) }
            }
            HStack(spacing: 8) {
                grip
                VStack(alignment: .leading, spacing: 1) {
                    title
                    HStack(spacing: 6) {
                        if let project { Text(project.name).foregroundStyle(.secondary).lineLimit(1) }
                        if let day { due(day, tint) }
                    }
                    .font(.caption)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(.leading, 11)
        .padding(.trailing, 8)
        .padding(.vertical, 6)
        .background(Color.card, in: RoundedRectangle(cornerRadius: 8))
        .overlay(alignment: .leading) { PlanBar(color: planTint(task, model)) }
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.secondary.opacity(0.18)))
        .contentShape(RoundedRectangle(cornerRadius: 8))
        .onTapGesture { model.selection = task.localId }
        .draggable(TaskDrag.payload(task.localId)) { DragPreview(title: task.title) }
        .contextMenu { TaskMenu(task: task) }
    }

    private var grip: some View {
        Image(systemName: "line.3.horizontal").foregroundStyle(.tertiary).accessibilityHidden(true)
    }

    private var title: some View {
        Text(task.title).font(.callout).lineLimit(1).strikethrough(task.status == .done)
    }

    /// The day with a calendar icon, red when overdue.
    private func due(_ day: String, _ tint: Color?) -> some View {
        HStack(spacing: 3) {
            Image(systemName: "calendar").imageScale(.small)
            Text(day)
        }
        .font(.caption)
        .foregroundStyle(tint ?? .secondary)
        .fixedSize()
    }
}
