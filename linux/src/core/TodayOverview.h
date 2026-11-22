#pragma once

#include "TaskItem.h"
#include "TodaySections.h"

#include <QList>
#include <QString>

namespace dayhand {

/**
 * What Today shows beside its sections: how full the coming days are, how many of today's open tasks have a time or
 * repeat, and the open tasks still without a day or due in the next few days. The macOS app's `TodayOverview`.
 */
struct TodayOverview {
    struct Day {
        /// YYYY-MM-DD.
        QString date;
        /// Open tasks due that day.
        int open = 0;

        bool operator==(const Day &) const = default;
    };

    /// Today and the days after it, in order.
    QList<Day> days;
    /// Today's open tasks with a time (the now task too when it is due today).
    int timed = 0;
    /// Today's open tasks that repeat (the now task too when it is due today).
    int repeating = 0;
    /// Open tasks without a day, the oldest first; not the now task.
    QList<TaskItem> noDay;
    /// Open tasks due after today, up to `comingUpDays` ahead, by day and time; not the now task.
    QList<TaskItem> comingUp;

    bool operator==(const TodayOverview &) const = default;
};

/// The overview of the plan around [sections]' day: [days] long, with [comingUpDays] after today in "coming up".
TodayOverview todayOverview(const QList<TaskItem> &tasks, const TodaySections &sections, int days = 14,
                            int comingUpDays = 3);

} // namespace dayhand
