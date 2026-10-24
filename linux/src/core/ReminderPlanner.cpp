#include "ReminderPlanner.h"

#include "HelmDates.h"

#include <QCoreApplication>
#include <QHash>

#include <algorithm>

using namespace Qt::StringLiterals;

namespace dayhand::ReminderPlanner {

namespace {

/// The context of this file's texts in the translations.
struct Texts {
    Q_DECLARE_TR_FUNCTIONS(ReminderPlanner)
};

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
        day = Texts::tr("Today");
    else if (HelmDates::addDays(ringDay, 1) == reminder.dueDate)
        day = Texts::tr("Tomorrow");
    if (!reminder.dueTime)
        return day;
    if (reminder.minutesBefore == 0)
        return Texts::tr("Now, %1", "a reminder at the task's time").arg(*reminder.dueTime);
    return Texts::tr("%1 at %2", "a reminder before the task: Today at 09:00").arg(day, *reminder.dueTime);
}

QString summaryTitle(const MorningSummary &summary)
{
    const QString today = Texts::tr("%n task(s) today", "morning summary", int(summary.today));
    if (summary.overdue == 0)
        return today;
    return Texts::tr("%1, %n overdue", "morning summary: 1 task today, 2 overdue", int(summary.overdue)).arg(today);
}

QString summaryBody(const MorningSummary &summary)
{
    if (!summary.startWith)
        return Texts::tr("Nothing planned. Add a task with the quick add shortcut.");
    return Texts::tr("Start with: %1", "morning summary: the first task").arg(*summary.startWith);
}

} // namespace dayhand::ReminderPlanner
