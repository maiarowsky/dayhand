import DayhandCore
import DayhandLocalization
import SwiftUI

/**
 * A task's change history for its details: the cached copy from the database (so it shows offline), fetched again
 * from the server when the details open, when the connection comes back and on Sync Now.
 */
@MainActor
final class HistoryModel: ObservableObject {
    @Published private(set) var entries: [HistoryEntry] = []
    @Published private(set) var state: HistoryState = .loading

    /// What a fresh fetch depends on: the server id, and `AppModel.historyRefreshRevision`.
    struct RefreshKey: Hashable {
        let serverId: String?
        let revision: Int
    }

    /// The cached history of [serverId], again after each change, until the view goes.
    func watchHistory(_ serverId: String?, in repository: TaskRepository) async {
        guard let serverId else {
            entries = []
            return
        }
        do {
            for try await events in repository.observeHistory(serverId) { entries = events.map(\.entry) }
        } catch {
            // The observation ends when the view goes; the last copy shown stays until then.
        }
    }

    func refresh(_ serverId: String?, with model: AppModel) async {
        let next = await model.refreshHistory(serverId)
        guard !Task.isCancelled else { return }
        state = next
    }
}

/// Who changed what and when, newest first.
struct HistorySection: View {
    @EnvironmentObject private var model: AppModel
    @ObservedObject var history: HistoryModel
    let today: String

    var body: some View {
        PanelGroup(title: tr("History")) {
            VStack(alignment: .leading, spacing: 10) {
                if let text = HistoryText.placeholder(history.state, isEmpty: history.entries.isEmpty) {
                    Placeholder(text: text)
                }
                ForEach(Array(history.entries.enumerated()), id: \.offset) { _, entry in
                    HistoryRow(entry: entry, today: today, settings: model.settings)
                }
            }
        }
    }

    private struct Placeholder: View {
        let text: String

        var body: some View {
            Text(text).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// One change: who and when, the action, and each field from its old value to the new one.
struct HistoryRow: View {
    let entry: HistoryEntry
    let today: String
    let settings: ReminderSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(HistoryText.actor(entry.actor))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(isAgent ? Color.orange : Color.secondary)
                Text(HistoryText.time(entry.at, today: today, timezone: settings.timezone))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(HistoryText.action(entry.action))
            ForEach(entry.changes, id: \.field) { change in
                Text(HistoryText.change(change, today: today, defaultReminders: settings.reminderMinutes))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private var isAgent: Bool {
        if case .agent = entry.actor { return true }
        return false
    }
}

/// How a history entry reads, in the current language (the Android app's `TaskHistory.kt`).
enum HistoryText {
    /// Long texts (a note, a checklist) are cut to this many characters.
    static let maxShown = 80

    static func placeholder(_ state: HistoryState, isEmpty: Bool) -> String? {
        switch state {
        case .notOnServerYet: return tr("The history starts once this task reaches the server.")
        case .cached:
            return isEmpty
                ? tr("History is unavailable offline.")
                : tr("Offline: this is the history from the last connection.")
        case .fresh: return isEmpty ? tr("No changes recorded yet.") : nil
        case .loading: return nil
        }
    }

    static func actor(_ actor: HistoryActor) -> String {
        switch actor {
        case .app: return tr("You (app)")
        case .cli: return tr("You (CLI)")
        case .agent(let name): return name.map { tr("Agent: \($0)") } ?? tr("Agent")
        }
    }

    /// "Today, 14:02" in the server's time zone.
    static func time(_ at: Int64, today: String, timezone: String) -> String {
        let local = HelmDates.localAt(at, timezone)
        return Formatting.pair(Formatting.day(local.date.description, today: today), DateText.time(local.time.description))
    }

    static func action(_ action: String) -> String {
        switch action {
        case "create": return tr("Created")
        case "update": return tr("Edited")
        case "setStatus": return tr("Moved on the board")
        case "setNow": return tr("Now changed")
        case "complete": return tr("Marked done")
        case "archive": return tr("Archived")
        case "delete": return tr("Moved to the trash")
        case "restore": return tr("Restored")
        case "repeat": return tr("Created as the next repeat")
        case "claim": return tr("Claimed")
        case "renewClaim": return tr("Claim renewed")
        case "release": return tr("Claim ended")
        default: return action
        }
    }

    /// "Day: Today → Tomorrow".
    static func change(_ change: FieldChange, today: String, defaultReminders: [Int]) -> String {
        let before = value(change.field, change.before, today: today, defaultReminders: defaultReminders)
        let after = value(change.field, change.after, today: today, defaultReminders: defaultReminders)
        return tr("\(name(change.field)): \(before) → \(after)")
    }

    static func name(_ field: HistoryField) -> String {
        switch field {
        case .title: return tr("Title")
        case .status: return tr("Status")
        case .now: return tr("Now")
        case .dueDate: return tr("Day")
        case .dueTime: return tr("Time")
        case .repeat: return tr("Repeat")
        case .links: return tr("Links")
        case .checklist: return tr("Checklist")
        case .reminders: return tr("Reminders")
        case .note: return tr("Note")
        case .resumeNote: return tr("Where I stopped")
        }
    }

    /// A field's value as text; long texts are cut, shapes Dayhand does not know are shown as they came.
    static func value(_ field: HistoryField, _ value: JSONValue, today: String, defaultReminders: [Int]) -> String {
        // No reminders of its own means the defaults from the settings, unlike an empty list.
        if field == .reminders, value.isNull { return Formatting.reminders(nil, defaults: defaultReminders) }
        if value.isNull || value.array?.isEmpty == true { return tr("none") }
        let text: String?
        switch field {
        case .status: text = value.string.map { status(TaskStatus.fromWire($0)) }
        case .now: text = value.bool.map { $0 ? tr("yes") : tr("no") }
        case .dueDate: text = value.string.flatMap { CivilDate($0) == nil ? nil : Formatting.day($0, today: today) }
        case .dueTime: text = value.string.map(DateText.time)
        case .repeat: text = RepeatRule.parse(value).map(Formatting.repeatRule)
        case .links: text = value.array.map { $0.compactMap(TaskLink.parse).map { $0.title ?? $0.url }.joined(separator: DateText.listSeparator) }
        case .checklist:
            text = value.array.map { items in
                shorten(items.compactMap(ChecklistItem.parse).map { $0.done ? "✓ \($0.title)" : $0.title }.joined(separator: DateText.listSeparator))
            }
        case .reminders: text = value.array.map { Formatting.reminders($0.compactMap(TaskReminder.parse), defaults: defaultReminders) }
        case .title, .note, .resumeNote: text = value.string.map(shorten)
        }
        return text ?? value.encoded()
    }

    static func status(_ status: TaskStatus) -> String {
        switch status {
        case .todo: return tr("To do")
        case .doing: return tr("In progress")
        case .done: return tr("Done")
        }
    }

    static func shorten(_ text: String) -> String {
        text.count <= maxShown ? text : String(text.prefix(maxShown)).trimmingCharacters(in: .whitespaces) + "…"
    }
}
