import DayhandCore
import DayhandLocalization
import SwiftUI

/**
 * The selected task's details in a panel along the bottom of the main area: the title, status, **Work on It Now** and
 * close at the top; Details (day, reminders, repeat, project), the checklist and the note side by side; then
 * what agents set (read-only), the history and archive or trash. The panel's top edge drags it taller or shorter.
 */
struct TaskPanel: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem
    /// The height of the area the panel sits in; it leaves room above for the list.
    let available: CGFloat
    /// A height that overrides the one the user left (the snapshot tool draws the whole panel).
    var pinnedHeight: Double?

    /// The height the user dragged the panel to; 0 until they do, for a height that follows the window.
    @AppStorage("taskPanelHeight") private var height = 0.0
    @State private var dragStart: Double?
    @State private var title = ""
    @State private var note = ""
    @State private var resumeNote = ""
    @State private var newItem = ""
    @State private var confirmTrash = false
    @StateObject private var history = HistoryModel()
    @FocusState private var focus: FieldName?

    enum FieldName: Hashable { case title, resume, note, item }

    static let minHeight = 200.0
    /// Room the list above keeps when the panel is dragged up.
    static let listRoom = 170.0

    var body: some View {
        let today = model.today
        VStack(spacing: 0) {
            handle
            header
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if task.inTrash { trashBanner }
                    Group {
                        AdaptiveColumns(minWidth: 230, spacing: 28, weights: [1.4, 1, 1]) {
                            PanelGroup(title: tr("Details")) { TaskFacts(task: task, today: today) }
                            PanelGroup(title: tr("Checklist"), trailing: checklistCount) { checklist }
                            PanelGroup(title: tr("Note")) { noteEditor }
                        }
                        AgentSection(task: task, today: today)
                    }
                    .disabled(task.inTrash)
                    HistorySection(history: history, today: today)
                    footer
                }
                .padding(.horizontal, Metrics.gutter)
                .padding(.vertical, 14)
            }
        }
        .frame(height: shownHeight)
        .frame(maxWidth: .infinity)
        .background(
            TopRoundedRectangle(radius: 14)
                .fill(Color.card)
                .shadow(color: .black.opacity(0.12), radius: 8, y: -2)
        )
        .task(id: task.serverId) { await history.watchHistory(task.serverId, in: model.repository) }
        .task(id: HistoryModel.RefreshKey(serverId: task.serverId, revision: model.historyRefreshRevision)) {
            await history.refresh(task.serverId, with: model)
        }
        .onAppear(perform: load)
        .onChange(of: task) { _ in load() }
        .onChange(of: focus) { [focus] _ in saveLeaving(focus) }
        .onDisappear(perform: saveOpenFields)
        .onExitCommand { model.selection = nil }
        .confirmationDialog(tr("Move “\(task.title)” to the trash?"), isPresented: $confirmTrash) {
            Button(tr("Move to Trash"), role: .destructive) {
                model.moveToTrash(task.localId)
                model.selection = nil
            }
        } message: {
            Text(tr("It stays in the trash for 30 days."))
        }
    }

    private var shownHeight: Double {
        if let pinnedHeight { return pinnedHeight }
        return Self.height(stored: height, available: available)
    }

    /**
     * The panel's height in an area [available] points tall: the one the user dragged to ([stored], 0 for none), or
     * by default 40% of the area within 200 to 380 points, and never so tall that the list above loses its room.
     */
    static func height(stored: Double, available: Double) -> Double {
        let most = max(minHeight, available - listRoom)
        let wanted = stored > 0 ? stored : min(max(available * 0.4, minHeight), 380)
        return min(max(wanted, minHeight), most)
    }

    /// The grip along the top edge: dragging it changes the panel's height, which is kept for next time.
    private var handle: some View {
        Capsule()
            .fill(Color.secondary.opacity(0.4))
            .frame(width: 36, height: 5)
            .frame(maxWidth: .infinity)
            .frame(height: 14)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { value in
                    let start = dragStart ?? shownHeight
                    dragStart = start
                    height = start - value.translation.height
                }
                .onEnded { _ in
                    height = shownHeight
                    dragStart = nil
                })
            .onHover { inside in inside ? NSCursor.resizeUpDown.push() : NSCursor.pop() }
            .accessibilityHidden(true)
    }

    private var header: some View {
        HStack(spacing: 10) {
            TextField(tr("Title"), text: $title)
                .textFieldStyle(.plain)
                .font(.system(size: 19, weight: .bold))
                .focused($focus, equals: .title)
                .onSubmit(saveTitle)
                .disabled(task.inTrash)
            StatusMenu(task: task)
                .disabled(task.inTrash)
            if task.status != .done && !task.inTrash {
                if task.isNow {
                    Button { model.clearNow() } label: { Label(tr("Not Now"), systemImage: "pause") }
                } else {
                    Button { model.setNow(task.localId) } label: { Label(tr("Work on It Now"), systemImage: "play") }
                        .buttonStyle(.borderedProminent)
                }
            }
            Button { model.selection = nil } label: { Image(systemName: "xmark") }
                .buttonStyle(.borderless)
                .keyboardShortcut(.cancelAction)
                .help(tr("Close the details"))
                .accessibilityLabel(tr("Close the details"))
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.bottom, 10)
    }

    private var trashBanner: some View {
        HStack {
            Image(systemName: "trash").foregroundStyle(.secondary)
            Text(tr("In the trash. It goes for good 30 days after it was deleted."))
            Spacer()
            Button(tr("Restore")) { model.restore(task.localId) }
        }
        .padding(10)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }

    private var checklistCount: String? {
        task.checklist.isEmpty ? nil : "\(task.checklist.filter(\.done).count)/\(task.checklist.count)"
    }

    private var checklist: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(task.checklist) { item in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Button { model.toggleItem(task.localId, item.id) } label: {
                        Image(systemName: item.done ? "checkmark.square.fill" : "square")
                            .foregroundStyle(item.done ? Color.accentColor : .secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(item.done ? tr("Untick \(item.title)") : tr("Tick \(item.title)"))
                    Text(item.title).strikethrough(item.done).foregroundStyle(item.done ? .secondary : .primary)
                    Spacer(minLength: 4)
                    Button { model.removeItem(task.localId, item.id) } label: { Image(systemName: "xmark") }
                        .buttonStyle(.borderless)
                        .foregroundStyle(.tertiary)
                        .accessibilityLabel(tr("Remove \(item.title)"))
                }
            }
            HStack(spacing: 8) {
                Image(systemName: "plus").foregroundStyle(.secondary)
                TextField(tr("New item"), text: $newItem, prompt: Text(tr("Add an item")))
                    .textFieldStyle(.plain)
                    .focused($focus, equals: .item)
                    .onSubmit(addItem)
            }
        }
    }

    private var noteEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            if task.isNow {
                TextField(tr("Where I stopped"), text: $resumeNote, prompt: Text(tr("next step")))
                    .textFieldStyle(.roundedBorder)
                    .focused($focus, equals: .resume)
                    .onSubmit(saveResumeNote)
            }
            TextEditor(text: $note)
                .focused($focus, equals: .note)
                .font(.body)
                .scrollContentBackground(.hidden)
                .padding(6)
                .frame(minHeight: 90)
                .background(Color.canvas, in: RoundedRectangle(cornerRadius: 8))
            ForEach(task.links, id: \.url) { link in
                if let url = URL(string: link.url) {
                    Link(destination: url) {
                        HStack(spacing: 6) {
                            Image(systemName: "link")
                            Text(link.title ?? link.url).lineLimit(1)
                            Spacer(minLength: 4)
                            Image(systemName: "arrow.up.right.square")
                        }
                    }
                    .padding(8)
                    .background(Color.canvas, in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
    }

    private var footer: some View {
        HStack {
            if task.archivedAt == nil {
                Button(tr("Archive")) { model.archive(task.localId) }
            } else {
                Button(tr("Unarchive")) { model.restore(task.localId) }
            }
            Spacer()
            if !task.inTrash {
                Button(tr("Move to Trash"), role: .destructive) { confirmTrash = true }
            }
        }
    }

    // MARK: Saving

    /// Fills the fields from the task; a field being typed in is not overwritten by a sync.
    private func load() {
        if focus != .title { title = task.title }
        if focus != .note { note = task.note ?? "" }
        if focus != .resume { resumeNote = task.resumeNote ?? "" }
    }

    /// A field the user leaves is saved, as if Return was pressed.
    private func saveLeaving(_ field: FieldName?) {
        guard !task.inTrash else { return }
        switch field {
        case .title: saveTitle()
        case .resume: saveResumeNote()
        case .note: saveNote()
        case .item, nil: break
        }
    }

    private func saveTitle() {
        if title.trimmingCharacters(in: .whitespacesAndNewlines) != task.title { model.rename(task.localId, title) }
    }

    private func saveNote() {
        if note != (task.note ?? "") { model.setNote(task.localId, note) }
    }

    private func saveResumeNote() {
        if resumeNote.trimmingCharacters(in: .whitespacesAndNewlines) != (task.resumeNote ?? "") {
            model.setResumeNote(task.localId, resumeNote)
        }
    }

    private func addItem() {
        let clean = newItem.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        model.addItem(task.localId, clean)
        newItem = ""
    }

    private func saveOpenFields() {
        guard !task.inTrash else { return }
        saveTitle()
        saveNote()
    }
}

/// A titled part of the panel.
struct PanelGroup<Content: View>: View {
    let title: String
    var trailing: String?
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(.headline)
                Spacer()
                if let trailing { Text(trailing).font(.callout.monospacedDigit()).foregroundStyle(.secondary) }
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

/// The task's status as a menu, with the status's line icon in its color.
struct StatusMenu: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem

    var body: some View {
        // A menu's label drops its colors, so the status icon sits beside it on a shared background.
        HStack(spacing: 6) {
            Image(systemName: StatusStyle.icon(task.status))
                .foregroundStyle(StatusStyle.color(task.status))
                .accessibilityHidden(true)
            Menu {
                ForEach([TaskStatus.todo, .doing, .done], id: \.self) { status in
                    Button { model.setStatus(task.localId, status) } label: {
                        Label(StatusStyle.name(status), systemImage: StatusStyle.icon(status))
                    }
                }
            } label: {
                Text(StatusStyle.name(task.status))
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .accessibilityLabel(tr("Status: \(StatusStyle.name(task.status))"))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 7))
    }
}

/// A rectangle with its top corners rounded (`UnevenRoundedRectangle` needs macOS 14).
struct TopRoundedRectangle: Shape {
    let radius: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
        path.addArc(center: CGPoint(x: rect.minX + radius, y: rect.minY + radius), radius: radius,
                    startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        path.addLine(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
        path.addArc(center: CGPoint(x: rect.maxX - radius, y: rect.minY + radius), radius: radius,
                    startAngle: .degrees(270), endAngle: .degrees(0), clockwise: false)
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

/**
 * Lays its views out in as many columns as fit at [minWidth] each, row by row. With every view on one row, [weights]
 * share the width (Details wider than the checklist and the note); otherwise the columns are equal.
 */
struct AdaptiveColumns: Layout {
    let minWidth: CGFloat
    let spacing: CGFloat
    var weights: [CGFloat] = []

    private struct Plan {
        let columns: Int
        let widths: [CGFloat]
        let heights: [CGFloat]
    }

    private func plan(_ subviews: Subviews, width: CGFloat) -> Plan {
        let count = subviews.count
        let n = width.isFinite && count > 0 ? max(1, min(count, Int((width + spacing) / (minWidth + spacing)))) : max(count, 1)
        let free = width - spacing * CGFloat(n - 1)
        let shares = n == count && weights.count == count ? weights : Array(repeating: 1, count: n)
        let total = shares.reduce(0, +)
        let widths = shares.map { free * $0 / total }
        let heights = stride(from: 0, to: count, by: n).map { start in
            (start..<min(start + n, count)).map { subviews[$0].sizeThatFits(ProposedViewSize(width: widths[$0 - start], height: nil)).height }.max() ?? 0
        }
        return Plan(columns: n, widths: widths, heights: heights)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? minWidth * CGFloat(subviews.count)
        let plan = plan(subviews, width: width)
        return CGSize(width: width, height: plan.heights.reduce(0, +) + spacing * CGFloat(max(plan.heights.count - 1, 0)))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let plan = plan(subviews, width: bounds.width)
        var y = bounds.minY
        for (row, height) in plan.heights.enumerated() {
            var x = bounds.minX
            for column in 0..<plan.columns {
                let index = row * plan.columns + column
                guard index < subviews.count else { break }
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: plan.widths[column], height: nil))
                x += plan.widths[column] + spacing
            }
            y += height + spacing
        }
    }
}
