import AppKit
import DayhandCore
import DayhandLocalization
import SwiftUI

/**
 * What the Task menu does to the selected task, and its key. Each key has one meaning in the app: ⌘T is To Today
 * here, in the context menus and on the Move button alike.
 */
enum TaskCommand: CaseIterable {
    case toggleDone, toggleNow, toToday, toTomorrow, anotherDay, moveToTrash

    var key: KeyEquivalent? {
        switch self {
        case .toggleDone: return .return
        case .toToday, .toTomorrow, .anotherDay: return "t"
        case .moveToTrash: return .delete
        case .toggleNow: return nil
        }
    }

    var modifiers: EventModifiers {
        switch self {
        case .toTomorrow: return [.command, .shift]
        case .anotherDay: return [.command, .option]
        default: return .command
        }
    }

    func title(_ task: TaskItem?) -> String {
        switch self {
        case .toggleDone: return task?.status == .done ? tr("Mark as Not Done") : tr("Mark as Done")
        case .toggleNow: return task?.isNow == true ? tr("Not Now") : tr("Work on It Now")
        case .toToday: return tr("To Today")
        case .toTomorrow: return tr("To Tomorrow")
        case .anotherDay: return tr("Another Day…")
        case .moveToTrash: return tr("Move to Trash")
        }
    }

    func isEnabled(_ task: TaskItem?) -> Bool {
        guard let task, !task.inTrash else { return false }
        switch self {
        case .toggleDone, .moveToTrash: return true
        case .toggleNow: return task.status != .done
        case .toToday, .toTomorrow, .anotherDay: return task.isOpen
        }
    }

    @MainActor
    func perform(_ task: TaskItem, in model: AppModel) {
        switch self {
        case .toggleDone: model.toggleDone(task)
        case .toggleNow: task.isNow ? model.clearNow() : model.setNow(task.localId)
        case .toToday: model.moveToToday(task.localId)
        case .toTomorrow: model.moveToTomorrow(task.localId)
        case .anotherDay: model.reschedulingTask = TaskPick(id: task.localId)
        case .moveToTrash:
            model.moveToTrash(task.localId)
            model.selection = nil
        }
    }

    /**
     * Runs the command on the selected task. ⌘⌫ and ⌘↩ typed in a text field belong to the text: ⌘⌫ deletes to the
     * start of the line there and ⌘↩ does nothing, so typing in the details never trashes or ticks off the task.
     */
    @MainActor
    func run(in model: AppModel) {
        if self == .toggleDone || self == .moveToTrash, let field = Self.typingField {
            if self == .moveToTrash { field.deleteToBeginningOfLine(nil) }
            return
        }
        guard let task = model.selection.flatMap(model.task), isEnabled(task) else { return }
        perform(task, in: model)
    }

    /// The text field being typed in, when the menu command came from a key.
    @MainActor
    private static var typingField: NSTextView? {
        guard NSApp?.currentEvent?.type == .keyDown,
              let field = NSApp?.keyWindow?.firstResponder as? NSTextView, field.isEditable else { return nil }
        return field
    }
}

/// The Task menu: the moves of the selected task with their keys, then its project and syncing.
struct TaskCommands: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        let task = model.selection.flatMap(model.task)
        command(.toggleDone, task)
        command(.toggleNow, task)
        Divider()
        command(.toToday, task)
        command(.toTomorrow, task)
        command(.anotherDay, task)
        Divider()
        Button(tr("Move to Project…")) {
            if let id = model.selection { model.movingTask = TaskPick(id: id) }
        }
        .keyboardShortcut("m", modifiers: [.command, .shift])
        .disabled(!model.canMoveToProject(model.selection))
        Button(tr("New Project…")) {
            model.showMainWindow()
            model.projectEditor = ProjectEditorRequest()
        }
        .keyboardShortcut("n", modifiers: [.command, .option])
        .disabled(!model.showsProjects)
        Divider()
        command(.moveToTrash, task)
        Divider()
        Button(tr("Sync Now")) { Task { await model.syncNow() } }
            .keyboardShortcut("r")
            .disabled(model.credential == nil)
    }

    @ViewBuilder
    private func command(_ command: TaskCommand, _ task: TaskItem?) -> some View {
        let button = Button(command.title(task)) { command.run(in: model) }.disabled(!command.isEnabled(task))
        if let key = command.key { button.keyboardShortcut(key, modifiers: command.modifiers) } else { button }
    }
}
