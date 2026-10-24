#include "Recurrence.h"

#include <algorithm>
#include <climits>

namespace dayhand::Recurrence {

namespace {

int mod(int a, int n)
{
    return ((a % n) + n) % n;
}

std::optional<Position> weekStep(const RepeatRule &rule, const CivilDate &date)
{
    if (!rule.weekdays || rule.weekdays->isEmpty())
        return Position{date.addingDays(qint64(7) * rule.interval), rule};
    QList<int> days = *rule.weekdays;
    std::sort(days.begin(), days.end());
    const int current = date.weekday();
    const auto later = std::find_if(days.begin(), days.end(), [current](int day) { return day > current; });
    if (later != days.end())
        return Position{date.addingDays(*later - current), rule};
    const CivilDate monday = date.addingDays(-(current - 1));
    return Position{monday.addingDays(qint64(7) * rule.interval + days.first() - 1), rule};
}

std::optional<Position> monthStep(const RepeatRule &rule, const CivilDate &date)
{
    if (rule.monthDay) {
        const CivilDate sameMonth = monthDayIn(date, *rule.monthDay);
        const CivilDate next = sameMonth > date
            ? sameMonth
            : monthDayIn(date.firstOfMonth().addingMonths(rule.interval), *rule.monthDay);
        return Position{next, rule};
    }
    if (rule.weekdayOfMonth) {
        const CivilDate start = date.firstOfMonth();
        for (int k = 0; k <= maxMonthSearch; k += std::max(1, rule.interval)) {
            const auto found = nthWeekdayIn(start.addingMonths(k), rule.weekdayOfMonth->nth, rule.weekdayOfMonth->weekday);
            if (found && *found > date)
                return Position{*found, rule};
        }
        return std::nullopt;
    }
    const CivilDate next = date.addingMonths(rule.interval);
    RepeatRule carried = rule;
    // A 29-31 moved to a shorter month's last day keeps the intended day from then on.
    if (next.day < date.day)
        carried.monthDay = date.day;
    return Position{next, carried};
}

} // namespace

CivilDate monthDayIn(const CivilDate &month, int monthDay)
{
    const int last = month.lengthOfMonth();
    return month.withDay(monthDay == -1 ? last : std::min(monthDay, last));
}

std::optional<CivilDate> nthWeekdayIn(const CivilDate &month, int nth, int weekday)
{
    const CivilDate first = month.firstOfMonth();
    const int last = month.lengthOfMonth();
    if (nth > 0) {
        const int day = 1 + mod(weekday - first.weekday(), 7) + 7 * (nth - 1);
        return day <= last ? std::optional(first.withDay(day)) : std::nullopt;
    }
    const CivilDate lastDay = first.withDay(last);
    const int day = last - mod(lastDay.weekday() - weekday, 7) - 7 * (-nth - 1);
    return day >= 1 ? std::optional(first.withDay(day)) : std::nullopt;
}

std::optional<Position> step(const RepeatRule &rule, const CivilDate &date)
{
    switch (rule.every) {
    case RepeatEvery::Day:
        return Position{date.addingDays(rule.interval), rule};
    case RepeatEvery::Year:
        // Keeps the day where the month allows it (29 Feb -> 28 Feb), as the backend's addMonths.
        return Position{date.addingYears(rule.interval), rule};
    case RepeatEvery::Week:
        return weekStep(rule, date);
    case RepeatEvery::Month:
        return monthStep(rule, date);
    }
    return std::nullopt;
}

std::optional<Next> advance(const RepeatRule &rule, const std::optional<QString> &dueDate, const QString &today)
{
    const auto day = CivilDate::parse(today);
    if (!day)
        return std::nullopt;
    const auto due = dueDate ? CivilDate::parse(*dueDate) : std::nullopt;
    Position position{rule.fromCompletion() ? *day : due.value_or(*day), rule};
    int steps = 0;
    do {
        const auto next = step(position.rule, position.date);
        if (!next)
            return std::nullopt;
        position = *next;
        if (++steps > maxSteps)
            return std::nullopt;
    } while (position.date <= *day);
    if (rule.until && position.date.toString() > *rule.until)
        return std::nullopt;
    if (!rule.count)
        return Next{position.date.toString(), position.rule};
    const int left = *rule.count - steps;
    if (left < 1)
        return std::nullopt;
    RepeatRule carried = position.rule;
    carried.count = left;
    return Next{position.date.toString(), carried};
}

QStringList occurrences(const RepeatRule &rule, const QString &start, const QString &from, const QString &to, int limit)
{
    const auto first = CivilDate::parse(from);
    const auto last = CivilDate::parse(to);
    const auto startDate = CivilDate::parse(start);
    if (!first || !last || !startDate)
        return {};
    QStringList dates;
    std::optional<Position> position = Position{*startDate, rule};
    int left = rule.count.value_or(INT_MAX);
    while (position && position->date <= *last && dates.size() < limit) {
        if (rule.until && position->date.toString() > *rule.until)
            break;
        if (position->date >= *first)
            dates.append(position->date.toString());
        if (--left < 1)
            break;
        position = step(position->rule, position->date);
    }
    return dates;
}

} // namespace dayhand::Recurrence
