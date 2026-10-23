import DayhandCore
import SwiftUI

/// A task's details with basic editing: title, status and "now", the day and time, labels, the checklist and the
/// note. Repeat and reminders are shown; editing them comes with full parity with the Android app.
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
    @FocusState private var focus: FieldName?

    enum FieldName: Hashable { case title, resume, labels, note }

    var body: some View {
        let today = model.today
        Form {
            if task.inTrash {
                Section {
                    HStack {
                        Text("In the trash. It goes for good 30 days after it was deleted.")
                        Spacer()
                        Button("Restore") { model.restore(task.localId) }
                    }
                }
            }
            Group {
            Section {
                TextField("Title", text: $title)
                    .font(.title3)
                    .focused($focus, equals: .title)
                    .onSubmit(saveTitle)
                Picker("Status", selection: Binding(get: { task.status }, set: { model.setStatus(task.localId, $0) })) {
                    Text("To do").tag(TaskStatus.todo)
                    Text("In progress").tag(TaskStatus.doing)
                    Text("Done").tag(TaskStatus.done)
                }
                .pickerStyle(.segmented)
                if task.status != .done {
                    Toggle("Working on it now", isOn: Binding(
                        get: { task.isNow },
                        set: { $0 ? model.setNow(task.localId) : model.clearNow() }
                    ))
                }
                if task.isNow {
                    TextField("Where I stopped / next step", text: $resumeNote)
                        .focused($focus, equals: .resume)
                        .onSubmit(saveResumeNote)
                }
            }
            Section("When") {
                LabeledContent("Due", value: Formatting.due(task, today: today) ?? "No day")
                HStack {
                    TextField("Change: tomorrow 9am, fri, 23 oct 14:00…", text: $duePhrase)
                        .onSubmit(saveDuePhrase)
                    Button("Today") { model.setDue(task.localId, date: today, time: task.dueTime) }
                    Button("No day") { model.setDue(task.localId, date: nil, time: nil) }
                }
                if duePhraseFailed {
                    Text("Not a date Dayhand understands; try tomorrow, fri 14:00, next mon, in 3 days or 23 oct.")
                        .font(.caption)
                        .foregroundStyle(Color.overdue)
                }
                if task.dueTime != nil {
                    Button("Remove the time") { model.setDue(task.localId, date: task.dueDate, time: nil) }
                        .buttonStyle(.link)
                }
                LabeledContent("Repeat", value: task.repeat.map(Formatting.repeatRule) ?? "Does not repeat")
                LabeledContent("Reminders", value: Formatting.reminders(task.reminders, defaults: model.settings.reminderMinutes))
            }
            Section("Labels") {
                TextField("Labels, separated by commas", text: $labels)
                    .focused($focus, equals: .labels)
                    .onSubmit(saveLabels)
            }
            Section("Checklist") {
                ForEach(task.checklist) { item in
                    HStack {
                        Button { model.toggleItem(task.localId, item.id) } label: {
                            Image(systemName: item.done ? "checkmark.square.fill" : "square")
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(item.done ? "Untick \(item.title)" : "Tick \(item.title)")
                        Text(item.title).strikethrough(item.done)
                        Spacer()
                        Button { model.removeItem(task.localId, item.id) } label: { Image(systemName: "minus.circle") }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Remove \(item.title)")
                    }
                }
                TextField("Add an item", text: $newItem)
                    .onSubmit {
                        let clean = newItem.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !clean.isEmpty else { return }
                        model.addItem(task.localId, clean)
                        newItem = ""
                    }
            }
            if !task.links.isEmpty {
                Section("Links") {
                    ForEach(task.links, id: \.url) { link in
                        if let url = URL(string: link.url) {
                            Link(link.title ?? link.url, destination: url)
                        }
                    }
                }
            }
            Section("Note") {
                TextEditor(text: $note)
                    .focused($focus, equals: .note)
                    .frame(minHeight: 120)
                    .font(.body)
                HStack {
                    Spacer()
                    Button("Save Note") { model.setNote(task.localId, note) }
                        .disabled(note == (task.note ?? ""))
                }
            }
            }
            .disabled(task.inTrash)
            Section {
                HStack {
                    if task.archivedAt == nil {
                        Button("Archive") { model.archive(task.localId) }
                    } else {
                        Button("Unarchive") { model.restore(task.localId) }
                    }
                    Spacer()
                    if !task.inTrash {
                        Button("Move to Trash", role: .destructive) { confirmTrash = true }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(task.title)
        .onAppear(perform: load)
        .onChange(of: task) { _ in load() }
        .onChange(of: focus) { [focus] _ in saveLeaving(focus) }
        .onDisappear(perform: saveOpenFields)
        .confirmationDialog("Move “\(task.title)” to the trash?", isPresented: $confirmTrash) {
            Button("Move to Trash", role: .destructive) {
                model.moveToTrash(task.localId)
                model.selection = nil
            }
        } message: {
            Text("It stays in the trash for 30 days.")
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
