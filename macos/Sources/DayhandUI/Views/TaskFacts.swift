import DayhandCore
import DayhandLocalization
import SwiftUI

/**
 * The Details of the task panel, one row each: the day (with **To today**), reminders, repeat and the project.
 * Reminders and repeat open their editors in a popover; each stays a draft until it is saved, as before.
 */
struct TaskFacts: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem
    let today: String

    @State private var editingDue = false
    @State private var editingReminders = false
    @State private var editingRepeat = false

    var body: some View {
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 12, verticalSpacing: 10) {
            GridRow {
                FactLabel(icon: "calendar", title: tr("Due"))
                FlowRow(spacing: 10) {
                    Button { editingDue = true } label: { dueChip }
                        .buttonStyle(.plain)
                        .popover(isPresented: $editingDue, arrowEdge: .bottom) { DueEditor(task: task, today: today) }
                    if task.status != .done && task.dueDate != today {
                        Button(tr("To today")) { model.moveToToday(task.localId) }
                            .buttonStyle(.link)
                            .fixedSize()
                            // Level with the chip's text, which has the same padding.
                            .padding(.vertical, 3)
                    }
                }
            }
            GridRow {
                FactLabel(icon: "bell", title: tr("Reminders"))
                FactButton(text: Formatting.reminders(task.reminders, defaults: model.settings.reminderMinutes)) { editingReminders = true }
                    .popover(isPresented: $editingReminders, arrowEdge: .bottom) {
                        Form { ReminderEditor(task: task, defaults: model.settings.reminderMinutes) }
                            .formStyle(.grouped)
                            .frame(width: 460, height: 400)
                    }
            }
            GridRow {
                FactLabel(icon: "arrow.triangle.2.circlepath", title: tr("Repeat"))
                FactButton(text: task.repeat.map(Formatting.repeatRule) ?? tr("Does not repeat")) { editingRepeat = true }
                    .popover(isPresented: $editingRepeat, arrowEdge: .bottom) {
                        Form { RepeatEditor(task: task, today: today) }
                            .formStyle(.grouped)
                            .frame(width: 480, height: 520)
                    }
            }
            if model.showsProjects {
                GridRow {
                    FactLabel(icon: "folder", title: tr("Project"))
                    ProjectChooser(task: task)
                }
            }
        }
    }

    private var dueChip: some View {
        let overdue = HelmDates.isOverdue(task, today: today) && task.status != .done
        return HStack(spacing: 5) {
            Image(systemName: "calendar").imageScale(.small)
            Text(Formatting.due(task, today: today) ?? tr("No day")).lineLimit(1)
        }
        .fixedSize()
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .foregroundStyle(overdue ? Color.overdue : .primary)
        .background((overdue ? Color.overdue : Color.secondary).opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
    }
}

/// The name of a row of Details, after its line icon.
struct FactLabel: View {
    let icon: String
    let title: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon).frame(width: 16).foregroundStyle(.secondary)
            Text(title).foregroundStyle(.secondary)
        }
        .gridColumnAlignment(.leading)
    }
}

/// A value of Details that opens its editor: the value and a chevron.
struct FactButton: View {
    let text: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(text).lineLimit(3).multilineTextAlignment(.leading)
                Image(systemName: "chevron.down").imageScale(.small).foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
    }
}

/// The day and time from a phrase ("fri 2pm"), or Today, Tomorrow, No day and Remove the time.
struct DueEditor: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem
    let today: String
    @State private var phrase = ""
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // The date phrases are English in every language (the grammar of dayhand).
            TextField(tr("Change"), text: $phrase, prompt: Text(verbatim: "tomorrow 9am, fri, 23 oct 14:00"))
                .textFieldStyle(.roundedBorder)
                .onSubmit {
                    failed = !model.setDue(task.localId, phrase: phrase)
                    if !failed { phrase = "" }
                }
            if failed {
                Text(tr("Not a date Dayhand understands; try tomorrow, fri 14:00, next mon, in 3 days or 23 oct."))
                    .font(.caption)
                    .foregroundStyle(Color.overdue)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Button(tr("Today")) { model.setDue(task.localId, date: today, time: task.dueTime) }
                Button(tr("Tomorrow")) { model.setDue(task.localId, date: HelmDates.addDays(today, 1), time: task.dueTime) }
                Button(tr("No day")) { model.setDue(task.localId, date: nil, time: nil) }
                if task.dueTime != nil {
                    Button(tr("Remove the time")) { model.setDue(task.localId, date: task.dueDate, time: nil) }
                }
            }
        }
        .padding(14)
        .frame(width: 360)
    }
}

/// The task's project as a menu: No Project, the projects that take tasks, and New Project….
struct ProjectChooser: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem

    var body: some View {
        let current = model.projectOf(task)
        // A menu's label drops its colors, so the project's mark sits beside it.
        HStack(spacing: 5) {
            if let current { ProjectMark(project: current, size: 8) }
            menu(current)
        }
    }

    private func menu(_ current: Project?) -> some View {
        Menu {
            Button(tr("No Project")) { model.setProject(task.localId, nil) }
            Divider()
            ForEach(model.activeProjects) { project in
                Button(project.icon.map { "\($0) \(project.name)" } ?? project.name) { model.setProject(task.localId, project.localId) }
            }
            Divider()
            Button(tr("New Project…")) { model.projectEditor = ProjectEditorRequest() }
        } label: {
            Text(current?.name ?? tr("No Project"))
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .accessibilityLabel(tr("Project: \(current?.name ?? tr("No Project"))"))
    }
}

/// Lays its views out left to right, starting a new line where the width runs out.
struct FlowRow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                y += line + spacing
                x = 0
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, width), height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                y += line + spacing
                x = bounds.minX
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}
