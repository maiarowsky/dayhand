#include "Formatting.h"

#include "CivilDate.h"

#include <QStringList>

#include <algorithm>

using namespace Qt::StringLiterals;

namespace dayhand::Formatting {

namespace {

const char *const dayNames[] = {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"};
const char *const monthNames[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};

} // namespace

QString day(const QString &date, const QString &today)
{
    const auto civil = CivilDate::parse(date);
    const auto now = CivilDate::parse(today);
    if (!civil || !now)
        return date;
    switch (now->daysUntil(*civil)) {
    case 0:
        return u"Today"_s;
    case 1:
        return u"Tomorrow"_s;
    case -1:
        return u"Yesterday"_s;
    default:
        break;
    }
    QString text = u"%1 %2 %3"_s.arg(QLatin1StringView(dayNames[civil->weekday() - 1])).arg(civil->day)
                       .arg(QLatin1StringView(monthNames[civil->month - 1]));
    if (civil->year != now->year)
        text += u' ' + QString::number(civil->year);
    return text;
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
        text += u" (%1 does not exist that day)"_s.arg(*when.shiftedFrom);
    return text;
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
    const QString waiting = pending == 1 ? u"1 change waits"_s : u"%1 changes wait"_s.arg(pending);
    switch (status.kind) {
    case SyncStatus::Kind::NotConnected:
        return useOffline ? u"Not connected to a server; tasks stay on this computer."_s : u"No server connected."_s;
    case SyncStatus::Kind::Connecting:
        return u"Connecting…"_s;
    case SyncStatus::Kind::Synced:
        if (pending > 0)
            return pending == 1 ? u"Sending 1 change…"_s : u"Sending %1 changes…"_s.arg(pending);
        return std::nullopt;
    case SyncStatus::Kind::SignedOut:
        return u"The server signed this computer out. Connect again with a new code; your tasks stay here."_s;
    case SyncStatus::Kind::Offline: {
        const QString base = pending > 0 ? u"Offline: %1 for the server."_s.arg(waiting) : u"Cannot reach the server."_s;
        return status.reason.startsWith(u"HTTP 5") ? base + u" The server has a problem."_s : base;
    }
    }
    return std::nullopt;
}

} // namespace dayhand::Formatting
