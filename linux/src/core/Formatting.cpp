#include "Formatting.h"

#include "CivilDate.h"
#include "Recurrence.h"

#include <QLocale>

#include <QCoreApplication>
#include <QStringList>

#include <algorithm>

using namespace Qt::StringLiterals;

namespace dayhand::Formatting {

namespace {

/// The context of this file's texts in the translations.
struct Texts {
    Q_DECLARE_TR_FUNCTIONS(Formatting)
};

// The short names on Today and in quick add's preview; translators may reorder the date with "%1 %2 %3".
const char *const dayNames[] = {
    QT_TRANSLATE_NOOP("Formatting", "Mon"), QT_TRANSLATE_NOOP("Formatting", "Tue"),
    QT_TRANSLATE_NOOP("Formatting", "Wed"), QT_TRANSLATE_NOOP("Formatting", "Thu"),
    QT_TRANSLATE_NOOP("Formatting", "Fri"), QT_TRANSLATE_NOOP("Formatting", "Sat"),
    QT_TRANSLATE_NOOP("Formatting", "Sun"),
};
const char *const monthNames[] = {
    QT_TRANSLATE_NOOP("Formatting", "Jan"), QT_TRANSLATE_NOOP("Formatting", "Feb"),
    QT_TRANSLATE_NOOP("Formatting", "Mar"), QT_TRANSLATE_NOOP("Formatting", "Apr"),
    QT_TRANSLATE_NOOP("Formatting", "May"), QT_TRANSLATE_NOOP("Formatting", "Jun"),
    QT_TRANSLATE_NOOP("Formatting", "Jul"), QT_TRANSLATE_NOOP("Formatting", "Aug"),
    QT_TRANSLATE_NOOP("Formatting", "Sep"), QT_TRANSLATE_NOOP("Formatting", "Oct"),
    QT_TRANSLATE_NOOP("Formatting", "Nov"), QT_TRANSLATE_NOOP("Formatting", "Dec"),
};

} // namespace

QString day(const QString &date, const QString &today)
{
    const auto civil = CivilDate::parse(date);
    const auto now = CivilDate::parse(today);
    if (!civil || !now)
        return date;
    switch (now->daysUntil(*civil)) {
    case 0:
        return Texts::tr("Today");
    case 1:
        return Texts::tr("Tomorrow");
    case -1:
        return Texts::tr("Yesterday");
    default:
        break;
    }
    QString text = dayName(date);
    if (civil->year != now->year)
        text = Texts::tr("%1 %2", "a date and its year").arg(text).arg(civil->year);
    return text;
}

QString dayName(const QString &date)
{
    const auto civil = CivilDate::parse(date);
    if (!civil)
        return date;
    return Texts::tr("%1 %2 %3", "weekday, day of the month, month: Sat 24 Oct")
        .arg(Texts::tr(dayNames[civil->weekday() - 1]))
        .arg(civil->day)
        .arg(Texts::tr(monthNames[civil->month - 1]));
}

QString trashExpiry(qint64 deletedAt, const QString &today, const QString &timezone)
{
    constexpr qint64 retentionMs = 30LL * 24 * 60 * 60 * 1000;
    const auto date = CivilDate::parse(HelmDates::localDate(deletedAt + retentionMs, timezone));
    if (!date)
        return {};
    QString text = Texts::tr("%1 %2", "day of the month, month: 23 Nov")
                       .arg(date->day).arg(Texts::tr(monthNames[date->month - 1]));
    if (const auto now = CivilDate::parse(today); now && now->year != date->year)
        text = Texts::tr("%1 %2", "a date and its year").arg(text).arg(date->year);
    return Texts::tr("Permanently deleted on %1").arg(text);
}

std::optional<QString> due(const TaskItem &task, const QString &today)
{
    if (!task.dueDate)
        return std::nullopt;
    const QString dayText = day(*task.dueDate, today);
    return task.dueTime ? u"%1, %2"_s.arg(dayText, *task.dueTime) : dayText;
}

QString when(const When &when, const QString &today)
{
    QString text = day(when.date, today);
    if (when.time)
        text += u", "_s + *when.time;
    if (when.shiftedFrom)
        text += u' ' + Texts::tr("(%1 does not exist that day)", "a clock time skipped by a daylight saving change")
                           .arg(*when.shiftedFrom);
    return text;
}

QString repeat(const TaskItem &task, const QString &today)
{
    if (!task.repeat)
        return Texts::tr("Does not repeat");
    const RepeatRule &rule = *task.repeat;
    QStringList parts;
    switch (rule.every) {
    case RepeatEvery::Day:
        parts.append(Texts::tr("Every %n day(s)", nullptr, rule.interval));
        break;
    case RepeatEvery::Week:
        parts.append(Texts::tr("Every %n week(s)", nullptr, rule.interval));
        break;
    case RepeatEvery::Month:
        parts.append(Texts::tr("Every %n month(s)", nullptr, rule.interval));
        break;
    case RepeatEvery::Year:
        parts.append(Texts::tr("Every %n year(s)", nullptr, rule.interval));
        break;
    }
    if (rule.weekdays) {
        QStringList days;
        for (int weekday : *rule.weekdays)
            days.append(QLocale().dayName(weekday, QLocale::ShortFormat));
        parts.append(days.join(u", "_s));
    }
    if (rule.monthDay)
        parts.append(*rule.monthDay == -1 ? Texts::tr("Last day of the month")
                                         : Texts::tr("Day of month: %1").arg(*rule.monthDay));
    if (rule.weekdayOfMonth)
        parts.append(Texts::tr("Weekday of month: %1, %2")
                         .arg(rule.weekdayOfMonth->nth)
                         .arg(QLocale().dayName(rule.weekdayOfMonth->weekday)));
    parts.append(rule.fromCompletion() ? Texts::tr("From completion") : Texts::tr("From due date"));
    if (rule.until)
        parts.append(Texts::tr("Until %1").arg(day(*rule.until, today)));
    if (rule.count)
        parts.append(Texts::tr("Occurrences left: %1").arg(*rule.count));
    if (const auto next = Recurrence::advance(rule, task.dueDate, today))
        parts.append(Texts::tr("Next: %1").arg(day(next->dueDate, today)));
    return parts.join(u" · "_s);
}

QString reminders(const TaskItem &task, const ReminderSettings &settings)
{
    QList<TaskReminder> reminders;
    if (task.reminders) {
        reminders = *task.reminders;
    } else {
        for (int minutes : settings.reminderMinutes)
            reminders.append(TaskReminder::before(minutes));
    }
    if (reminders.isEmpty())
        return Texts::tr("None");
    QStringList parts;
    for (const TaskReminder &reminder : reminders) {
        if (reminder.minutesBefore)
            parts.append(Texts::tr("%n minute(s) before", nullptr, *reminder.minutesBefore));
        else if (reminder.time)
            parts.append(reminder.daysBefore ? Texts::tr("%1, %n day(s) before", nullptr, *reminder.daysBefore).arg(*reminder.time)
                                              : Texts::tr("%1 on the due day").arg(*reminder.time));
    }
    const QString text = parts.join(u" · "_s);
    return task.reminders ? text : Texts::tr("Default: %1").arg(text);
}

QString detailLine(const TaskItem &task, const QString &today, bool overdue)
{
    QStringList parts;
    if (overdue) {
        if (const auto text = due(task, today))
            parts.append(*text);
    } else if (task.dueTime && task.dueDate == today) {
        parts.append(*task.dueTime);
    }
    if (task.repeat)
        parts.append(u"↻"_s);
    if (!task.checklist.isEmpty()) {
        const auto done = std::count_if(task.checklist.begin(), task.checklist.end(), [](const auto &i) { return i.done; });
        parts.append(u"%1/%2"_s.arg(done).arg(task.checklist.size()));
    }
    for (const QString &label : task.labels)
        parts.append(u'#' + label);
    return parts.join(u"  "_s);
}

std::optional<QString> status(const SyncStatus &status, qint64 pending, bool useOffline)
{
    const int count = int(pending);
    switch (status.kind) {
    case SyncStatus::Kind::NotConnected:
        return useOffline ? Texts::tr("Not connected to a server; tasks stay on this computer.")
                          : Texts::tr("No server connected.");
    case SyncStatus::Kind::Connecting:
        return Texts::tr("Connecting…");
    case SyncStatus::Kind::Synced:
        if (pending > 0)
            return Texts::tr("Sending %n change(s)…", nullptr, count);
        return std::nullopt;
    case SyncStatus::Kind::SignedOut:
        return Texts::tr("The server signed this computer out. Connect again with a new code; your tasks stay here.");
    case SyncStatus::Kind::Offline: {
        const QString base = pending > 0 ? Texts::tr("Offline: %n change(s) wait for the server.", nullptr, count)
                                         : Texts::tr("Cannot reach the server.");
        return status.reason.startsWith(u"HTTP 5") ? base + u' ' + Texts::tr("The server has a problem.") : base;
    }
    }
    return std::nullopt;
}

} // namespace dayhand::Formatting
