import DayhandCore
import DayhandLocalization
import SwiftUI

/// A seven-day plan, or one expanded day. Both use the same task operations and drop targets.
struct PlanView: View {
    @EnvironmentObject private var model: AppModel
    @State private var dayOffset = 0
    @AppStorage("planShowsDay") private var showsDay = false
    @AppStorage("planDrawerOpen") private var drawerOpen = false

    var body: some View {
        let today = CivilDate(model.today) ?? CivilDate(dayNumber: 0)
        let selected = today.adding(days: dayOffset)
        let week = PlanWeek.containing(selected.description) ?? PlanWeek(monday: selected)
        let plan = model.plan(week)
        GeometryReader { geometry in
            let layout = PlanLayout(height: geometry.size.height)
            VStack(spacing: 0) {
                controls(selected: selected, week: week)
                Divider()
                grid(days: showsDay ? [selected] : week.days, plan: plan, layout: layout, width: geometry.size.width)
                if model.selection == nil { PlanDrawer(open: $drawerOpen, height: layout.drawer) }
            }
        }
    }

    private func controls(selected: CivilDate, week: PlanWeek) -> some View {
        HStack(spacing: 8) {
            Button(tr("Today")) { dayOffset = 0 }
                .help(tr("Today"))
            Button { dayOffset -= showsDay ? 1 : 7 } label: { Image(systemName: "chevron.left") }
                .accessibilityLabel(showsDay ? tr("Previous day") : tr("Previous week"))
            Button { dayOffset += showsDay ? 1 : 7 } label: { Image(systemName: "chevron.right") }
                .accessibilityLabel(showsDay ? tr("Next day") : tr("Next week"))
            Text(showsDay ? DateText.dayAndMonth(selected.description) : week.range)
                .font(.title3.weight(.medium))
                .lineLimit(1)
                .minimumScaleFactor(0.85)
            Spacer(minLength: 4)
            Picker(tr("View"), selection: $showsDay) {
                Text(tr("Week")).tag(false)
                Text(tr("Day")).tag(true)
            }
            .labelsHidden()
            .frame(width: 94)
        }
        .controlSize(.regular)
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 12)
    }

    private func grid(days: [CivilDate], plan: [String: [TaskItem]], layout: PlanLayout, width: CGFloat) -> some View {
        ScrollViewReader { reader in
            ScrollView([.horizontal, .vertical]) {
                LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                    Section {
                        HStack(alignment: .top, spacing: 0) {
                            morningAnchor(header: layout.header)
                            hours
                            ForEach(days, id: \.dayNumber) { day in
                                PlanDayColumn(day: day, tasks: plan[day.description] ?? [], isToday: day.description == model.today)
                            }
                        }
                    } header: {
                        HStack(alignment: .top, spacing: 0) {
                            Color.clear.frame(width: Self.hourColumn)
                            ForEach(days, id: \.dayNumber) { day in
                                PlanDayHeader(day: day, tasks: plan[day.description] ?? [], isToday: day.description == model.today,
                                              limit: layout.untimed, openDay: {
                                    dayOffset = day.dayNumber - (CivilDate(model.today)?.dayNumber ?? day.dayNumber)
                                    showsDay = true
                                })
                            }
                        }
                        .frame(height: layout.header)
                        .background(Color.card)
                        .overlay(alignment: .bottom) { Divider() }
                    }
                }
                .frame(width: max(width - 12, Self.hourColumn + CGFloat(days.count) * 108))
            }
            .onAppear { DispatchQueue.main.async { reader.scrollTo(Self.morning, anchor: .top) } }
        }
        .background(Color.card)
    }

    static let hourColumn: CGFloat = 52
    private static let morning = "morning"

    private func morningAnchor(header: CGFloat) -> some View {
        VStack(spacing: 0) {
            Color.clear.frame(width: 0, height: max(0, CGFloat(PlanGrid.morning - PlanGrid.firstHour) * PlanGrid.hourHeight - header))
            Color.clear.frame(width: 0, height: 1).id(Self.morning)
        }
        .frame(width: 0, height: PlanGrid.height, alignment: .top)
        .accessibilityHidden(true)
    }

    private var hours: some View {
        VStack(spacing: 0) {
            ForEach(PlanGrid.firstHour..<PlanGrid.lastHour, id: \.self) { hour in
                Text(DateText.time(String(format: "%02d:00", hour)))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .frame(width: Self.hourColumn - 8, height: PlanGrid.hourHeight, alignment: .topTrailing)
                    .padding(.trailing, 8)
            }
        }
        .frame(height: PlanGrid.height, alignment: .top)
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
