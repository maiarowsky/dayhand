import DayhandCore
import DayhandLocalization
import SwiftUI

/**
 * The column beside Today's agenda: the open tasks that still need a day (overdue and those without one) and the next
 * few days', each with its count. A task opens in the panel like any other; the selected one gets the round Move
 * button, which takes it to another day or the archive. The search narrows the column like the lists.
 */
struct ToPlanColumn: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        let today = model.sections.date
        let overdue = model.searchedToday.overdue
        let noDay = model.overview.noDay.filter(model.matchesSearch)
        let comingUp = model.overview.comingUp.filter(model.matchesSearch)
        VStack(alignment: .leading, spacing: 0) {
            Text(tr("To plan"))
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                .padding(.horizontal, 16)
                .padding(.top, 20)
                .padding(.bottom, 4)
            if overdue.isEmpty && noDay.isEmpty && comingUp.isEmpty {
                Text(model.isSearching ? tr("No task matches the search.") : tr("Every open task has a day, and the next days are free."))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                Spacer(minLength: 0)
            } else {
                List(selection: $model.selection) {
                    group(tr("Overdue"), overdue, today: today, tint: Color.overdue, overdue: true)
                    group(tr("No day"), noDay, today: today)
                    group(tr("Coming up"), comingUp, today: today, showsDay: true)
                }
                .listStyle(.inset)
                .scrollContentBackground(.hidden)
                .moveButton(for: model.selection.flatMap { id in (overdue + noDay + comingUp).contains { $0.localId == id } ? id : nil })
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.canvas)
    }

    @ViewBuilder
    private func group(
        _ title: String, _ tasks: [TaskItem], today: String, tint: Color = .secondary, overdue: Bool = false, showsDay: Bool = false
    ) -> some View {
        if !tasks.isEmpty {
            // A plain row, not a section header: it takes no selection and has no header band on the column's grey.
            HStack {
                Text(title).foregroundStyle(tint)
                Spacer()
                Text("\(tasks.count)").monospacedDigit().foregroundStyle(.secondary)
            }
            .font(.caption.weight(.semibold))
            .padding(.top, 10)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            ForEach(tasks) { task in
                ToPlanRow(task: task, today: today, overdue: overdue, showsDay: showsDay).tag(task.localId)
            }
        }
    }
}

/// A task in "To plan": the box, the title, its project and day.
struct ToPlanRow: View {
    let task: TaskItem
    let today: String
    var overdue = false
    var showsDay = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            DoneBox(task: task)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title).lineLimit(2)
                TaskLine(task: task, today: today, overdue: overdue, showsDay: showsDay || overdue)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
        .contextMenu { TaskMenu(task: task) }
        .draggable(TaskDrag.payload(task.localId)) { DragPreview(title: task.title) }
        .accessibilityElement(children: .combine)
    }
}
