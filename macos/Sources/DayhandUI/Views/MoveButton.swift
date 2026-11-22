import DayhandCore
import DayhandLocalization
import SwiftUI

/**
 * The one way to move the task selected in To plan (or among the overdue on a narrow Today): a round button in the
 * corner whose options open beside it, To Today, To Tomorrow, Another Day… and Archive, as on Android. The rows keep
 * their width for the titles; the Task menu and the context menu offer the same with the keyboard (⌘T, ⇧⌘T, ⌥⌘T).
 */
struct MoveButton: View {
    let taskId: String
    @State private var open = false

    var body: some View {
        Button { open.toggle() } label: {
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(PlannerStyle.onBlue)
                .frame(width: 38, height: 38)
                .background(Circle().fill(PlannerStyle.blue))
                .shadow(color: .black.opacity(0.18), radius: 4, y: 2)
        }
        .buttonStyle(.plain)
        .help(tr("Move the selected task"))
        .accessibilityLabel(tr("Move the selected task"))
        .popover(isPresented: $open, arrowEdge: .leading) {
            MoveOptions(taskId: taskId) { open = false }
        }
    }
}

/// The options of the Move button, one per line with its icon.
struct MoveOptions: View {
    @EnvironmentObject private var model: AppModel
    let taskId: String
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            option(tr("To Today"), "sun.max") { model.moveToToday(taskId) }
            option(tr("To Tomorrow"), "sunrise") { model.moveToTomorrow(taskId) }
            option(tr("Another Day…"), "calendar") { model.reschedulingTask = TaskPick(id: taskId) }
            Divider().padding(.vertical, 4)
            option(tr("Archive"), "archivebox") { model.archive(taskId) }
        }
        .padding(6)
        .frame(width: 200)
    }

    private func option(_ title: String, _ icon: String, action: @escaping () -> Void) -> some View {
        MoveOption(title: title, icon: icon) {
            close()
            action()
        }
    }
}

private struct MoveOption: View {
    let title: String
    let icon: String
    let action: () -> Void
    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(RoundedRectangle(cornerRadius: 5).fill(hovered ? PlannerStyle.blue.opacity(0.14) : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
    }
}

/// Another Day…: a calendar to pick the task's new day, its current day or tomorrow picked first.
struct DayPicker: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let taskId: String
    @State private var day: Date?

    var body: some View {
        let task = model.task(taskId)
        let first = task?.dueDate.flatMap { $0 > model.today ? $0 : nil } ?? HelmDates.addDays(model.today, 1) ?? model.today
        VStack(alignment: .leading, spacing: 12) {
            Text(tr("Move “\(task?.title ?? "")” to")).font(.headline).lineLimit(2)
            DatePicker(
                tr("Day"),
                selection: Binding(get: { day ?? PickerDates.date(first) }, set: { day = $0 }),
                displayedComponents: .date
            )
            .datePickerStyle(.graphical)
            .labelsHidden()
            .environment(\.timeZone, PickerDates.zone)
            HStack {
                Spacer()
                Button(tr("Cancel")) { dismiss() }.keyboardShortcut(.cancelAction)
                Button(tr("Move")) {
                    model.moveToDay(taskId, PickerDates.day(day ?? PickerDates.date(first)))
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 320)
    }
}
