import DayhandCore
import DayhandLocalization
import SwiftUI

/// The main window: Today or the trash on the left, the selected task's details on the right.
struct MainWindow: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        NavigationSplitView {
            Sidebar()
                .navigationSplitViewColumnWidth(min: 320, ideal: 380, max: 520)
        } detail: {
            if let id = model.selection, let task = model.task(id) {
                TaskDetailView(task: task)
                    .id(task.localId)
            } else {
                Text(tr("Select a task to see its details."))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .toolbar {
            ToolbarItem {
                Button { QuickAddPanel.shared.show() } label: { Label(tr("New Task"), systemImage: "plus") }
                    .help(tr("New task (⌘N, or the quick add shortcut from any app)"))
            }
        }
        .sheet(isPresented: $model.showConnect) {
            ConnectView()
                .environmentObject(model)
        }
        .alert(Text(verbatim: "Dayhand"), isPresented: Binding(get: { model.alert != nil }, set: { if !$0 { model.alert = nil } })) {
            Button(tr("OK")) { model.alert = nil }
        } message: {
            Text(model.alert ?? "")
        }
        .onAppear { model.openMainWindow = { openWindow(id: "main") } }
    }
}

/// The left column: a choice between Today and the trash above the chosen list, and the update button in its bottom
/// corner while a newer version is known.
struct Sidebar: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            Picker(tr("Show"), selection: Binding(get: { model.place }, set: { model.show($0) })) {
                Text(tr("Today")).tag(Place.today)
                Text(tr("Trash")).tag(Place.trash)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(12)
            switch model.place {
            case .today: TodayView()
            case .trash: TrashView()
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { UpdateCorner() }
    }
}

/// Today, top to bottom: overdue, now, today, done (folded), as on the phone.
struct TodayView: View {
    @EnvironmentObject private var model: AppModel
    @State private var showDone = false

    var body: some View {
        let s = model.sections
        VStack(spacing: 0) {
            StatusLine()
            HealthCard()
            InlineQuickAdd()
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            Divider()
            if s.isEmpty && s.done.isEmpty {
                EmptyToday()
            } else {
                List(selection: $model.selection) {
                    if !s.overdue.isEmpty {
                        Section {
                            ForEach(s.overdue) { task in
                                TaskRow(task: task, today: s.date, overdue: true).tag(task.localId)
                            }
                        } header: {
                            Text(tr("Overdue (\(s.overdue.count))")).foregroundStyle(Color.overdue)
                        }
                    }
                    if let now = s.now {
                        Section(tr("Now")) {
                            NowRow(task: now, today: s.date).tag(now.localId)
                        }
                    }
                    Section(tr("Today")) {
                        if s.today.isEmpty {
                            Text(s.overdue.isEmpty && s.now == nil ? tr("Nothing left for today.") : tr("Nothing else planned for today."))
                                .foregroundStyle(.secondary)
                        }
                        ForEach(s.today) { task in
                            TaskRow(task: task, today: s.date).tag(task.localId)
                        }
                    }
                    if !s.done.isEmpty {
                        Section {
                            if showDone {
                                ForEach(s.done) { task in
                                    TaskRow(task: task, today: s.date).tag(task.localId)
                                }
                            }
                        } header: {
                            Button { showDone.toggle() } label: {
                                Label(tr("Done (\(s.done.count))"), systemImage: showDone ? "chevron.down" : "chevron.right")
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint(showDone ? tr("Hides the tasks done today") : tr("Shows the tasks done today"))
                        }
                    }
                }
                .listStyle(.sidebar)
            }
        }
        .navigationTitle(tr("Today"))
        .onAppear { model.refreshHealth(afterNanoseconds: 0) }
    }
}

/// One line about the connection when there is something to say (offline, sending, signed out).
struct StatusLine: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        if let text = Formatting.status(model.status, pending: model.pending, useOffline: model.useOffline, projectSupport: model.projectSupport) {
            HStack(spacing: 8) {
                Image(systemName: icon).foregroundStyle(.secondary)
                // Wraps without fixedSize: a fixed height is measured at the split view's narrowest width, many lines
                // tall, which made the window's content taller than the window and slid it under the title bar.
                Text(text).font(.callout).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                if model.credential == nil {
                    Button(tr("Connect…")) { model.showConnect = true }.controlSize(.small)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.quaternary.opacity(0.5))
        }
    }

