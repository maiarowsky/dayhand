#include "ReminderPlanner.h"

#include "HelmDates.h"

#include <QHash>

#include <algorithm>

using namespace Qt::StringLiterals;

namespace dayhand::ReminderPlanner {

namespace {

bool earlier(const PlannedNotification &a, const PlannedNotification &b)
{
    return a.at != b.at ? a.at < b.at : a.id < b.id;
}

QList<PlannedNotification> summaries(const QList<TaskItem> &tasks, const ReminderSettings &settings, qint64 now)
{
    QList<PlannedNotification> out;
    qint64 after = now;
    for (int day = 0; day < summaryDays; ++day) {
        const qint64 at = ReminderRules::nextSummaryAt(after, settings.summaryTime, settings.timezone);
        const MorningSummary summary = morningSummary(tasks, at, settings.timezone);
        const QString date = HelmDates::localDate(at, settings.timezone);
        out.append({idPrefix + u"summary."_s + date, at, summaryTitle(summary), summaryBody(summary),
                    PlannedNotification::Kind::Summary, QString()});
        after = at;
    }
    return out;
}

} // namespace

QList<PlannedNotification> plan(const QList<TaskItem> &tasks, const ReminderSettings &settings, qint64 now, int limit)
{
    const QString zone = settings.timezone;
    QList<PlannedNotification> rings;
    for (const Reminder &r : ReminderRules::reminders(tasks, settings.reminderMinutes, zone)) {
        if (r.at <= now || r.dueDate < HelmDates::localDate(r.at, zone))
            continue;
        rings.append({idPrefix + u"reminder.%1.%2"_s.arg(r.taskLocalId).arg(r.at), r.at, r.title, reminderBody(r, zone),
                      PlannedNotification::Kind::Reminder, r.taskLocalId});
    }
    rings.append(summaries(tasks, settings, now));
    std::sort(rings.begin(), rings.end(), earlier);
    if (rings.size() > limit)
        rings.resize(limit);
    return rings;
}

QList<PlannedNotification> due(const QList<PlannedNotification> &plan, qint64 now, qint64 handledUntil)
{
    QHash<QString, PlannedNotification> latest;
    for (const PlannedNotification &ring : plan) {
        if (ring.at <= handledUntil || ring.at > now || now - ring.at > ReminderRules::lateLimitMs)
            continue;
        const QString key = ring.kind == PlannedNotification::Kind::Summary ? u"summary"_s : ring.taskLocalId;
        const auto found = latest.constFind(key);
        if (found == latest.constEnd() || found->at < ring.at)
            latest.insert(key, ring);
    }
    QList<PlannedNotification> out = latest.values();
    std::sort(out.begin(), out.end(), earlier);
    return out;
}

std::optional<qint64> nextRing(const QList<PlannedNotification> &plan, qint64 now, qint64 handledUntil)
{
    const qint64 after = std::max(handledUntil, now - ReminderRules::lateLimitMs);
    std::optional<qint64> next;
    for (const PlannedNotification &ring : plan) {
        if (ring.at > after && (!next || ring.at < *next))
            next = ring.at;
    }
    return next;
}

QString reminderBody(const Reminder &reminder, const QString &timezone)
{
    const QString ringDay = HelmDates::localDate(reminder.at, timezone);
    QString day = reminder.dueDate;
    if (reminder.dueDate == ringDay)
        day = u"Today"_s;
    else if (HelmDates::addDays(ringDay, 1) == reminder.dueDate)
        day = u"Tomorrow"_s;
    if (!reminder.dueTime)
        return day;
    if (reminder.minutesBefore == 0)
        return u"Now, %1"_s.arg(*reminder.dueTime);
    return u"%1 at %2"_s.arg(day, *reminder.dueTime);
}

QString summaryTitle(const MorningSummary &summary)
{
    const QString today = summary.today == 1 ? u"1 task today"_s : u"%1 tasks today"_s.arg(summary.today);
    return summary.overdue == 0 ? today : u"%1, %2 overdue"_s.arg(today).arg(summary.overdue);
}

QString summaryBody(const MorningSummary &summary)
{
    if (!summary.startWith)
        return u"Nothing planned. Add a task with the quick add shortcut."_s;
    return u"Start with: %1"_s.arg(*summary.startWith);
}

} // namespace dayhand::ReminderPlanner
