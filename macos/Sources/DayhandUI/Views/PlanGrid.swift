import DayhandCore
import DayhandLocalization
import SwiftUI

/// The seven days, Monday to Sunday, the plan shows.
struct PlanWeek: Equatable {
    let monday: CivilDate

    var days: [CivilDate] { (0..<7).map { monday.adding(days: $0) } }

    /// The week [date] ("YYYY-MM-DD") falls in.
    static func containing(_ date: String) -> PlanWeek? {
        CivilDate(date).map { PlanWeek(monday: $0.adding(days: 1 - $0.weekday)) }
    }

    func shifted(by weeks: Int) -> PlanWeek { PlanWeek(monday: monday.adding(days: 7 * weeks)) }

    func contains(_ date: String?) -> Bool {
        guard let date, let day = CivilDate(date) else { return false }
        return (monday.dayNumber..<monday.dayNumber + 7).contains(day.dayNumber)
    }

    /// "26 October – 1 November".
    var range: String {
        "\(DateText.dayAndMonth(monday.description)) – \(DateText.dayAndMonth(monday.adding(days: 6).description))"
    }
}

/// Where the hours of the day sit in the plan's grid, and the time at a point of it.
enum PlanGrid {
    static let firstHour = 0
    static let lastHour = 24
    static let hourHeight: CGFloat = 48
    /// The hour the grid scrolls to when it opens.
    static let morning = 8

    static var height: CGFloat { CGFloat(lastHour - firstHour) * hourHeight }

    /// A day's column and title: blue under a dragged task, faintly blue today, faintly red at the weekend.
    static func dayTint(_ day: CivilDate, isToday: Bool, targeted: Bool) -> Color {
        targeted ? Color.accentColor.opacity(0.10)
            : isToday ? Color.accentColor.opacity(0.04)
            : day.weekday >= 6 ? Color.overdue.opacity(0.035) : Color.clear
    }

    /// How far down a task at [time] ("HH:mm") starts; a task in the last hour keeps a whole hour of the grid.
    static func offset(_ time: String) -> CGFloat? {
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        let minutes = (parts[0] - firstHour) * 60 + parts[1]
        let clamped = min(max(minutes, 0), (lastHour - firstHour) * 60 - 60)
        return CGFloat(clamped) * hourHeight / 60
    }

    /// The time ("HH:mm") at [y] points from the top of the grid, to the half hour.
    static func time(at y: CGFloat) -> String {
        let halfHours = Int((y / (hourHeight / 2)).rounded(.down))
        let minutes = min(max(firstHour * 60 + halfHours * 30, firstHour * 60), lastHour * 60 - 30)
        return String(format: "%02d:%02d", minutes / 60, minutes % 60)
    }

    /// Side by side lanes for tasks that start within an hour of each other: each task's lane and the lanes of its
    /// group, by `localId`.
    static func lanes(_ tasks: [TaskItem]) -> [String: (lane: Int, of: Int)] {
        let timed = tasks.compactMap { task in task.dueTime.flatMap(offset).map { (task, $0) } }.sorted { $0.1 < $1.1 }
        var result: [String: (lane: Int, of: Int)] = [:]
        var group: [(TaskItem, CGFloat)] = []
        func close() {
            for (index, item) in group.enumerated() { result[item.0.localId] = (index, group.count) }
            group = []
        }
        for item in timed {
            if let first = group.first, item.1 - first.1 >= hourHeight { close() }
            group.append(item)
        }
        close()
        return result
    }
}

extension AppModel {
    /// The active tasks of the place picked in the sidebar due in [week], by day: every task on Today, a list's tasks
    /// elsewhere.
    func plan(_ week: PlanWeek) -> [String: [TaskItem]] {
        let filter = place.filter ?? .all
        let known = showsProjects ? projectIds : []
        let shown = tasks.filter { $0.isActive && week.contains($0.dueDate) && filter.matches($0, projects: known) && matchesSearch($0) }
        return Dictionary(grouping: shown) { $0.dueDate ?? "" }
    }
}

/// One day of the week: its untimed tasks in a strip at the top is `PlanDayHeader`; this is the hours with the timed
/// tasks as blocks. A task dropped on an hour is planned for that day at the half hour under the pointer.
struct PlanDayColumn: View {
    @EnvironmentObject private var model: AppModel
    let day: CivilDate
    let tasks: [TaskItem]
    let isToday: Bool
    @State private var targeted = false

    var body: some View {
        let lanes = PlanGrid.lanes(tasks)
        GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                ForEach(tasks.filter { $0.dueTime != nil }) { task in
                    if let top = task.dueTime.flatMap(PlanGrid.offset), let lane = lanes[task.localId] {
                        let width = (geometry.size.width - 6) / CGFloat(lane.of)
                        PlanBlock(task: task)
                            .frame(width: width - 2, height: PlanGrid.hourHeight - 3)
                            .offset(x: 3 + CGFloat(lane.lane) * width, y: top + 1)
                    }
                }
            }
        }
        .frame(height: PlanGrid.height)
        .background(dayBackground)
        .overlay(alignment: .leading) { Rectangle().fill(Color.secondary.opacity(0.15)).frame(width: 1) }
        .dropDestination(for: String.self) { items, location in
            guard let id = items.lazy.compactMap(TaskDrag.localId).first else { return false }
            model.setDue(id, date: day.description, time: PlanGrid.time(at: location.y))
            return true
        } isTargeted: { targeted = $0 }
    }

    private var dayBackground: some View { Rectangle().fill(PlanGrid.dayTint(day, isToday: isToday, targeted: targeted)) }
}

