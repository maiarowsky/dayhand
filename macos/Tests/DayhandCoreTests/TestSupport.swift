import Foundation
@testable import DayhandCore

/// Unix ms of a UTC minute written as `2026-10-22T10:00`.
func utc(_ isoMinute: String) -> Int64 {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    guard let date = formatter.date(from: isoMinute + ":00Z") else { fatalError("bad test date \(isoMinute)") }
    return Int64(date.timeIntervalSince1970 * 1000)
}

func day(_ iso: String) -> CivilDate {
    guard let date = CivilDate(iso) else { fatalError("bad test day \(iso)") }
    return date
}

func task(
    _ id: String, due: String? = nil, time: String? = nil, status: TaskStatus = .todo, created: Int64 = 0,
    updated: Int64 = 0, _ change: (inout TaskItem) -> Void = { _ in }
) -> TaskItem {
    var item = TaskItem(localId: id, title: id, dueDate: due, dueTime: time, status: status, createdAt: created, updatedAt: updated)
    change(&item)
    return item
}

/// Ids, in order, for short expectations.
func ids(_ tasks: [TaskItem]) -> [String] { tasks.map(\.localId) }

/// A counter clock the test moves by hand.
final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Int64

    init(_ start: Int64) {
        value = start
    }

    var now: Int64 { lock.locked { value } }

    func advance(_ ms: Int64) { lock.locked { value += ms } }

    func set(_ ms: Int64) { lock.locked { value = ms } }
}

/// Ids `id-1`, `id-2`, … so tests can name what the repository creates.
final class TestIds: @unchecked Sendable {
    private let lock = NSLock()
    private var counter = 0

    func next() -> String {
        lock.locked {
            counter += 1
            return "id-\(counter)"
        }
    }
}
