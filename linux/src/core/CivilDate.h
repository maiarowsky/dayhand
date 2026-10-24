#pragma once

#include <QString>

#include <compare>
#include <optional>

namespace dayhand {

/**
 * A calendar day with no time zone, the YYYY-MM-DD of the backend (`convex/lib/dates.ts`). Adding days or months
 * never shifts by an hour; only instants go through a zone (`HelmDates`). The arithmetic is Howard Hinnant's
 * days-from-civil, as in the macOS app's `CivilDate.swift`, so it does not depend on the machine's calendar or locale.
 */
struct CivilDate {
    int year = 1970;
    int month = 1;
    int day = 1;

    /// A real day of the Gregorian calendar, or nothing (30 Feb, month 13).
    static std::optional<CivilDate> of(int year, int month, int day);
    /// Exactly `YYYY-MM-DD` naming a real day, or nothing.
    static std::optional<CivilDate> parse(const QString &iso);
    /// The day [dayNumber] days after 1970-01-01.
    static CivilDate fromDayNumber(qint64 dayNumber);

    static int daysIn(int year, int month);
    static bool isLeap(int year);

    /// Days since 1970-01-01.
    qint64 dayNumber() const;
    QString toString() const;
    /// ISO weekday: Monday = 1 ... Sunday = 7.
    int weekday() const;
    int lengthOfMonth() const { return daysIn(year, month); }
    CivilDate firstOfMonth() const { return {year, month, 1}; }
    CivilDate lastOfMonth() const { return {year, month, lengthOfMonth()}; }
    CivilDate addingDays(qint64 days) const { return fromDayNumber(dayNumber() + days); }
    /// Same day of the month, clamped to the target month's last day (31 Jan + 1 month = 28 Feb).
    CivilDate addingMonths(int months) const;
    CivilDate addingYears(int years) const { return addingMonths(12 * years); }
    /// This month's [day], which must exist.
    CivilDate withDay(int newDay) const { return {year, month, newDay}; }
    qint64 daysUntil(const CivilDate &other) const { return other.dayNumber() - dayNumber(); }

    auto operator<=>(const CivilDate &) const = default;
};

/// A wall-clock time `HH:MM` (00:00 to 23:59).
struct ClockTime {
    int hour = 0;
    int minute = 0;

    static std::optional<ClockTime> of(int hour, int minute);
    /// Exactly `HH:MM`, or nothing.
    static std::optional<ClockTime> parse(const QString &text);

    int minutesOfDay() const { return hour * 60 + minute; }
    QString toString() const;

    auto operator<=>(const ClockTime &) const = default;
};

/// A wall-clock moment in a zone: a day and an `HH:MM` time.
struct LocalMoment {
    CivilDate date;
    ClockTime time;

    bool operator==(const LocalMoment &) const = default;
};

/// True when every character of [text] is an ASCII digit and there is at least one.
bool isAsciiDigits(QStringView text);

} // namespace dayhand
