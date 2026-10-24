import DayhandCore
import DayhandLocalization
import SwiftUI

/// A task's details with basic editing: title, status and "now", the day and time, labels, the checklist and the
/// note, and its change history at the bottom. Repeat and reminders are shown; editing them comes with full parity
/// with the Android app.
struct TaskDetailView: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem

    @State private var title = ""
    @State private var note = ""
    @State private var resumeNote = ""
    @State private var labels = ""
    @State private var duePhrase = ""
    @State private var duePhraseFailed = false
    @State private var newItem = ""
    @State private var confirmTrash = false
    @StateObject private var history = HistoryModel()
    @FocusState private var focus: FieldName?

    enum FieldName: Hashable { case title, resume, labels, note }

    var body: some View {
        let today = model.today
        Form {
            if task.inTrash {
                Section {
                    HStack {
                        Text(tr("In the trash. It goes for good 30 days after it was deleted."))
                        Spacer()
                        Button(tr("Restore")) { model.restore(task.localId) }
                    }
                }
            }
            Group {
            Section {
                TextField(tr("Title"), text: $title)
                    .font(.title3)
                    .focused($focus, equals: .title)
                    .onSubmit(saveTitle)
                Picker(tr("Status"), selection: Binding(get: { task.status }, set: { model.setStatus(task.localId, $0) })) {
                    Text(tr("To do")).tag(TaskStatus.todo)
                    Text(tr("In progress")).tag(TaskStatus.doing)
                    Text(tr("Done")).tag(TaskStatus.done)
                }
                .pickerStyle(.segmented)
                if task.status != .done {
                    Toggle(tr("Working on it now"), isOn: Binding(
                        get: { task.isNow },
                        set: { $0 ? model.setNow(task.localId) : model.clearNow() }
                    ))
                }
                if task.isNow {
                    TextField(tr("Where I stopped"), text: $resumeNote, prompt: Text(tr("next step")))
                        .focused($focus, equals: .resume)
                        .onSubmit(saveResumeNote)
                }
            }
            Section(tr("When")) {
                LabeledContent(tr("Due"), value: Formatting.due(task, today: today) ?? tr("No day"))
                HStack {
                    // The date phrases are English in every language (the grammar of dayhand).
                    TextField(tr("Change"), text: $duePhrase, prompt: Text(verbatim: "tomorrow 9am, fri, 23 oct 14:00"))
                        .onSubmit(saveDuePhrase)
                    Button(tr("Today")) { model.setDue(task.localId, date: today, time: task.dueTime) }
                    Button(tr("No day")) { model.setDue(task.localId, date: nil, time: nil) }
                }
                if duePhraseFailed {
                    Text(tr("Not a date Dayhand understands; try tomorrow, fri 14:00, next mon, in 3 days or 23 oct."))
                        .font(.caption)
                        .foregroundStyle(Color.overdue)
                }
                if task.dueTime != nil {
                    Button(tr("Remove the time")) { model.setDue(task.localId, date: task.dueDate, time: nil) }
                        .buttonStyle(.link)
                }
                LabeledContent(tr("Repeat"), value: task.repeat.map(Formatting.repeatRule) ?? tr("Does not repeat"))
                LabeledContent(tr("Reminders"), value: Formatting.reminders(task.reminders, defaults: model.settings.reminderMinutes))
            }
            Section(tr("Labels")) {
                TextField(tr("Labels"), text: $labels, prompt: Text(tr("home, work")))
                    .focused($focus, equals: .labels)
                    .onSubmit(saveLabels)
            }
            Section(tr("Checklist")) {
                ForEach(task.checklist) { item in
                    HStack {
                        Button { model.toggleItem(task.localId, item.id) } label: {
                            Image(systemName: item.done ? "checkmark.square.fill" : "square")
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(item.done ? tr("Untick \(item.title)") : tr("Tick \(item.title)"))
                        Text(item.title).strikethrough(item.done)
                        Spacer()
                        Button { model.removeItem(task.localId, item.id) } label: { Image(systemName: "minus.circle") }
                            .buttonStyle(.borderless)
                            .accessibilityLabel(tr("Remove \(item.title)"))
                    }
                }
                TextField(tr("New item"), text: $newItem, prompt: Text(tr("Add an item")))
                    .onSubmit {
                        let clean = newItem.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !clean.isEmpty else { return }
                        model.addItem(task.localId, clean)
                        newItem = ""
                    }
            }
            if !task.links.isEmpty {
                Section(tr("Links")) {
                    ForEach(task.links, id: \.url) { link in
                        if let url = URL(string: link.url) {
                            Link(link.title ?? link.url, destination: url)
                        }
                    }
                }
            }
            Section(tr("Note")) {
                TextEditor(text: $note)
                    .focused($focus, equals: .note)
                    .frame(minHeight: 120)
                    .font(.body)
                HStack {
                    Spacer()
                    Button(tr("Save Note")) { model.setNote(task.localId, note) }
                        .disabled(note == (task.note ?? ""))
                }
            }
            }
            .disabled(task.inTrash)
            Section {
                HStack {
                    if task.archivedAt == nil {
                        Button(tr("Archive")) { model.archive(task.localId) }
                    } else {
                        Button(tr("Unarchive")) { model.restore(task.localId) }
                    }
                    Spacer()
                    if !task.inTrash {
                        Button(tr("Move to Trash"), role: .destructive) { confirmTrash = true }
                    }
                }
            }
            HistorySection(history: history, today: today)
        }
        .formStyle(.grouped)
        .navigationTitle(task.title)
        .task(id: task.serverId) { await history.watchHistory(task.serverId, in: model.repository) }
        .task(id: HistoryModel.RefreshKey(serverId: task.serverId, revision: model.historyRefreshRevision)) {
            await history.refresh(task.serverId, with: model)
        }
        .onAppear(perform: load)
        .onChange(of: task) { _ in load() }
        .onChange(of: focus) { [focus] _ in saveLeaving(focus) }
        .onDisappear(perform: saveOpenFields)
        .confirmationDialog(tr("Move “\(task.title)” to the trash?"), isPresented: $confirmTrash) {
            Button(tr("Move to Trash"), role: .destructive) {
                model.moveToTrash(task.localId)
                model.selection = nil
            }
        } message: {
            Text(tr("It stays in the trash for 30 days."))
        }
    }

    /// Fills the fields from the task; a field being typed in is not overwritten by a sync.
    private func load() {
        if focus != .title { title = task.title }
        if focus != .note { note = task.note ?? "" }
        if focus != .resume { resumeNote = task.resumeNote ?? "" }
        if focus != .labels { labels = task.labels.joined(separator: ", ") }
    }

    /// A field the user leaves is saved, as if Return was pressed.
    private func saveLeaving(_ field: FieldName?) {
        guard !task.inTrash else { return }
        switch field {
        case .title: saveTitle()
        case .resume: saveResumeNote()
        case .labels: saveLabels()
        case .note: if note != (task.note ?? "") { model.setNote(task.localId, note) }
        case nil: break
        }
    }

    private func saveResumeNote() {
        if resumeNote.trimmingCharacters(in: .whitespacesAndNewlines) != (task.resumeNote ?? "") {
            model.setResumeNote(task.localId, resumeNote)
        }
    }

    private func saveTitle() {
        if title.trimmingCharacters(in: .whitespacesAndNewlines) != task.title { model.rename(task.localId, title) }
    }

    private func saveLabels() {
        let list = labels.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        if list.filter({ !$0.isEmpty }) != task.labels { model.setLabels(task.localId, list) }
    }

    private func saveDuePhrase() {
        duePhraseFailed = !model.setDue(task.localId, phrase: duePhrase)
        if !duePhraseFailed { duePhrase = "" }
    }

    private func saveOpenFields() {
        guard !task.inTrash else { return }
        saveTitle()
        saveLabels()
        if note != (task.note ?? "") { model.setNote(task.localId, note) }
    }
}
