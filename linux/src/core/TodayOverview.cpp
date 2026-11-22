#include "TodayOverview.h"

#include "CivilDate.h"

#include <QHash>

#include <algorithm>

namespace dayhand {

TodayOverview todayOverview(const QList<TaskItem> &tasks, const TodaySections &sections, int days, int comingUpDays)
{
    TodayOverview overview;
    const QString &today = sections.date;
    const auto start = CivilDate::parse(today);
    if (!start)
        return overview;
    QList<TaskItem> open;
    std::copy_if(tasks.begin(), tasks.end(), std::back_inserter(open),
                 [](const TaskItem &t) { return t.isActive() && t.status != TaskStatus::Done; });
    QHash<QString, int> perDay;
    for (const TaskItem &task : open)
        if (task.dueDate)
            ++perDay[*task.dueDate];
    for (int offset = 0; offset < std::max(days, 0); ++offset) {
        const QString date = start->addingDays(offset).toString();
        overview.days.append({date, perDay.value(date)});
    }
    QList<TaskItem> todays;
    if (sections.now && sections.now->dueDate == today)
        todays.append(*sections.now);
    todays.append(sections.today);
    for (const TaskItem &task : todays) {
        overview.timed += task.dueTime ? 1 : 0;
        overview.repeating += task.repeat ? 1 : 0;
    }
    const QString last = start->addingDays(comingUpDays).toString();
    for (const TaskItem &task : open) {
        if (task.isNow)
            continue;
        if (!task.dueDate)
            overview.noDay.append(task);
        else if (*task.dueDate > today && *task.dueDate <= last)
            overview.comingUp.append(task);
    }
    std::sort(overview.noDay.begin(), overview.noDay.end(), bySchedule);
    std::sort(overview.comingUp.begin(), overview.comingUp.end(), bySchedule);
    return overview;
}

} // namespace dayhand