/// A day's name and date, and its untimed tasks; a task dropped here is planned for the day without a time.
struct PlanDayHeader: View {
    @EnvironmentObject private var model: AppModel
    let day: CivilDate
    let tasks: [TaskItem]
    let isToday: Bool
    var limit = 3
    @State private var targeted = false

    var body: some View {
        let untimed = tasks.filter { $0.dueTime == nil }
        VStack(spacing: 4) {
            Text(DateText.shortWeekday(day.weekday) ?? "")
                .font(.headline)
                .foregroundStyle(isToday ? Color.accentColor : .primary)
            Text(DateText.dayAndMonth(day.description)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            VStack(spacing: 3) {
                ForEach(untimed.prefix(limit)) { task in
                    PlanAllDayChip(task: task)
                }
                let more = untimed.count - limit
                if more > 0 { Text(tr("+\(more) more")).font(.caption2).foregroundStyle(.secondary) }
            }
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 3)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(PlanGrid.dayTint(day, isToday: isToday, targeted: targeted))
        .dropDestination(for: String.self) { items, _ in
            guard let id = items.lazy.compactMap(TaskDrag.localId).first else { return false }
            model.setDue(id, date: day.description, time: nil)
            return true
        } isTargeted: { targeted = $0 }
    }
}

/// The tint of a task in the plan: its project's color, otherwise its status's.
@MainActor
func planTint(_ task: TaskItem, _ model: AppModel) -> Color {
    model.projectOf(task)?.color.map(ProjectColors.color) ?? StatusStyle.color(task.status)
}

/// An untimed task in a day's strip.
struct PlanAllDayChip: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem
    @State private var showing = false

    var body: some View {
        Text(task.title)
            .font(.caption)
            .lineLimit(1)
            .strikethrough(task.status == .done)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(planTint(task, model).opacity(0.15), in: RoundedRectangle(cornerRadius: 5))
            .onTapGesture { showing = true }
            .popover(isPresented: $showing, arrowEdge: .bottom) { PlanTaskPopover(task: task) { showing = false } }
            .draggable(TaskDrag.payload(task.localId)) { DragPreview(title: task.title) }
            .contextMenu { TaskMenu(task: task) }
    }
}

/// A timed task in the grid: a tinted block with a bar of its color on the left, its title, project and time (as much
/// as the block has room for).
struct PlanBlock: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem
    @State private var showing = false

    var body: some View {
        let tint = planTint(task, model)
        let project = model.projectLine(task)?.name
        let time = task.dueTime.map(DateText.time)
        ViewThatFits(in: .vertical) {
            lines([project, time].compactMap { $0 })
            lines([project ?? time].compactMap { $0 })
            lines([])
        }
        .padding(.leading, 9)
        .padding(.trailing, 4)
        .padding(.vertical, 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .clipped()
        .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: 6))
        .overlay(alignment: .leading) {
            PlanBar(color: tint)
        }
        .contentShape(RoundedRectangle(cornerRadius: 6))
        .onTapGesture { showing = true }
        .popover(isPresented: $showing, arrowEdge: .trailing) { PlanTaskPopover(task: task) { showing = false } }
        .draggable(TaskDrag.payload(task.localId)) { DragPreview(title: task.title) }
        .contextMenu { TaskMenu(task: task) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    private func lines(_ below: [String]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(task.title).font(.caption.weight(.semibold)).lineLimit(below.isEmpty ? 2 : 1).strikethrough(task.status == .done)
            ForEach(below, id: \.self) { Text($0).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
        }
    }
}

/// The bar of a task's color along the left edge of a block or a drawer card, inside its rounded corners.
struct PlanBar: View {
    let color: Color

    var body: some View {
        RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 3).padding(.vertical, 3).padding(.leading, 2)
    }
}

/// A plan task's details at a glance: title and project, status, day and time, checklist, and Open Task.
struct PlanTaskPopover: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem
    let close: () -> Void

    var body: some View {
        let current = model.task(task.localId) ?? task
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(current.title).font(.title3.bold()).lineLimit(3)
                if let project = model.projectOf(current) {
                    HStack(spacing: 5) {
                        ProjectMark(project: project, size: 8)
                        Text(project.name)
                    }
                    .foregroundStyle(.secondary)
                }
            }
            Divider()
            HStack {
                Text(tr("Status")).foregroundStyle(.secondary)
                Spacer()
                StatusMenu(task: current)
            }
            Label(Formatting.due(current, today: model.today) ?? tr("No day"), systemImage: "calendar")
            if !current.checklist.isEmpty {
                Label {
                    HStack {
                        Text(tr("Checklist"))
                        Spacer()
                        Text("\(current.checklist.filter(\.done).count)/\(current.checklist.count)").foregroundStyle(.secondary)
                    }
                } icon: { Image(systemName: "checklist") }
            }
            HStack {
                Spacer()
                Button {
                    close()
                    model.selection = task.localId
                } label: { Label(tr("Open Task"), systemImage: "arrow.up.forward.square") }
            }
        }
        .padding(16)
        .frame(width: 300)
    }
}
