import DayhandCore
import SwiftUI

/// What one line of quick add will become, worked out as the user types.
struct QuickAddPreview: Equatable {
    let title: String
    let when: String
    let phrase: String?

    @MainActor
    static func of(_ line: String, readPhrase: Bool, model: AppModel) -> QuickAddPreview? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let today = model.today
        guard readPhrase else { return QuickAddPreview(title: trimmed, when: "Today", phrase: nil) }
        let input = QuickAdd.parse(trimmed, now: Clock.nowMs(), timezone: model.settings.timezone)
        let when = input.when.map { Formatting.when($0, today: today) } ?? "Today"
        return QuickAddPreview(title: input.title, when: when, phrase: input.phrase)
    }
}

/// The floating quick add panel: one field, and a line saying what will be added.
struct QuickAddView: View {
    @EnvironmentObject private var model: AppModel
    @State private var line = ""
    @State private var readPhrase = true
    @FocusState private var focused: Bool
    let onDone: () -> Void

    init(line: String = "", onDone: @escaping () -> Void) {
        _line = State(initialValue: line)
        self.onDone = onDone
    }

    var body: some View {
        let preview = QuickAddPreview.of(line, readPhrase: readPhrase, model: model)
        VStack(alignment: .leading, spacing: 8) {
            TextField("New task, e.g. Call the accountant fri 2pm", text: $line)
                .textFieldStyle(.plain)
                .font(.system(size: 20))
                .focused($focused)
                .onSubmit(submit)
                .onChange(of: line) { _ in readPhrase = true }
            HStack(spacing: 8) {
                if let preview {
                    Image(systemName: "calendar").foregroundStyle(.secondary)
                    Text(preview.when).foregroundStyle(.secondary)
                    if let phrase = preview.phrase {
                        Text("from “\(phrase)”").foregroundStyle(.tertiary)
                        Button("Keep in title") { readPhrase = false }
                            .buttonStyle(.link)
                            .help("Add the words as part of the title instead of reading them as a date")
                    }
                } else {
                    Text("Return adds it for today; a date at the end (tomorrow 9am, fri, 23 oct) sets the day.")
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
        if model.quickAdd(line, readPhrase: readPhrase) {
            line = ""
            onDone()
        }
    }
}

/// The same quick add, at the top of Today and in the menu bar.
struct InlineQuickAdd: View {
    @EnvironmentObject private var model: AppModel
    @State private var line = ""
    @State private var readPhrase = true

    var body: some View {
        let preview = QuickAddPreview.of(line, readPhrase: readPhrase, model: model)
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: "plus.circle").foregroundStyle(.secondary)
                TextField("Add a task (try: Pay rent fri 9am)", text: $line)
                    .textFieldStyle(.plain)
                    .onSubmit {
                        if model.quickAdd(line, readPhrase: readPhrase) { line = "" }
                    }
                    .onChange(of: line) { _ in readPhrase = true }
            }
            if let preview, preview.phrase != nil {
                HStack(spacing: 6) {
                    Text("\(preview.when) · from “\(preview.phrase ?? "")”")
                    Button("Keep in title") { readPhrase = false }.buttonStyle(.link)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
    }
}
