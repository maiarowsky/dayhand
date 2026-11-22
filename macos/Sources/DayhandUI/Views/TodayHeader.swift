import DayhandCore
import DayhandLocalization
import SwiftUI

/// Today and the days after it, as many as fit: each with its weekday, its number and a dot for each open task, up to
/// three. The day shown is in a blue circle, today's number is blue; a day clicked is shown in Today's place.
struct DayStrip: View {
    let days: [TodayOverview.Day]
    let picked: String

    static let dayWidth: CGFloat = 46

    var body: some View {
        GeometryReader { geometry in
            let count = min(days.count, max(7, Int(geometry.size.width / Self.dayWidth)))
            HStack(spacing: 0) {
                ForEach(Array(days.prefix(count).enumerated()), id: \.element.date) { index, day in
                    DayCell(day: day, isToday: index == 0, isPicked: day.date == picked).frame(maxWidth: .infinity)
                }
            }
        }
        .frame(height: 66)
        .overlay(alignment: .bottom) { Rectangle().fill(PlannerStyle.line).frame(height: 1).accessibilityHidden(true) }
    }
}

struct DayCell: View {
    @EnvironmentObject private var model: AppModel
    let day: TodayOverview.Day
    let isToday: Bool
    let isPicked: Bool
    @State private var hovered = false

    var body: some View {
        let civil = CivilDate(day.date)
        Button { model.preview(day.date) } label: {
            VStack(spacing: 4) {
                Text(civil.flatMap { DateText.shortWeekday($0.weekday) } ?? "")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
                Text(civil.map { "\($0.day)" } ?? "")
                    .font(.system(size: 15, weight: isToday || isPicked ? .semibold : .regular).monospacedDigit())
                    .foregroundStyle(isPicked ? AnyShapeStyle(PlannerStyle.onBlue) : isToday ? AnyShapeStyle(PlannerStyle.blue) : AnyShapeStyle(.primary))
                    .frame(width: 30, height: 30)
                    .background {
                        Circle().fill(isPicked ? AnyShapeStyle(PlannerStyle.blue) : AnyShapeStyle(Color.primary.opacity(hovered ? 0.07 : 0)))
                    }
                HStack(spacing: 3) {
                    ForEach(0..<min(day.open, 3), id: \.self) { _ in
                        Circle().fill(Color.secondary).frame(width: 4, height: 4)
                    }
                }
                .frame(height: 4)
            }
            .padding(.bottom, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
        .help(tr("Shows the day here"))
        .accessibilityLabel(Formatting.pair(DateText.longDay(day.date), tr("\(day.open) open")))
        .accessibilityHint(tr("Shows the day here"))
        .accessibilityAddTraits(isPicked ? .isSelected : [])
    }
}

/// One sentence about the day: a greeting, how many tasks are on today's plan, how many of them have a time or repeat,
/// how many are overdue, and what the plan health report asks of the owner.
struct DaySummary: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        let sections = model.sections, overview = model.overview
        let planned = sections.today.count + (sections.now == nil ? 0 : 1)
        FlowLine(spacing: 14, lineSpacing: 6) {
            Text(Formatting.sentences(greeting, planned == 0 ? tr("Nothing planned for today.") : tr("\(planned) on today's plan.")))
            if overview.timed > 0 {
                SummaryCount(icon: "clock", text: tr("\(overview.timed) at a set time"), tint: PlannerStyle.blue)
            }
            if overview.repeating > 0 {
                SummaryCount(icon: "arrow.triangle.2.circlepath", text: tr("\(overview.repeating) repeating"), tint: StatusStyle.color(.doing))
            }
            if !sections.overdue.isEmpty {
                SummaryCount(icon: "exclamationmark.circle", text: tr("\(sections.overdue.count) overdue"), tint: Color.overdue)
            }
            HealthToken()
        }
        .font(.system(size: 14))
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    private var greeting: String {
        let hour = HelmDates.localAt(Clock.nowMs(), model.settings.timezone).time.hour
        if (5..<12).contains(hour) { return tr("Good morning.") }
        if (12..<18).contains(hour) { return tr("Good afternoon.") }
        return tr("Good evening.")
    }
}

/// One sentence about a later day picked in the strip: how many tasks are on its plan and how many of them have a time
/// or repeat.
struct PickedDaySummary: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        let open = daySections(model.tasks, date: model.shownDay).today
        let timed = open.filter { $0.dueTime != nil }.count
        let repeating = open.filter { $0.repeat != nil }.count
        FlowLine(spacing: 14, lineSpacing: 6) {
            Text(open.isEmpty ? tr("Nothing planned for this day.") : tr("\(open.count) on this day's plan."))
            if timed > 0 {
                SummaryCount(icon: "clock", text: tr("\(timed) at a set time"), tint: PlannerStyle.blue)
            }
            if repeating > 0 {
                SummaryCount(icon: "arrow.triangle.2.circlepath", text: tr("\(repeating) repeating"), tint: StatusStyle.color(.doing))
            }
        }
        .font(.system(size: 14))
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

/// A count in the sentence about the day: a line icon in its colour and the words.
struct SummaryCount: View {
    let icon: String
    let text: String
    let tint: Color

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon).foregroundStyle(tint).accessibilityHidden(true)
            Text(text)
        }
        .accessibilityElement(children: .combine)
    }
}

