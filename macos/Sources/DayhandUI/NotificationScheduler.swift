import DayhandCore
import Foundation
@preconcurrency import UserNotifications

/**
 * Leaves the planned reminders and morning summaries with macOS (`UserNotifications`), so they ring even while
 * Dayhand is not running. Each plan replaces only what changed: a ring that stays keeps its pending request. A
 * reminder's **Done** completes the task through the outbox, like a click on Today.
 */
@MainActor
final class NotificationScheduler: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    nonisolated static let reminderCategory = "dayhand.reminder"
    nonisolated static let doneAction = "dayhand.done"
    nonisolated static let taskKey = "taskLocalId"

    private let center = UNUserNotificationCenter.current()
    @Published private(set) var authorization: UNAuthorizationStatus = .notDetermined

    override init() {
        super.init()
        center.delegate = self
        let done = UNNotificationAction(identifier: Self.doneAction, title: "Done", options: [])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: Self.reminderCategory, actions: [done], intentIdentifiers: [], options: []),
        ])
        Task { await refreshAuthorization() }
    }

    func refreshAuthorization() async {
        authorization = await center.notificationSettings().authorizationStatus
    }

    /// Asks once; afterwards macOS only lets the user change it in System Settings.
    func requestAuthorization() async {
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        await refreshAuthorization()
    }

    func apply(_ plan: [PlannedNotification]) async {
        if authorization == .notDetermined, plan.contains(where: { if case .reminder = $0.kind { return true } else { return false } }) {
            await requestAuthorization()
        }
        // Without permission nothing is left with macOS; Settings offers to ask.
        guard authorization == .authorized || authorization == .provisional else { return }
        let pending = await center.pendingNotificationRequests().filter { $0.identifier.hasPrefix(ReminderPlanner.idPrefix) }
        let wanted = Dictionary(plan.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var keep = Set<String>()
        var stale: [String] = []
        for request in pending {
            if let planned = wanted[request.identifier], request.content.title == planned.title, request.content.body == planned.body {
                keep.insert(request.identifier)
            } else {
                stale.append(request.identifier)
            }
        }
        center.removePendingNotificationRequests(withIdentifiers: stale)
        for planned in plan where !keep.contains(planned.id) {
            try? await center.add(request(for: planned))
        }
    }

    private func request(for planned: PlannedNotification) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = planned.title
        content.body = planned.body
        switch planned.kind {
        case .reminder(let taskLocalId):
            content.sound = .default
            content.categoryIdentifier = Self.reminderCategory
            content.userInfo = [Self.taskKey: taskLocalId]
            content.interruptionLevel = .active
        case .summary:
            // Quiet, so it waits in Notification Center instead of sounding at five in the morning.
            content.interruptionLevel = .passive
        }
        return UNNotificationRequest(identifier: planned.id, content: content, trigger: Self.trigger(at: planned.at))
    }

    /// A trigger at an exact instant, written in UTC so the Mac's own zone does not matter.
    static func trigger(at epochMs: Int64) -> UNCalendarNotificationTrigger {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        var components = calendar.dateComponents(
            [.year, .month, .day, .hour, .minute, .second], from: Date(timeIntervalSince1970: TimeInterval(epochMs) / 1000)
        )
        components.timeZone = calendar.timeZone
        components.calendar = calendar
        return UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let taskId = response.notification.request.content.userInfo[Self.taskKey] as? String
        let action = response.actionIdentifier
        await MainActor.run {
            let model = AppModel.shared
            if action == Self.doneAction, let taskId, let task = model.task(taskId), task.status != .done {
                model.toggleDone(task)
            } else if action == UNNotificationDefaultActionIdentifier {
                model.selection = taskId
                model.showMainWindow()
            }
        }
    }
}
