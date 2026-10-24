#include "HelmDates.h"

#include <QDateTime>

#include <algorithm>

namespace dayhand {

qint64 nowMs()
{
    return QDateTime::currentMSecsSinceEpoch();
}

namespace HelmDates {

qint64 floorDiv(qint64 a, qint64 b)
{
    const qint64 q = a / b;
    return (a % b != 0 && (a < 0) != (b < 0)) ? q - 1 : q;
}

QTimeZone zone(const QString &timezone)
{
    QTimeZone wanted(timezone.isEmpty() ? defaultTimezone.toUtf8() : timezone.toUtf8());
    return wanted.isValid() ? wanted : QTimeZone(defaultTimezone.toUtf8());
}

bool isTimezone(const QString &timezone)
{
    return !timezone.isEmpty() && QTimeZone(timezone.toUtf8()).isValid();
}

namespace {

qint64 offsetSeconds(const QTimeZone &zone, qint64 seconds)
{
    return zone.offsetFromUtc(QDateTime::fromSecsSinceEpoch(seconds, QTimeZone::utc()));
}

qint64 naiveMs(const LocalMoment &local)
{
    return local.date.dayNumber() * dayMs + qint64(local.time.minutesOfDay()) * 60'000;
}

qint64 offsetMs(qint64 epochMs, const QTimeZone &zone)
{
    return offsetSeconds(zone, floorDiv(epochMs, 1000)) * 1000;
}

LocalMoment localIn(qint64 epochMs, const QTimeZone &zone)
{
    const qint64 seconds = floorDiv(epochMs, 1000);
    const qint64 local = seconds + offsetSeconds(zone, seconds);
    const qint64 days = floorDiv(local, 86'400);
    const qint64 secondOfDay = local - days * 86'400;
    return {CivilDate::fromDayNumber(days),
            ClockTime{static_cast<int>(secondOfDay / 3600), static_cast<int>(secondOfDay % 3600 / 60)}};
}

} // namespace

LocalMoment localAt(qint64 epochMs, const QString &timezone)
{
    return localIn(epochMs, zone(timezone));
}

QString localDate(qint64 epochMs, const QString &timezone)
{
    return localAt(epochMs, timezone).date.toString();
}

CivilDate today(qint64 epochMs, const QString &timezone)
{
    return localAt(epochMs, timezone).date;
}

qint64 instantOf(const LocalMoment &local, const QString &timezone)
{
    const QTimeZone tz = zone(timezone);
    const qint64 naive = naiveMs(local);
    const qint64 before = naive - offsetMs(naive - dayMs, tz);
    const qint64 after = naive - offsetMs(naive + dayMs, tz);
    const bool beforeValid = localIn(before, tz) == local;
    const bool afterValid = localIn(after, tz) == local;
    if (beforeValid && afterValid)
        return std::min(before, after);
    if (afterValid)
        return after;
    return before;
}

std::optional<QString> addDays(const QString &date, int days)
{
    const auto civil = CivilDate::parse(date);
    if (!civil)
        return std::nullopt;
    return civil->addingDays(days).toString();
}

bool isOverdue(const TaskItem &task, const QString &today)
{
    if (task.status == TaskStatus::Done || task.archivedAt || task.deletedAt || !task.dueDate)
        return false;
    return *task.dueDate < today;
}

qint64 nextMidnight(qint64 epochMs, const QString &timezone)
{
    const CivilDate tomorrow = today(epochMs, timezone).addingDays(1);
    return instantOf({tomorrow, ClockTime{0, 0}}, timezone);
}

} // namespace HelmDates
} // namespace dayhand
