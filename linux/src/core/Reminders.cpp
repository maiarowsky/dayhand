#include "Reminders.h"

#include "TodaySections.h"

#include <QHash>

#include <algorithm>

namespace dayhand {

namespace {

constexpr qint64 minuteMs = 60'000;

bool earlierRing(const Reminder &a, const Reminder &b)
{
    return a.at != b.at ? a.at < b.at : a.taskLocalId < b.taskLocalId;
}

std::optional<Reminder> reminderOf(const TaskItem &task, const TaskReminder &reminder, const QString &timezone)
{
    const auto date = task.dueDate ? CivilDate::parse(*task.dueDate) : std::nullopt;
    if (!date)
        return std::nullopt;
    if (reminder.minutesBefore) {
        const auto due = ReminderRules::dueAt(task, timezone);
        if (!due)
            return std::nullopt;
        return Reminder{task.localId, task.title, *task.dueDate, task.dueTime, reminder.minutesBefore,
                        *due - qint64(*reminder.minutesBefore) * minuteMs, 0};
    }
    const auto time = reminder.time ? ClockTime::parse(*reminder.time) : std::nullopt;
    if (!time)
        return std::nullopt;
    const int days = reminder.daysBefore.value_or(0);
    const qint64 at = HelmDates::instantOf({date->addingDays(-days), *time}, timezone);
    return Reminder{task.localId, task.title, *task.dueDate, task.dueTime, std::nullopt, at, days};
}

} // namespace

namespace ReminderRules {

std::optional<qint64> dueAt(const TaskItem &task, const QString &timezone)
{
    const auto date = task.dueDate ? CivilDate::parse(*task.dueDate) : std::nullopt;
    const auto time = task.dueTime ? ClockTime::parse(*task.dueTime) : std::nullopt;
    if (!date || !time)
        return std::nullopt;
    return HelmDates::instantOf({*date, *time}, timezone);
}

QList<Reminder> reminders(const QList<TaskItem> &tasks, const QList<int> &minutesBefore, const QString &timezone)
{
    QList<Reminder> out;
    for (const TaskItem &task : tasks) {
        if (task.status == TaskStatus::Done || !task.isActive() || !task.dueDate)
            continue;
        QList<TaskReminder> own;
        if (task.reminders) {
            own = *task.reminders;
        } else {
            for (int minutes : minutesBefore)
                own.append(TaskReminder::before(minutes));
        }
        QList<TaskReminder> seen;
        for (const TaskReminder &reminder : own) {
            if (seen.contains(reminder))
                continue;
            seen.append(reminder);
            const auto ring = reminderOf(task, reminder, timezone);
            if (ring && ring->at > task.updatedAt)
                out.append(*ring);
        }
    }
    std::stable_sort(out.begin(), out.end(), earlierRing);
    return out;
}

std::optional<qint64> nextAlarm(const QList<Reminder> &reminders, qint64 now, qint64 handledUntil)
{
    const qint64 after = std::max(handledUntil, now - lateLimitMs);
    for (const Reminder &reminder : reminders) {
        if (reminder.at > after)
            return reminder.at;
    }
    return std::nullopt;
}

QList<Reminder> due(const QList<Reminder> &reminders, qint64 now, qint64 handledUntil, const QString &timezone)
{
    const QString today = HelmDates::localDate(now, timezone);
    QHash<QString, Reminder> latest;
    for (const Reminder &r : reminders) {
        if (r.at <= handledUntil || r.at > now || now - r.at > lateLimitMs || r.dueDate < today)
            continue;
        const auto found = latest.constFind(r.taskLocalId);
        if (found == latest.constEnd() || found->at < r.at)
            latest.insert(r.taskLocalId, r);
    }
    QList<Reminder> out = latest.values();
    std::sort(out.begin(), out.end(), earlierRing);
    return out;
}

qint64 nextSummaryAt(qint64 now, const QString &summaryTime, const QString &timezone)
{
    const ClockTime time = ClockTime::parse(summaryTime).value_or(*ClockTime::parse(defaultSummaryTime));
    CivilDate day = HelmDates::today(now, timezone);
    while (true) {
        const qint64 at = HelmDates::instantOf({day, time}, timezone);
        if (at > now)
            return at;
        day = day.addingDays(1);
    }
}

} // namespace ReminderRules

MorningSummary morningSummary(const QList<TaskItem> &tasks, qint64 nowMs, const QString &timezone)
{
    const TodaySections sections = todaySections(tasks, nowMs, timezone);
    std::optional<QString> start;
    if (sections.now)
        start = sections.now->title;
    else if (!sections.overdue.isEmpty())
        start = sections.overdue.first().title;
    else if (!sections.today.isEmpty())
        start = sections.today.first().title;
    return {sections.today.size() + (sections.now ? 1 : 0), sections.overdue.size(), start};
}

} // namespace dayhand