    private var icon: String {
        switch model.status {
        case .offline: return "wifi.slash"
        case .signedOut: return "person.crop.circle.badge.exclamationmark"
        case .notConnected: return "icloud.slash"
        case .connecting, .synced: return "arrow.triangle.2.circlepath"
        }
    }
}

struct EmptyToday: View {
    var body: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "sun.max").font(.system(size: 36)).foregroundStyle(.secondary)
            Text(tr("Nothing planned for today.")).font(.title3)
            Button(tr("Add Task")) { QuickAddPanel.shared.show() }
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

/// A task on Today: a box to tick it off, its title, when, and a menu of the moves Today offers.
struct TaskRow: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem
    let today: String
    var overdue = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            DoneBox(task: task)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title)
                    .strikethrough(task.status == .done)
                    .foregroundStyle(task.status == .done ? .secondary : .primary)
                    .lineLimit(2)
                let details = detailLine
                if !details.isEmpty {
                    Text(details).font(.caption).foregroundStyle(overdue ? Color.overdue : .secondary)
                }
            }
            Spacer(minLength: 4)
            if overdue {
                Button(tr("To today")) { model.moveToToday(task.localId) }
                    .buttonStyle(.borderless)
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 2)
        .contextMenu { TaskMenu(task: task) }
        .accessibilityElement(children: .combine)
    }

    private var detailLine: String {
        var parts: [String] = []
        if overdue, let due = Formatting.due(task, today: today) {
            parts.append(due)
        } else if let time = task.dueTime, task.dueDate == today {
            parts.append(DateText.time(time))
        }
        if task.repeat != nil { parts.append("↻") }
        if !task.checklist.isEmpty { parts.append("\(task.checklist.filter(\.done).count)/\(task.checklist.count)") }
        parts.append(contentsOf: task.labels.map { "#\($0)" })
        return parts.joined(separator: "  ")
    }
}

/// The "now" task with "where I stopped" under its title.
struct NowRow: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem
    let today: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            DoneBox(task: task)
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title).fontWeight(.semibold).foregroundStyle(.primary)
                Text(task.resumeNote.map { tr("Where I stopped: \($0)") } ?? tr("Where I stopped: add a note in the details"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            Button(tr("Not now")) { model.clearNow() }
                .buttonStyle(.borderless)
                .controlSize(.small)
        }
        .padding(.vertical, 2)
        .contextMenu { TaskMenu(task: task) }
    }
}

struct DoneBox: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem

    var body: some View {
        Button { model.toggleDone(task) } label: {
            Image(systemName: task.status == .done ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 15))
                .foregroundStyle(task.status == .done ? Color.accentColor : .secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(task.status == .done ? tr("Mark as not done") : tr("Mark as done"))
    }
}

/// The moves of a task, shared by the context menus of Today and the menu bar.
struct TaskMenu: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem

    var body: some View {
        Button(task.status == .done ? tr("Mark as Not Done") : tr("Mark as Done")) { model.toggleDone(task) }
        if task.status != .done {
            if task.isNow {
                Button(tr("Not Now")) { model.clearNow() }
            } else {
                Button(tr("Work on It Now")) { model.setNow(task.localId) }
            }
            Divider()
            Button(tr("To Today")) { model.moveToToday(task.localId) }
            Button(tr("To Tomorrow")) { model.moveToTomorrow(task.localId) }
        }
        Divider()
        Button(tr("Archive")) { model.archive(task.localId) }
        Button(tr("Move to Trash")) { model.moveToTrash(task.localId) }
    }
}
