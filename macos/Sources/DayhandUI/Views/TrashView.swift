import DayhandCore
import DayhandLocalization
import SwiftUI

/// The trash: the deleted tasks, the most recent first, each with the day it goes for good and **Restore**, as on the
/// phone. A selected task opens read-only in the details.
struct TrashView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            StatusLine()
            List(selection: $model.selection) {
                Section {
                    ForEach(model.trash) { task in
                        TrashRow(task: task, today: model.today).tag(task.localId)
                    }
                } header: {
                    Text(model.trashHeader)
                }
            }
            .listStyle(.sidebar)
        }
        .navigationTitle(tr("Trash"))
    }
}

/// A task in the trash: its title, when it was deleted and when it goes for good, and **Restore**.
struct TrashRow: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem
    let today: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(task.title).foregroundStyle(.primary).lineLimit(2)
                if let dates = Formatting.trashDates(task, today: today, timezone: model.settings.timezone) {
                    Text(dates).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 4)
            Button(tr("Restore")) { model.restore(task.localId) }
                .buttonStyle(.borderless)
                .controlSize(.small)
                .accessibilityLabel(tr("Restore \(task.title)"))
        }
        .padding(.vertical, 2)
        .contextMenu {
            Button(tr("Restore")) { model.restore(task.localId) }
        }
    }
}
