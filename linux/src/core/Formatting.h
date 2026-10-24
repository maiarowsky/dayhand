#pragma once

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
/// "Today, 14:00", "Fri 23 Oct", or nothing for a task without a day.
std::optional<QString> due(const TaskItem &task, const QString &today);
QString when(const When &when, const QString &today);
/// The small line under a task on Today: its time or day, repeat, checklist and labels.
QString detailLine(const TaskItem &task, const QString &today, bool overdue);
/// The connection in words for the status line, or nothing when there is nothing to say.
std::optional<QString> status(const SyncStatus &status, qint64 pending, bool useOffline);

} // namespace Formatting
} // namespace dayhand
