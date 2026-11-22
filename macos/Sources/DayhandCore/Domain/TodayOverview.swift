import Foundation

/// What Today shows beside its sections: how full the coming days are, how many of today's open tasks have a time or
/// repeat, and the open tasks still without a day or due in the next few days.
public struct TodayOverview: Hashable, Sendable {
    public struct Day: Hashable, Sendable {
        /// YYYY-MM-DD.
        public let date: String
        /// Open tasks due that day.
        public let open: Int
    }

    /// Today and the days after it, in order.
    public let days: [Day]
    /// Today's open tasks with a time.
    public let timed: Int
    /// Today's open tasks that repeat.
    public let repeating: Int
    /// Open tasks without a day, the oldest first.
    public let noDay: [TaskItem]
    /// Open tasks due after today, up to `comingUpDays` ahead, by day and time; not the now task.
    public let comingUp: [TaskItem]

    public static let empty = TodayOverview(days: [], timed: 0, repeating: 0, noDay: [], comingUp: [])
}

/// The overview of the plan around [sections]' day; [days] long, with [comingUpDays] after today in "coming up".
public func todayOverview(_ tasks: [TaskItem], sections: TodaySections, days: Int = 14, comingUpDays: Int = 3) -> TodayOverview {
    let today = sections.date
    guard let start = CivilDate(today) else { return .empty }
    let open = tasks.filter { $0.isActive && $0.status != .done }
    var perDay: [String: Int] = [:]
    for task in open { if let due = task.dueDate { perDay[due, default: 0] += 1 } }
    let todays = (sections.now.map { [$0] } ?? []).filter { $0.dueDate == today } + sections.today
    let last = start.adding(days: comingUpDays).description
    return TodayOverview(
        days: (0..<max(days, 0)).map { offset in
            let date = start.adding(days: offset).description
            return TodayOverview.Day(date: date, open: perDay[date] ?? 0)
        },
        timed: todays.filter { $0.dueTime != nil }.count,
        repeating: todays.filter { $0.repeat != nil }.count,
        noDay: open.filter { $0.dueDate == nil && !$0.isNow }.sorted(by: bySchedule),
        comingUp: open.filter { ($0.dueDate ?? "") > today && ($0.dueDate ?? "") <= last && !$0.isNow }.sorted(by: bySchedule)
    )
}
