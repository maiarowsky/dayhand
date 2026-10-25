import DayhandCore
import DayhandLocalization
import SwiftUI

/// What one line of quick add will become, worked out as the user types.
struct QuickAddPreview: Equatable {
    let title: String
    /// The day (and time), or nil for a task without a day.
    let when: String?
    let phrase: String?
    /// The project's name: from a `+word`, or the project of the place quick add is in.
    var project: String?
    /// A `+word` naming no project, which stays in the title.
    var unknownProject: String?

    /// [place] gives the day when the line has none (today on Today) and the project.
    @MainActor
    static func of(_ line: String, readPhrase: Bool, model: AppModel, place: Place = .today) -> QuickAddPreview? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let today = model.today
        let context = QuickAddContext(place, today: today)
        let input = model.parseQuickAdd(trimmed, readPhrase: readPhrase)
        let day = input.when.map { Formatting.when($0, today: today) } ?? context.date.map { Formatting.day($0, today: today) }
        let project = model.project(input.projectLocalId ?? (model.showsProjects ? context.project : nil))
        return QuickAddPreview(
            title: input.title, when: day, phrase: input.phrase, project: project?.name, unknownProject: input.unknownProject
        )
    }

    /// "Tomorrow, 14:00 · Strona piekarni", "No day", for the line under the field.
    var summary: String {
        let day = when ?? tr("No day")
        return project.map { Formatting.pair(day, tr("Project: \($0)")) } ?? day
    }
}

/// The floating quick add panel: one field, and a line saying what will be added.
struct QuickAddView: View {
    @EnvironmentObject private var model: AppModel
    @State private var line = ""
    @State private var readPhrase = true
    @FocusState private var focused: Bool
    /// Where the task goes when the line does not say: today, or the project picked in the sidebar.
    let place: Place
    let onDone: () -> Void

    init(line: String = "", place: Place = .today, onDone: @escaping () -> Void) {
        _line = State(initialValue: line)
        self.place = place
        self.onDone = onDone
    }

    var body: some View {
        let preview = QuickAddPreview.of(line, readPhrase: readPhrase, model: model, place: place)
        VStack(alignment: .leading, spacing: 8) {
            TextField(tr("New task, e.g. Call the accountant fri 2pm"), text: $line)
                .textFieldStyle(.plain)
                .font(.system(size: 20))
                .focused($focused)
                .onSubmit(submit)
                .onChange(of: line) { _ in readPhrase = true }
            HStack(spacing: 8) {
                if let preview {
                    Image(systemName: "calendar").foregroundStyle(.secondary)
                    Text(preview.summary).foregroundStyle(.secondary)
                    if let unknown = preview.unknownProject {
                        Text(tr("No project “\(unknown)”")).foregroundStyle(.tertiary)
                    }
                    if let phrase = preview.phrase {
                        Text(tr("from “\(phrase)”")).foregroundStyle(.tertiary)
                        Button(tr("Keep in title")) { readPhrase = false }
                            .buttonStyle(.link)
                            .help(tr("Add the words as part of the title instead of reading them as a date"))
                    }
                } else {
                    Text(model.showsProjects
                        ? tr("Return adds it for today; a date at the end (tomorrow 9am, fri, 23 oct) sets the day, +project the project.")
                        : tr("Return adds it for today; a date at the end (tomorrow 9am, fri, 23 oct) sets the day."))
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .font(.callout)
        }
        .padding(16)
        .frame(width: 560)
        .onAppear { focused = true }
        .onExitCommand(perform: onDone)
    }

    private func submit() {
        if model.quickAdd(line, readPhrase: readPhrase, in: place) {
            line = ""
            onDone()
        }
    }
}

/// The same quick add, at the top of the lists and in the menu bar: it adds to the place it is in ([place], or the
/// place picked in the sidebar), so a line typed in a project goes to that project.
struct InlineQuickAdd: View {
    @EnvironmentObject private var model: AppModel
    var place: Place?
    @State private var line = ""
    @State private var readPhrase = true

    var body: some View {
        let place = place ?? model.place
        let preview = QuickAddPreview.of(line, readPhrase: readPhrase, model: model, place: place)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Image(systemName: "plus").foregroundStyle(.secondary)
                TextField(prompt(place), text: $line)
                    .textFieldStyle(.plain)
                    .onSubmit {
                        if model.quickAdd(line, readPhrase: readPhrase, in: place) { line = "" }
                    }
                    .onChange(of: line) { _ in readPhrase = true }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(Color.card, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.secondary.opacity(0.25)))
            if let preview, preview.phrase != nil || preview.project != nil || preview.unknownProject != nil {
                HStack(spacing: 6) {
                    if let phrase = preview.phrase {
                        Text(tr("\(preview.summary) · from “\(phrase)”"))
                        Button(tr("Keep in title")) { readPhrase = false }.buttonStyle(.link)
                    } else {
                        Text(preview.summary)
                    }
                    if let unknown = preview.unknownProject {
                        Text(tr("No project “\(unknown)”")).foregroundStyle(.tertiary)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.leading, 10)
            }
        }
    }

    private func prompt(_ place: Place) -> String {
        if case .project(let id) = place, let project = model.project(id) { return tr("Add to \(project.name)") }
        return tr("Add a task (try: Pay rent fri 9am)")
    }
}
