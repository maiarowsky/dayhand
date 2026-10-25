import DayhandCore
import DayhandLocalization
import SwiftUI

/**
 * The plan: the week of the place picked in the sidebar as a grid of days and hours, with the place's tasks in a
 * drawer along the bottom. A task dragged from the drawer (or a block from another hour) onto the grid is planned
 * there; onto a project in the sidebar, it moves to the project. A block's details open in a popover.
 */
struct PlanView: View {
    @EnvironmentObject private var model: AppModel
    @State private var weekOffset = 0
    @AppStorage("planDrawerOpen") private var drawerOpen = true

    var body: some View {
        let today = model.today
        let week = (PlanWeek.containing(today) ?? PlanWeek(monday: CivilDate(dayNumber: 0))).shifted(by: weekOffset)
        let plan = model.plan(week)
        GeometryReader { geometry in
            let layout = PlanLayout(height: geometry.size.height)
            content(week: week, plan: plan, today: today, layout: layout)
        }
    }

    private func content(week: PlanWeek, plan: [String: [TaskItem]], today: String, layout: PlanLayout) -> some View {
        VStack(spacing: 0) {
            PlaceHeader(title: PlaceText.title(model.place, model: model), subtitle: week.range) {
                EmptyView()
            } trailing: {
                weekButtons
            }
            // The days' titles are the pinned header of the same scroll view as the hours, so their columns line up
            // whatever the scroller takes.
            ScrollViewReader { reader in
                ScrollView {
                    LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                        Section {
                            HStack(alignment: .top, spacing: 0) {
                                morningAnchor(header: layout.header)
                                hours
                                ForEach(week.days, id: \.dayNumber) { day in
                                    PlanDayColumn(day: day, tasks: plan[day.description] ?? [], isToday: day.description == today)
                                }
                            }
                        } header: {
                            HStack(alignment: .top, spacing: 0) {
                                Color.clear.frame(width: Self.hourColumn)
                                ForEach(week.days, id: \.dayNumber) { day in
                                    PlanDayHeader(day: day, tasks: plan[day.description] ?? [], isToday: day.description == today, limit: layout.untimed)
                                }
                            }
                            .frame(height: layout.header)
                            .background(Color.card)
                            .overlay(alignment: .bottom) { Divider() }
                        }
                    }
                }
                // After the first layout, when the hours are there to scroll to.
                .onAppear { DispatchQueue.main.async { reader.scrollTo(Self.morning, anchor: .top) } }
            }
            .background(Color.card, in: RoundedRectangle(cornerRadius: Metrics.radius))
            .clipShape(RoundedRectangle(cornerRadius: Metrics.radius))
            .padding(.horizontal, Metrics.gutter)
            .padding(.bottom, 10)
            if model.selection == nil {
                PlanDrawer(open: $drawerOpen, height: layout.drawer)
            }
        }
    }

    static let hourColumn: CGFloat = 52
    private static let morning = "morning"

    private var weekButtons: some View {
        HStack(spacing: 6) {
            Button { weekOffset -= 1 } label: { Image(systemName: "chevron.left") }
                .help(tr("Previous week"))
                .accessibilityLabel(tr("Previous week"))
            Button(tr("This Week")) { weekOffset = 0 }
                .disabled(weekOffset == 0)
            Button { weekOffset += 1 } label: { Image(systemName: "chevron.right") }
                .help(tr("Next week"))
                .accessibilityLabel(tr("Next week"))
        }
        .controlSize(.small)
    }

    /// What the plan scrolls to when it opens: scrolled to the top of the window, it puts the morning just under the
    /// days' titles pinned over the hours (so it sits above the grid by their height).
    private func morningAnchor(header: CGFloat) -> some View {
        VStack(spacing: 0) {
            Color.clear.frame(width: 0, height: max(0, CGFloat(PlanGrid.morning - PlanGrid.firstHour) * PlanGrid.hourHeight - header))
            Color.clear.frame(width: 0, height: 1).id(Self.morning)
        }
        .frame(width: 0, height: PlanGrid.height, alignment: .top)
        .accessibilityHidden(true)
    }

    /// The hour labels down the left edge, each hour also a line across the days.
    private var hours: some View {
        VStack(spacing: 0) {
            ForEach(PlanGrid.firstHour..<PlanGrid.lastHour, id: \.self) { hour in
                Text(DateText.time(String(format: "%02d:00", hour)))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .frame(width: Self.hourColumn - 8, height: PlanGrid.hourHeight, alignment: .topTrailing)
                    .padding(.trailing, 8)
                    .padding(.top, 3)
                    .frame(height: PlanGrid.hourHeight, alignment: .top)
            }
        }
        .frame(height: PlanGrid.height, alignment: .top)
        .background(alignment: .topLeading) { hourLines }
    }

    /// One faint line per hour, across the whole grid (drawn under the hour column and running past it).
    private var hourLines: some View {
        VStack(spacing: 0) {
            ForEach(PlanGrid.firstHour..<PlanGrid.lastHour, id: \.self) { _ in
                VStack(spacing: 0) {
                    Rectangle().fill(Color.secondary.opacity(0.15)).frame(height: 1)
                    Spacer(minLength: 0)
                }
                .frame(height: PlanGrid.hourHeight)
            }
        }
        .frame(width: 4000, alignment: .leading)
        .offset(x: Self.hourColumn)
        .allowsHitTesting(false)
    }
}

