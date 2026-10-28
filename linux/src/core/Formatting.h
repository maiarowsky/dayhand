#pragma once

#include "Reminders.h"
#include "SyncEngine.h"
#include "TaskItem.h"
#include "WhenParser.h"

#include <QString>

#include <optional>

namespace dayhand {

/// How days, times and the connection read on screen. The screens are in English, as the other apps.
namespace Formatting {

/// "Today", "Tomorrow", "Yesterday", or "Fri 23 Oct" (with the year when it is not this year).
QString day(const QString &date, const QString &today);
/// "Sat 24 Oct", with no "Today": the date under the Today title.
QString dayName(const QString &date);
/// The server's 30-day trash retention, as "Permanently deleted on 23 Nov" in the settings' time zone.
QString trashExpiry(qint64 deletedAt, const QString &today, const QString &timezone);
/// "Today, 14:00", "Fri 23 Oct", or nothing for a task without a day.
std::optional<QString> due(const TaskItem &task, const QString &today);
QString when(const When &when, const QString &today);
/// Read-only repeat and reminder previews for the details panel.
QString repeat(const TaskItem &task, const QString &today);
QString reminders(const TaskItem &task, const ReminderSettings &settings);
/// The small line under a task on Today: its time or day, repeat and checklist.
QString detailLine(const TaskItem &task, const QString &today, bool overdue);
/// The connection in words for the status line, or nothing when there is nothing to say.
std::optional<QString> status(const SyncStatus &status, qint64 pending, bool useOffline);

} // namespace Formatting
} // namespace dayhand
