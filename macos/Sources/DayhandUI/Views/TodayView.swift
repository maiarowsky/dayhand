import DayhandCore
import DayhandLocalization
import SwiftUI

/// Today, top to bottom: the plan health card, quick add, then overdue, now, today and done (folded), as on the phone.
struct TodayView: View {
    @EnvironmentObject private var model: AppModel
    @State private var showDone = false

    var body: some View {
        let s = model.searchedToday
        VStack(spacing: 0) {
            PlaceHeader(title: tr("Today"), subtitle: DateText.longDay(s.date))
            HealthCard()
            InlineQuickAdd()
                .padding(.horizontal, Metrics.gutter)
                .padding(.vertical, 8)
            if model.viewMode == .board {
                BoardView()
            } else if s.isEmpty && s.done.isEmpty {
                if model.isSearching {
                    PlaceEmpty(icon: "magnifyingglass", text: tr("No task matches the search."))
                } else {
                    EmptyToday()
                }
            } else {
                List(selection: $model.selection) {
                    if !s.overdue.isEmpty {
                        Section {
                            ForEach(s.overdue) { task in
                                TaskRow(task: task, today: s.date, overdue: true, showsDay: false).tag(task.localId)
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
                        if let placeholder = model.todayPlaceholder {
                            Text(placeholder).foregroundStyle(.secondary)
                        }
                        ForEach(s.today) { task in
                            TaskRow(task: task, today: s.date, showsDay: false).tag(task.localId)
                        }
                    }
                    if !s.done.isEmpty {
                        Section {
                            if showDone {
                                ForEach(s.done) { task in
                                    TaskRow(task: task, today: s.date, showsDay: false).tag(task.localId)
                                }
                            }
                        } header: {
                            FoldHeader(title: tr("Done (\(s.done.count))"), open: $showDone,
                                       hint: showDone ? tr("Hides the tasks done today") : tr("Shows the tasks done today"))
                        }
                    }
                }
                .cardList()
            }
        }
        .onAppear { model.refreshHealth(afterNanoseconds: 0) }
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
