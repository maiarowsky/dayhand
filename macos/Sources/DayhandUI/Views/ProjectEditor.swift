import AppKit
import DayhandCore
import DayhandLocalization
import SwiftUI

/**
 * A new project or one to edit: the name, one of the twelve colors (or none), an emoji icon and a note. **Save** is
 * enabled only for what the server accepts (`ProjectRules`), and the reason shows under the field that needs it. The
 * editor stays open until the server has the change; a refusal, or no connection, shows above the buttons.
 */
struct ProjectEditor: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let project: Project?

    @State private var name: String
    @State private var color: ProjectColor?
    @State private var icon: String
    @State private var note: String
    @State private var saving = false
    @State private var failure: String?
    @FocusState private var focus: Field?

    enum Field: Hashable { case name, icon }

    init(project: Project?) {
        self.project = project
        _name = State(initialValue: project?.name ?? "")
        _color = State(initialValue: project?.color ?? (project == nil ? .blue : nil))
        _icon = State(initialValue: project?.icon ?? "")
        _note = State(initialValue: project?.note ?? "")
    }

    var body: some View {
        let check = ProjectEditorCheck(name: name, icon: icon, note: note, projects: model.projects, editing: project?.localId)
        VStack(alignment: .leading, spacing: 16) {
            Text(project == nil ? tr("New Project") : tr("Edit Project")).font(.title3.bold())
            Form {
                VStack(alignment: .leading, spacing: 4) {
                    TextField(tr("Name"), text: $name, prompt: Text(tr("Bakery website")))
                        .focused($focus, equals: .name)
                    if let problem = check.nameProblem, !name.isEmpty { Problem(text: problem) }
                }
                LabeledContent(tr("Color")) { swatches }
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        TextField(tr("Icon"), text: $icon, prompt: Text(tr("One emoji, optional")))
                            .focused($focus, equals: .icon)
                        Button(tr("Emoji…")) {
                            focus = .icon
                            NSApp.orderFrontCharacterPalette(nil)
                        }
                        .help(tr("Opens the Character Viewer (⌃⌘Space)"))
                    }
                    if let problem = check.iconProblem { Problem(text: problem) }
                }
                VStack(alignment: .leading, spacing: 4) {
                    TextField(tr("Note"), text: $note, prompt: Text(tr("What the project is about, for you and agents")), axis: .vertical)
                        .lineLimit(3...6)
                    if let problem = check.noteProblem { Problem(text: problem) }
                }
            }
            .formStyle(.columns)
            if let failure { Problem(text: failure) }
            HStack {
                Spacer()
                if saving { ProgressView().controlSize(.small) }
                Button(tr("Cancel"), role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(tr("Save")) { save() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!check.isValid || !changed || saving)
            }
        }
        .padding(20)
        .frame(width: 480)
        .onAppear { focus = .name }
    }

    private func save() {
        saving = true
        failure = nil
        Task {
            failure = await model.saveProject(project?.localId, name: name, color: color, icon: icon, note: note)
            saving = false
            if failure == nil { dismiss() }
        }
    }

    private var changed: Bool {
        guard let project else { return true }
        return name != project.name || color != project.color || icon != (project.icon ?? "") || note != (project.note ?? "")
    }

    private var swatches: some View {
        HStack(spacing: 2) {
            Swatch(color: nil, selected: color == nil) { color = nil }
            ForEach(ProjectColor.allCases, id: \.self) { token in
                Swatch(color: token, selected: color == token) { color = token }
            }
        }
        // On the label's line: the swatches' middle a little under the text's baseline.
        .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
    }

}

/// Why a field, or the change, cannot be saved.
private struct Problem: View {
    let text: String

    var body: some View {
        Text(text).font(.caption).foregroundStyle(Color.overdue).fixedSize(horizontal: false, vertical: true)
    }
}

/// One color of the editor, ringed while picked.
private struct Swatch: View {
    let color: ProjectColor?
    let selected: Bool
    let pick: () -> Void

