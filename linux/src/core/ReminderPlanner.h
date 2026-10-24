#pragma once

#include "Reminders.h"
#include "TaskItem.h"

#include <QList>
#include <QString>

namespace dayhand {

/// One notification to show at [at] (Unix ms).
struct PlannedNotification {
    enum class Kind { Reminder, Summary };

    /// Stable for the same ring, so planning again names the same rings the same way.
    QString id;
    qint64 at = 0;
    QString title;
    QString body;
    Kind kind = Kind::Summary;
    /// The task a reminder is about; empty for a summary.
    QString taskLocalId;

    bool operator==(const PlannedNotification &) const = default;
};

/**
 * The reminders and morning summaries ahead, computed from the local database with the Android app's rules
 * ([ReminderRules], [morningSummary]) and the texts of the macOS app's `ReminderPlanner`. The freedesktop
 * notification service cannot hold notifications for later, so Dayhand keeps this plan and shows each ring when its
 * moment comes ([due]); the plan is made again after every change of tasks or settings. Overdue tasks never ring,
 * and each summary is worked out for its own morning.
 */
namespace ReminderPlanner {

/// Rings planned at most; far more than a day of reminders needs.
constexpr int limit = 500;
/// Summaries planned ahead.
constexpr int summaryDays = 7;
inline const QString idPrefix = QStringLiteral("dayhand.");

QList<PlannedNotification> plan(const QList<TaskItem> &tasks, const ReminderSettings &settings, qint64 now,
                                int limit = ReminderPlanner::limit);

/**
 * What to show at [now]: rings after [handledUntil] that are at most `ReminderRules::lateLimitMs` late, the latest
 * reminder per task, and at most one summary (the latest).
 */
QList<PlannedNotification> due(const QList<PlannedNotification> &plan, qint64 now, qint64 handledUntil);

/// The first ring after [handledUntil] that is not too late at [now], when the clock should next wake up.
std::optional<qint64> nextRing(const QList<PlannedNotification> &plan, qint64 now, qint64 handledUntil);

QString reminderBody(const Reminder &reminder, const QString &timezone);
QString summaryTitle(const MorningSummary &summary);
QString summaryBody(const MorningSummary &summary);

} // namespace ReminderPlanner
} // namespace dayhand