/// What the plan health report asks for, in a word or two (agents paused, approval requests, blocked tasks…), in its
/// tone's colour; it opens the whole report, with Review when requests or proposals wait. Nothing when all is calm.
struct HealthToken: View {
    @EnvironmentObject private var model: AppModel
    @State private var showReport = false
    @State private var showInbox = false

    /// What Today already says on its own.
    static let shownElsewhere: Set<HealthKind> = [.overdue, .dueToday, .inProgress, .doneToday]

    var body: some View {
        if let health = model.health {
            let items = HealthSummary.items(health)
            let notable = items.filter { !Self.shownElsewhere.contains($0.kind) }
            if !notable.isEmpty {
                let line = AgentText.healthLine(items)
                Button { showReport = true } label: {
                    SummaryCount(
                        icon: "waveform.path.ecg",
                        text: notable.prefix(2).map(AgentText.item).joined(separator: DateText.listSeparator),
                        tint: AgentText.color(HealthSummary.tone(items), clear: false)
                    )
                }
                .buttonStyle(.plain)
                .help(line)
                .accessibilityLabel(line)
                .accessibilityHint(tr("Shows the plan health"))
                .popover(isPresented: $showReport, arrowEdge: .bottom) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(line).fixedSize(horizontal: false, vertical: true)
                        if HealthSummary.needsOwner(items) {
                            Button(tr("Review")) {
                                showReport = false
                                showInbox = true
                            }
                            .help(tr("The approval requests and proposals waiting for you, read-only"))
                        }
                    }
                    .padding(14)
                    .frame(width: 320, alignment: .leading)
                }
                .sheet(isPresented: $showInbox) { AgentInboxView().environmentObject(model) }
            }
        }
    }
}

/// Lays its children out from the leading edge, starting a new line when the next one does not fit; each child keeps
/// its own size.
struct FlowLine: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews, width: proposal.width ?? .infinity)
        return CGSize(width: rows.map(\.width).max() ?? 0, height: rows.last.map { $0.y + $0.height } ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in arrange(subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.items {
                let size = fitted(subviews[index], width: bounds.width)
                subviews[index].place(
                    at: CGPoint(x: x, y: bounds.minY + row.y + (row.height - size.height) / 2),
                    proposal: ProposedViewSize(size)
                )
                x += size.width + spacing
            }
        }
    }

    private struct Row {
        var items: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
        var y: CGFloat = 0
    }

    /// A child at its ideal size, wrapped to the line's width when it is wider (a long sentence).
    private func fitted(_ subview: LayoutSubview, width: CGFloat) -> CGSize {
        let ideal = subview.sizeThatFits(.unspecified)
        return ideal.width <= width ? ideal : subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
    }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> [Row] {
        var rows = [Row()]
        for index in subviews.indices {
            let size = fitted(subviews[index], width: width)
            if let last = rows.last, !last.items.isEmpty, last.width + spacing + size.width > width {
                rows.append(Row(y: last.y + last.height + lineSpacing))
            }
            var row = rows.removeLast()
            row.width += (row.items.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.items.append(index)
            rows.append(row)
        }
        return rows
    }
}