    var body: some View {
        Button(action: pick) {
            ColorDot(color: color, size: 14)
                .padding(3)
                .overlay(Circle().strokeBorder(Color.primary.opacity(selected ? 0.7 : 0), lineWidth: 1.5))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(color.map(ProjectColors.name) ?? tr("No color"))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// What the editor's fields say against the server's rules.
struct ProjectEditorCheck: Equatable {
    let nameProblem: String?
    let iconProblem: String?
    let noteProblem: String?

    init(name: String, icon: String, note: String, projects: [Project], editing: String?) {
        switch ProjectRules.name(name, among: projects, except: editing) {
        case .success: nameProblem = nil
        case .failure(let problem): nameProblem = problem.message
        }
        iconProblem = ProjectRules.icon(icon) == nil ? tr("The icon must be a single emoji.") : nil
        noteProblem = ProjectRules.note(note) == nil
            ? tr("The note must be at most \(ProjectRules.maxNote) characters.")
            : nil
    }

    var isValid: Bool { nameProblem == nil && iconProblem == nil && noteProblem == nil }
}

/// Move to Project… (⇧⌘M): the projects that take tasks, narrowed by what is typed, and No Project.
struct ProjectPicker: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let taskId: String
    @State private var query = ""
    @State private var picked: String?

    /// The projects whose names hold [query] (case and accents ignored), in the sidebar's order.
    static func matching(_ projects: [Project], _ query: String) -> [Project] {
        let clean = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return projects }
        return projects.filter { $0.name.range(of: clean, options: [.caseInsensitive, .diacriticInsensitive]) != nil }
    }

    var body: some View {
        let task = model.task(taskId)
        let shown = Self.matching(model.activeProjects, query)
        VStack(alignment: .leading, spacing: 12) {
            Text(tr("Move “\(task?.title ?? "")” to")).font(.headline).lineLimit(2)
            TextField(tr("Project"), text: $query, prompt: Text(tr("Type to filter")))
                .textFieldStyle(.roundedBorder)
                .onSubmit { if let first = shown.first { move(to: first.localId) } }
            List(selection: $picked) {
                Label(tr("No Project"), systemImage: "circle.dashed").tag(ProjectRules.noProject)
                ForEach(shown) { project in
                    HStack(spacing: 8) {
                        ProjectMark(project: project)
                        Text(project.name)
                        if project.localId == task?.projectLocalId {
                            Spacer()
                            Image(systemName: "checkmark").foregroundStyle(.secondary)
                        }
                    }
                    .tag(project.localId)
                }
            }
            .frame(height: 220)
            .onChange(of: picked) { value in
                if let value { move(to: value == ProjectRules.noProject ? nil : value) }
            }
            HStack {
                Button(tr("New Project…")) {
                    dismiss()
                    model.projectEditor = ProjectEditorRequest()
                }
                Spacer()
                Button(tr("Cancel"), role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
            }
        }
        .padding(18)
        .frame(width: 360)
    }

    private func move(to projectId: String?) {
        model.setProject(taskId, projectId)
        dismiss()
    }
}

/// Delete Project…: where its tasks go (another project or none), then the deletion, once the server has it.
struct DeleteProjectSheet: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let projectId: String
    @State private var target = ProjectRules.noProject
    @State private var deleting = false
    @State private var failure: String?

    var body: some View {
        let project = model.project(projectId)
        let open = model.counts.project(projectId).open
        VStack(alignment: .leading, spacing: 14) {
            Text(tr("Delete “\(project?.name ?? "")”?")).font(.title3.bold())
            Text(open > 0
                ? tr("Its \(open) open tasks and the done ones stay; choose where they go.")
                : tr("Its tasks stay; choose where they go."))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Picker(tr("Move the tasks to"), selection: $target) {
                Text(tr("No Project")).tag(ProjectRules.noProject)
                ForEach(model.activeProjects.filter { $0.localId != projectId }) { other in
                    Text(other.name).tag(other.localId)
                }
            }
            if let failure { Problem(text: failure) }
            HStack {
                Spacer()
                if deleting { ProgressView().controlSize(.small) }
                Button(tr("Cancel"), role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button(tr("Delete Project"), role: .destructive) { delete() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(deleting)
            }
        }
        .padding(20)
        .frame(width: 420)
    }

    private func delete() {
        deleting = true
        failure = nil
        Task {
            failure = await model.deleteProject(projectId, moveTasksTo: target == ProjectRules.noProject ? nil : target)
            deleting = false
            if failure == nil { dismiss() }
        }
    }
}
