#include "CivilDate.h"

#include <QStringList>

#include <algorithm>

namespace dayhand {

bool isAsciiDigits(QStringView text)
{
    return !text.isEmpty() && std::all_of(text.begin(), text.end(), [](QChar c) { return c >= u'0' && c <= u'9'; });
}

std::optional<CivilDate> CivilDate::of(int year, int month, int day)
{
    if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month))
        return std::nullopt;
    return CivilDate{year, month, day};
}

std::optional<CivilDate> CivilDate::parse(const QString &iso)
{
    const auto parts = iso.split(u'-');
    if (iso.size() != 10 || parts.size() != 3 || parts[0].size() != 4 || parts[1].size() != 2 || parts[2].size() != 2)
        return std::nullopt;
    if (!std::all_of(parts.begin(), parts.end(), [](const QString &part) { return isAsciiDigits(part); }))
        return std::nullopt;
    return of(parts[0].toInt(), parts[1].toInt(), parts[2].toInt());
}

CivilDate CivilDate::fromDayNumber(qint64 dayNumber)
{
    const qint64 z = dayNumber + 719'468;
    const qint64 era = (z >= 0 ? z : z - 146'096) / 146'097;
    const qint64 doe = z - era * 146'097;
    const qint64 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146'096) / 365;
    const qint64 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const qint64 mp = (5 * doy + 2) / 153;
    const qint64 d = doy - (153 * mp + 2) / 5 + 1;
    const qint64 m = mp < 10 ? mp + 3 : mp - 9;
    return {static_cast<int>(yoe + era * 400 + (m <= 2 ? 1 : 0)), static_cast<int>(m), static_cast<int>(d)};
}

qint64 CivilDate::dayNumber() const
{
    const qint64 y = month <= 2 ? year - 1 : year;
    const qint64 era = (y >= 0 ? y : y - 399) / 400;
    const qint64 yoe = y - era * 400;
    const qint64 doy = (153 * (month > 2 ? month - 3 : month + 9) + 2) / 5 + day - 1;
    const qint64 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146'097 + doe - 719'468;
}

QString CivilDate::toString() const
{
    return QStringLiteral("%1-%2-%3")
        .arg(year, 4, 10, QLatin1Char('0'))
        .arg(month, 2, 10, QLatin1Char('0'))
        .arg(day, 2, 10, QLatin1Char('0'));
}

int CivilDate::weekday() const
{
    // 1970-01-01 was a Thursday.
    return static_cast<int>(((dayNumber() % 7) + 7 + 3) % 7) + 1;
}

CivilDate CivilDate::addingMonths(int months) const
{
    const qint64 index = qint64(year) * 12 + (month - 1) + months;
    const qint64 y = index >= 0 ? index / 12 : (index - 11) / 12;
    const int m = static_cast<int>(index - y * 12 + 1);
    const int yy = static_cast<int>(y);
    return {yy, m, std::min(day, daysIn(yy, m))};
}

int CivilDate::daysIn(int year, int month)
{
    switch (month) {
    case 2:
        return isLeap(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
        return 30;
    default:
        return 31;
    }
}

bool CivilDate::isLeap(int year)
{
    return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
}

std::optional<ClockTime> ClockTime::of(int hour, int minute)
{
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59)
        return std::nullopt;
    return ClockTime{hour, minute};
}

std::optional<ClockTime> ClockTime::parse(const QString &text)
{
    const auto parts = text.split(u':');
    if (text.size() != 5 || parts.size() != 2 || parts[0].size() != 2 || parts[1].size() != 2)
        return std::nullopt;
    if (!isAsciiDigits(parts[0]) || !isAsciiDigits(parts[1]))
        return std::nullopt;
    return of(parts[0].toInt(), parts[1].toInt());
}

QString ClockTime::toString() const
{
    return QStringLiteral("%1:%2").arg(hour, 2, 10, QLatin1Char('0')).arg(minute, 2, 10, QLatin1Char('0'));
}

} // namespace dayhand
