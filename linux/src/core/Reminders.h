#pragma once

#include "HelmDates.h"
#include "TaskItem.h"

#include <QList>
#include <QString>

#include <optional>

namespace dayhand {

/**
 * One ring at instant [at] (Unix ms): [minutesBefore] minutes before a timed task's due time, or (with
 * [minutesBefore] unset) at a time of day on the due day or [daysBefore] days earlier, from the task's own reminders.
 */
struct Reminder {
    QString taskLocalId;
    QString title;
    QString dueDate;
    std::optional<QString> dueTime;
    std::optional<int> minutesBefore;
    qint64 at = 0;
    int daysBefore = 0;

    bool operator==(const Reminder &) const = default;
};

/// The morning notification: how much is on today, how much is overdue and where to start.
struct MorningSummary {
    qsizetype today = 0;
    qsizetype overdue = 0;
    std::optional<QString> startWith;

    bool operator==(const MorningSummary &) const = default;
};

/// The server settings that decide when reminders ring (`getSettings`), with the backend's defaults.
struct ReminderSettings {
    QString timezone = HelmDates::defaultTimezone;
    QString summaryTime = QStringLiteral("05:00");
    QList<int> reminderMinutes{0};

    bool operator==(const ReminderSettings &) const = default;
};

/**
 * When reminders ring, as the Android app's `ReminderRules`. Everything is computed from the local database, in
 * the user's time zone from the server settings (the same zone that decides "today"), so no server is needed.
 * Only open tasks with a day ring. Overdue tasks never ring: they wait at the top of Today.
 */
namespace ReminderRules {

inline const QString defaultSummaryTime = QStringLiteral("05:00");
/// A reminder that would fire later than this (a computer asleep or off) is dropped instead of ringing late.
constexpr qint64 lateLimitMs = 15 * 60'000;

/// The due instant of a timed task; a time skipped by a clock change moves forward by the gap.
std::optional<qint64> dueAt(const TaskItem &task, const QString &timezone);

/**
 * Every reminder of the open tasks with a due day, earliest first: a task's own reminders, or the default
 * [minutesBefore] when it has none of its own. A reminder whose moment had already passed when the task was last
 * changed is left out.
 */
QList<Reminder> reminders(const QList<TaskItem> &tasks, const QList<int> &minutesBefore, const QString &timezone);

/// When the reminder alarm should fire next: the first reminder not handled yet and not too late.
std::optional<qint64> nextAlarm(const QList<Reminder> &reminders, qint64 now, qint64 handledUntil);

/// Reminders since the last check that are not too late and whose task is not overdue, the latest one per task.
QList<Reminder> due(const QList<Reminder> &reminders, qint64 now, qint64 handledUntil, const QString &timezone);

/// The next moment strictly after [now] when the clock in [timezone] shows [summaryTime].
qint64 nextSummaryAt(qint64 now, const QString &summaryTime, const QString &timezone);

} // namespace ReminderRules

/// The morning summary from the same sections as the Today screen; the "now" task counts as today's.
MorningSummary morningSummary(const QList<TaskItem> &tasks, qint64 nowMs, const QString &timezone);

} // namespace dayhand
