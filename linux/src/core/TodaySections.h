#pragma once

#include "TaskItem.h"

#include <QList>
#include <QString>

#include <optional>

namespace dayhand {

/// The Today screen, top to bottom. The "now" task is shown once, in its own section.
struct TodaySections {
    QString date;
    QList<TaskItem> overdue;
    std::optional<TaskItem> now;
    QList<TaskItem> today;
    QList<TaskItem> done;

    /// Nothing left to do today (done tasks alone still count as an empty plan).
    bool isEmpty() const { return overdue.isEmpty() && !now && today.isEmpty(); }
    /// Open tasks on the plan today: overdue, now and today's.
    qsizetype openCount() const { return overdue.size() + today.size() + (now ? 1 : 0); }

    bool operator==(const TodaySections &) const = default;
};

/// Timed tasks first by time, then untimed by creation (backend `bySchedule`).
bool bySchedule(const TaskItem &a, const TaskItem &b);

/// Splits the local tasks into the Today sections for instant [nowMs] in [timezone] (Android `todaySections`).
TodaySections todaySections(const QList<TaskItem> &tasks, qint64 nowMs, const QString &timezone);

} // namespace dayhand
