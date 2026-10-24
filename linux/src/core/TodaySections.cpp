#include "TodaySections.h"

#include "HelmDates.h"

#include <algorithm>

namespace dayhand {

bool bySchedule(const TaskItem &a, const TaskItem &b)
{
    const QString dateA = a.dueDate.value_or(QString());
    const QString dateB = b.dueDate.value_or(QString());
    if (dateA != dateB)
        return dateA < dateB;
    if (a.dueTime && b.dueTime && *a.dueTime != *b.dueTime)
        return *a.dueTime < *b.dueTime;
    if (a.dueTime.has_value() != b.dueTime.has_value())
        return a.dueTime.has_value();
    // Equal times, or both untimed: by creation, then by id, so the order never flickers between refreshes.
    return a.createdAt != b.createdAt ? a.createdAt < b.createdAt : a.localId < b.localId;
}

TodaySections todaySections(const QList<TaskItem> &tasks, qint64 nowMs, const QString &timezone)
{
    TodaySections sections;
    sections.date = HelmDates::localDate(nowMs, timezone);
    QList<TaskItem> active;
    std::copy_if(tasks.begin(), tasks.end(), std::back_inserter(active), [](const TaskItem &t) { return t.isActive(); });
    const auto nowTask = std::find_if(active.begin(), active.end(),
                                      [](const TaskItem &t) { return t.isNow && t.status != TaskStatus::Done; });
    if (nowTask != active.end())
        sections.now = *nowTask;
    for (const TaskItem &task : active) {
        if (task.status == TaskStatus::Done) {
            if (task.completedAt && HelmDates::localDate(*task.completedAt, timezone) == sections.date)
                sections.done.append(task);
            continue;
        }
        if (sections.now && sections.now->localId == task.localId)
            continue;
        if (HelmDates::isOverdue(task, sections.date))
            sections.overdue.append(task);
        else if (task.dueDate == sections.date)
            sections.today.append(task);
    }
    std::sort(sections.overdue.begin(), sections.overdue.end(), bySchedule);
    std::sort(sections.today.begin(), sections.today.end(), bySchedule);
    std::stable_sort(sections.done.begin(), sections.done.end(), [](const TaskItem &a, const TaskItem &b) {
        return a.completedAt.value_or(0) > b.completedAt.value_or(0);
    });
    return sections;
}

} // namespace dayhand
