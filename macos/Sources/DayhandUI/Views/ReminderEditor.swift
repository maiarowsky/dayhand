import DayhandCore
import DayhandLocalization
import SwiftUI

/**
 * The details' Reminders section, the Android app's `RemindersDialog` in place: as in Settings, none, or the task's
 * own, at most five: minutes before the due time (only a timed task rings them) and times of day on the due day or
 * the day before. Times set elsewhere further ahead are kept and shown. The choices stay a draft until
 * **Save Reminders**, which only reminders the backend accepts enable (`ReminderDraft.isValid`).
 */
struct ReminderEditor: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem

    @State private var draft: ReminderDraft
    @State private var newTime = PickerDates.time("09:00")
    @State private var newDaysBefore = 0

    init(task: TaskItem, defaults: [Int]) {
        self.task = task
        _draft = State(initialValue: ReminderDraft(task.reminders, defaults: defaults))
    }

    /// The order of the task's own reminders does not matter to the server or the rings.
    private var changed: Bool {
        switch (draft.reminders, task.reminders) {
        case (nil, nil): return false
        case let (mine?, theirs?): return Set(mine) != Set(theirs)
        default: return true
        }
    }

    private let columns = Array(repeating: GridItem(.flexible(), alignment: .leading), count: 3)

    var body: some View {
        Section(tr("Reminders")) {
            Picker(tr("Reminders"), selection: $draft.mode) {
                Text(tr("As in Settings")).tag(ReminderDraft.Mode.defaults)
                Text(tr("None")).tag(ReminderDraft.Mode.none)
                Text(tr("Custom")).tag(ReminderDraft.Mode.custom)
            }
            .pickerStyle(.segmented)
            // On a row, not the section: a modified section no longer reads as its own section in a form.
            .onChange(of: task.reminders) { draft = ReminderDraft($0, defaults: model.settings.reminderMinutes) }
            .onChange(of: task.localId) { _ in draft = ReminderDraft(task.reminders, defaults: model.settings.reminderMinutes) }
            if draft.mode == .defaults {
                Text(Formatting.reminders(nil, defaults: model.settings.reminderMinutes)).foregroundStyle(.secondary)
            }
            if draft.mode == .custom { custom }
            HStack {
                Spacer()
                Button(tr("Revert")) { draft = ReminderDraft(task.reminders, defaults: model.settings.reminderMinutes) }
                    .disabled(!changed)
                Button(tr("Save Reminders")) { model.setReminders(task.localId, draft.reminders) }
                    .disabled(!changed || !draft.isValid)
            }
        }
    }

    @ViewBuilder private var custom: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(tr("Before the due time")).font(.subheadline.weight(.semibold))
            if task.dueTime == nil {
                Text(tr("These ring only when the task has a time.")).font(.caption).foregroundStyle(.secondary)
            }
            LazyVGrid(columns: columns, alignment: .leading, spacing: 4) {
                ForEach(draft.beforeChoices, id: \.self) { minutes in
                    Toggle(Formatting.minutes(minutes), isOn: Binding(
                        get: { draft.minutes.contains(minutes) },
                        set: { _ in draft.toggle(minutes: minutes) }
                    ))
                    .toggleStyle(.checkbox)
                }
            }
        }
        VStack(alignment: .leading, spacing: 6) {
            Text(tr("At a time of day")).font(.subheadline.weight(.semibold))
            ForEach(draft.times, id: \.self) { reminder in
                let label = Formatting.reminder(reminder)
                HStack {
                    Text(label)
                    Spacer()
                    Button { draft.removeTime(reminder) } label: { Image(systemName: "minus.circle") }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(tr("Remove \(label)"))
                }
            }
            HStack {
                DatePicker(tr("Reminder time"), selection: $newTime, displayedComponents: .hourAndMinute)
                    .labelsHidden()
                    .environment(\.timeZone, PickerDates.zone)
                    .environment(\.locale, Localization.current.locale)
                Picker(tr("Reminder day"), selection: $newDaysBefore) {
                    Text(tr("On the due day")).tag(0)
                    Text(tr("The day before")).tag(1)
                }
                .labelsHidden()
                .fixedSize()
                Button(tr("Add")) { draft.addTime(PickerDates.hhmm(newTime), daysBefore: newDaysBefore) }
                Spacer()
            }
        }
        if !draft.isValid {
            Text(tr("At most \(TaskRules.maxReminders) reminders.")).font(.caption).foregroundStyle(Color.overdue)
        }
    }
}