/// The drawer of the plan: the place's tasks in status columns, to drag onto the week. It folds to its title.
struct PlanDrawer: View {
    @EnvironmentObject private var model: AppModel
    @Binding var open: Bool
    /// The height of the open drawer's columns.
    let height: CGFloat

    var body: some View {
        let board = model.board
        VStack(spacing: 0) {
            Capsule().fill(Color.secondary.opacity(0.4)).frame(width: 36, height: 5).padding(.top, 6)
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(tr("Tasks")).font(.headline)
                Text(tr("Drag to the calendar")).font(.callout).foregroundStyle(.secondary)
                Spacer()
                Button { open.toggle() } label: { Image(systemName: open ? "chevron.down" : "chevron.up") }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(open ? tr("Fold the tasks") : tr("Unfold the tasks"))
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.vertical, 8)
            if open {
                HStack(alignment: .top, spacing: 14) {
                    ForEach([TaskStatus.todo, .doing, .done], id: \.self) { status in
                        DrawerColumn(status: status, tasks: board.tasks(status), count: board.count(status))
                    }
                }
                .padding(.horizontal, Metrics.gutter - BoardColumn.inset)
                .padding(.bottom, 10)
                .frame(height: height)
            }
        }
        .background(
            TopRoundedRectangle(radius: 14)
                .fill(Color.card)
                .shadow(color: .black.opacity(0.10), radius: 6, y: -2)
        )
    }
}

/// A status column of the drawer: compact cards; a card dropped here takes the status.
struct DrawerColumn: View {
    @EnvironmentObject private var model: AppModel
    let status: TaskStatus
    let tasks: [TaskItem]
    /// The column's number: Done counts every done task of the place, also those past the cards shown.
    let count: Int
    @State private var targeted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: StatusStyle.icon(status)).foregroundStyle(StatusStyle.color(status)).accessibilityHidden(true)
                Text(StatusStyle.name(status)).font(.subheadline.weight(.semibold))
                Spacer()
                CountPill(count: count, tint: StatusStyle.color(status))
            }
            .padding(.horizontal, 4)
            ScrollView {
                LazyVStack(spacing: 6) {
                    ForEach(tasks) { DrawerCard(task: $0) }
                }
            }
        }
        .padding(BoardColumn.inset)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(RoundedRectangle(cornerRadius: 10).fill(targeted ? Color.accentColor.opacity(0.08) : StatusStyle.color(status).opacity(0.06)))
        .dropDestination(for: String.self) { items, _ in
            guard let id = items.lazy.compactMap(TaskDrag.localId).first else { return false }
            return model.drop(id, onColumn: status)
        } isTargeted: { targeted = $0 }
    }
}

/// A task in the drawer: a bar of its color, a grip, its title and project, and its day (beside them, or under the
/// title when the column is narrow).
struct DrawerCard: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem

    var body: some View {
        let day = task.dueDate.map { Formatting.day($0, today: model.today) }
        let tint = HelmDates.isOverdue(task, today: model.today) && task.status != .done ? Color.overdue : nil
        let project = model.projectLine(task)
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                grip
                VStack(alignment: .leading, spacing: 1) {
                    title
                    if let project { Text(project.name).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 4)
                if let day { due(day, tint) }
            }
            HStack(spacing: 8) {
                grip
                VStack(alignment: .leading, spacing: 1) {
                    title
                    HStack(spacing: 6) {
                        if let project { Text(project.name).foregroundStyle(.secondary).lineLimit(1) }
                        if let day { due(day, tint) }
                    }
                    .font(.caption)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(.leading, 11)
        .padding(.trailing, 8)
        .padding(.vertical, 6)
        .background(Color.card, in: RoundedRectangle(cornerRadius: 8))
        .overlay(alignment: .leading) { PlanBar(color: planTint(task, model)) }
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.secondary.opacity(0.18)))
        .contentShape(RoundedRectangle(cornerRadius: 8))
        .onTapGesture { model.selection = task.localId }
        .draggable(TaskDrag.payload(task.localId)) { DragPreview(title: task.title) }
        .contextMenu { TaskMenu(task: task) }
    }

    private var grip: some View {
        Image(systemName: "line.3.horizontal").foregroundStyle(.tertiary).accessibilityHidden(true)
    }

    private var title: some View {
        Text(task.title).font(.callout).lineLimit(1).strikethrough(task.status == .done)
    }

    /// The day with a calendar icon, red when overdue.
    private func due(_ day: String, _ tint: Color?) -> some View {
        HStack(spacing: 3) {
            Image(systemName: "calendar").imageScale(.small)
            Text(day)
        }
        .font(.caption)
        .foregroundStyle(tint ?? .secondary)
        .fixedSize()
    }
}

/// How much of the plan's height the days' titles and the drawer take: less in a short window, so the hours keep room.
struct PlanLayout: Equatable {
    /// Untimed tasks shown in a day's title before "+n more".
    let untimed: Int
    /// The height of the days' titles: name, date and the untimed tasks.
    let header: CGFloat
    /// The height of the open drawer's columns.
    let drawer: CGFloat

    init(height: CGFloat) {
        let short = height < 560
        untimed = short ? 1 : 3
        header = short ? 88 : 118
        drawer = min(190, max(110, (height * 0.28).rounded()))
    }
}
