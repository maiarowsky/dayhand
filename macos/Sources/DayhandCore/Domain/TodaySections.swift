import Foundation

/// The Today screen, top to bottom. The "now" task is shown once, in its own section.
public struct TodaySections: Hashable, Sendable {
    public let date: String
    public let overdue: [TaskItem]
    public let now: TaskItem?
    public let today: [TaskItem]
    public let done: [TaskItem]

    /// Nothing left to do today (done tasks alone still count as an empty plan).
    public var isEmpty: Bool { overdue.isEmpty && now == nil && today.isEmpty }

    /// Open tasks on the plan today: overdue, now and today's.
    public var openCount: Int { overdue.count + today.count + (now == nil ? 0 : 1) }

    public static let empty = TodaySections(date: "", overdue: [], now: nil, today: [], done: [])

    /// The same sections with only the tasks [isIncluded] keeps.
    public func filter(_ isIncluded: (TaskItem) -> Bool) -> TodaySections {
        TodaySections(
            date: date, overdue: overdue.filter(isIncluded), now: now.flatMap { isIncluded($0) ? $0 : nil },
            today: today.filter(isIncluded), done: done.filter(isIncluded)
        )
    }
}

/// Timed tasks first by time, then untimed by creation (backend `bySchedule`).
func bySchedule(_ a: TaskItem, _ b: TaskItem) -> Bool {
    let dateA = a.dueDate ?? "", dateB = b.dueDate ?? ""
    if dateA != dateB { return dateA < dateB }
    switch (a.dueTime, b.dueTime) {
    case let (timeA?, timeB?) where timeA != timeB: return timeA < timeB
    case (.some, nil): return true
    case (nil, .some): return false
    default:
        // Equal times, or both untimed: by creation, then by id, so the order never flickers between refreshes.
        return a.createdAt != b.createdAt ? a.createdAt < b.createdAt : a.localId < b.localId
    }
}

/// Splits the local tasks into the Today sections for instant [nowMs] in [timezone] (Android `todaySections`).
public func todaySections(_ tasks: [TaskItem], nowMs: Int64, timezone: String?) -> TodaySections {
    let today = HelmDates.localDate(nowMs, timezone)
    let active = tasks.filter(\.isActive)
    let nowTask = active.first { $0.isNow && $0.status != .done }
    let open = active.filter { $0.status != .done && $0.localId != nowTask?.localId }
    return TodaySections(
        date: today,
        overdue: open.filter { HelmDates.isOverdue($0, today: today) }.sorted(by: bySchedule),
        now: nowTask,
        today: open.filter { $0.dueDate == today }.sorted(by: bySchedule),
        done: active
            .filter { task in
                guard task.status == .done, let completedAt = task.completedAt else { return false }
                return HelmDates.localDate(completedAt, timezone) == today
            }
            .sorted { ($0.completedAt ?? 0) > ($1.completedAt ?? 0) }
    )
}
