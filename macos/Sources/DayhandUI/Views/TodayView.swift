import DayhandCore
import DayhandLocalization
import SwiftUI

/**
 * Today as an agenda: the title and the day, a strip of the coming days, one sentence about the day, quick add, then
 * the tasks by time (the now task first, the ones without a time under "Any time", done today folded). A later day
 * picked in the strip takes today's place the same way until Back to Today. Beside it, in
 * the list view and while the window is wide enough, "To plan" holds the overdue tasks, those without a day and the
 * next days'; in a narrower window the overdue tasks come back to the top of the agenda.
 */
struct TodayView: View {
    @EnvironmentObject private var model: AppModel

    /// The width of the main area from which "To plan" sits beside the agenda.
    static let sideColumnFrom: CGFloat = 740
    static let sideColumnWidth: CGFloat = 290
    /// Below this height the day strip makes room for the tasks.
    static let stripFrom: CGFloat = 560

    var body: some View {
        GeometryReader { geometry in
            let list = !model.showsBoard
            let side = list && geometry.size.width >= Self.sideColumnFrom
            HStack(spacing: 0) {
                TodayAgenda(showsOverdue: !side, showsStrip: geometry.size.height >= Self.stripFrom)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(list ? Color.card : .clear)
                if side {
                    Rectangle().fill(PlannerStyle.line).frame(width: 1).accessibilityHidden(true)
                    ToPlanColumn().frame(width: Self.sideColumnWidth)
                }
            }
        }
        .onAppear { model.refreshHealth(afterNanoseconds: 0) }
    }
}

/// The middle of Today: its heading, the strip of days, the sentence about the day, quick add and the tasks.
struct TodayAgenda: View {
    @EnvironmentObject private var model: AppModel
    let showsOverdue: Bool
    let showsStrip: Bool

    var body: some View {
        let preview = model.previewSections
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                TodayTitle()
                if showsStrip { DayStrip(days: model.overview.days, picked: model.shownDay).padding(.top, 10) }
                Group {
                    if preview == nil { DaySummary() } else { PickedDaySummary() }
                }
                .padding(.top, showsStrip ? 14 : 10)
                InlineQuickAdd(day: model.shownDay).padding(.top, 12).padding(.bottom, 6)
            }
            .padding(.horizontal, TodayStyle.margin)
            if let preview {
                TodayTasks(sections: preview, showsOverdue: false)
            } else if model.showsBoard {
                BoardView()
            } else {
                TodayTasks(sections: model.searchedToday, showsOverdue: showsOverdue)
            }
        }
    }
}

/// "Today", or the day picked in the strip, and its date on one line; a picked day offers the way back to today.
struct TodayTitle: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        let day = model.shownDay
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(heading(day)).font(.system(size: 28, weight: .bold)).accessibilityAddTraits(.isHeader)
            Text(DateText.longDay(day)).font(.title3).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 0)
            if model.previewDay != nil {
                Button { model.preview(model.today) } label: {
                    Label(tr("Back to Today"), systemImage: "arrow.uturn.backward")
                }
                .keyboardShortcut(model.selection == nil && model.search.isEmpty ? .cancelAction : nil)
                .help(tr("Shows today again (Esc)"))
            }
        }
        .padding(.top, 16)
    }

    private func heading(_ day: String) -> String {
        if day == model.today { return tr("Today") }
        if day == HelmDates.addDays(model.today, 1) { return tr("Tomorrow") }
        return CivilDate(day).flatMap { DateText.weekday($0.weekday) } ?? day
    }
}

/// The tasks of the day Today shows by time, as a list that keeps selection, the keyboard and the context menus.
struct TodayTasks: View {
    @EnvironmentObject private var model: AppModel
    let sections: TodaySections
    let showsOverdue: Bool
    @State private var showDone = false

    var body: some View {
        let s = sections
        let isToday = s.date == model.today
        let timed = s.today.filter { $0.dueTime != nil }
        let anyTime = s.today.filter { $0.dueTime == nil }
        if s.now == nil && s.today.isEmpty && s.done.isEmpty && (!showsOverdue || s.overdue.isEmpty) {
            if model.isSearching {
                PlaceEmpty(icon: "magnifyingglass", text: tr("No task matches the search."))
            } else if isToday {
                EmptyToday()
            } else {
                PlaceEmpty(icon: "calendar", text: tr("Nothing planned for this day."))
            }
        } else {
            List(selection: $model.selection) {
                if showsOverdue && !s.overdue.isEmpty {
                    Section {
                        ForEach(s.overdue) { TodayRow(task: $0, today: model.today, overdue: true).tag($0.localId) }
                    } header: {
                        Text(tr("Overdue (\(s.overdue.count))")).foregroundStyle(Color.overdue).padding(.leading, TodayStyle.titleInset)
                    }
                }
                Section {
                    if let now = s.now { TodayNowRow(task: now, today: model.today).tag(now.localId) }
                    if isToday, let placeholder = model.todayPlaceholder {
                        Text(placeholder).foregroundStyle(.secondary).padding(.leading, TodayStyle.titleInset)
                    }
                    ForEach(timed) { TodayRow(task: $0, today: model.today).tag($0.localId) }
                }
                if !anyTime.isEmpty {
                    Section {
                        ForEach(anyTime) { TodayRow(task: $0, today: model.today).tag($0.localId) }
                    } header: {
                        if !timed.isEmpty || s.now != nil { Text(tr("Any time")).padding(.leading, TodayStyle.titleInset) }
                    }
                }
                if !s.done.isEmpty {
                    Section {
                        if showDone {
                            ForEach(s.done) { TodayRow(task: $0, today: model.today).tag($0.localId) }
                        }
                    } header: {
                        FoldHeader(title: tr("Done (\(s.done.count))"), open: $showDone,
                                   hint: showDone ? tr("Hides the done tasks") : tr("Shows the done tasks"))
                            .padding(.leading, TodayStyle.titleInset)
                    }
                }
            }
            .listStyle(.inset)
            .scrollContentBackground(.hidden)
            .padding(.horizontal, TodayStyle.margin - 14)
            .moveButton(for: showsOverdue ? model.selection.flatMap { id in s.overdue.contains { $0.localId == id } ? id : nil } : nil)
        }
    }
}

/// A section title that folds the section under it.
struct FoldHeader: View {
    let title: String
    @Binding var open: Bool
    let hint: String

    var body: some View {
        Button { open.toggle() } label: {
            Label(title, systemImage: open ? "chevron.down" : "chevron.right")
        }
        .buttonStyle(.plain)
        .accessibilityHint(hint)
    }
}

extension View {
    /// A list on a card of the main area, inset from its edges, so every place lines up.
    func cardList() -> some View {
        listStyle(.inset)
            .scrollContentBackground(.hidden)
            .background(Color.card, in: RoundedRectangle(cornerRadius: Metrics.radius))
            .overlay(RoundedRectangle(cornerRadius: Metrics.radius).strokeBorder(PlannerStyle.line, lineWidth: 0.5))
            .padding(.horizontal, Metrics.gutter)
            .padding(.bottom, 12)
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
            .padding(.horizontal, Metrics.gutter)
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
