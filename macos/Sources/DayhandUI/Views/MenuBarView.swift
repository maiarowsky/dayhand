import DayhandCore
import DayhandLocalization
import SwiftUI

/// The menu bar window: quick add, and today's open tasks to tick off without opening the app.
struct MenuBarView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow

    static let maxRows = 12

    var body: some View {
        let s = model.sections
        let rows = Array((s.overdue.map { ($0, true) } + (s.now.map { [($0, false)] } ?? []) + s.today.map { ($0, false) }).prefix(Self.maxRows))
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(tr("Today")).font(.headline)
                Spacer()
                Text(summary(s)).font(.caption).foregroundStyle(.secondary)
            }
            InlineQuickAdd()
            Divider()
            if rows.isEmpty {
                Text(s.done.isEmpty ? tr("Nothing planned for today.") : tr("All done for today."))
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 4)
            } else {
                ForEach(rows, id: \.0.localId) { task, overdue in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        DoneBox(task: task)
                        Text(task.title).lineLimit(1)
                        Spacer(minLength: 4)
                        Text(overdue ? (Formatting.due(task, today: s.date) ?? "") : (task.isNow ? tr("now") : task.dueTime.map(DateText.time) ?? ""))
                            .font(.caption)
                            .foregroundStyle(overdue ? Color.overdue : .secondary)
                    }
                    .contextMenu { TaskMenu(task: task) }
                }
                let more = s.openCount - rows.count
                if more > 0 { Text(tr("and \(more) more")).font(.caption).foregroundStyle(.secondary) }
            }
            if let status = Formatting.status(model.status, pending: model.pending, useOffline: model.useOffline) {
                Divider()
                Text(status).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Divider()
            HStack {
                Button(tr("Open Dayhand")) {
                    model.openMainWindow = { openWindow(id: "main") }
                    model.showMainWindow()
                }
                Spacer()
                Button(tr("Quit")) { NSApp.terminate(nil) }
            }
            .buttonStyle(.borderless)
        }
        .padding(12)
        .frame(width: 340)
        .onAppear { if model.openMainWindow == nil { model.openMainWindow = { openWindow(id: "main") } } }
    }

    private func summary(_ s: TodaySections) -> String {
        var parts = [tr("\(s.openCount) open")]
        if !s.overdue.isEmpty { parts.append(tr("\(s.overdue.count) overdue")) }
        if !s.done.isEmpty { parts.append(tr("\(s.done.count) done")) }
        return parts.joined(separator: " · ")
    }
}
