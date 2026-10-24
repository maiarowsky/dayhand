#pragma once

#include "CivilDate.h"
#include "TaskItem.h"

#include <QStringList>

#include <optional>

namespace dayhand {

/**
 * The dates a repeating task falls on, exactly as `backend/convex/lib/repeat.ts`, the Android app's
 * `domain/Recurrence.kt` and the macOS app's `Recurrence.swift` compute them: [advance] is what completing a task
 * creates on the server, [occurrences] lists a series ahead. Both walk the same [step]. Pure: plain calendar
 * dates, no time zone.
 */
namespace Recurrence {

/// Months searched for an nth weekday a month may lack (a 5th Monday).
constexpr int maxMonthSearch = 120;
/// Safety net for a due date far in the past; one step per occurrence.
constexpr int maxSteps = 100'000;

/// A date of a series and the rule that continues from it.
struct Position {
    CivilDate date;
    RepeatRule rule;
};

/// The next occurrence after completing a task: its due date and the rule it carries on with.
struct Next {
    QString dueDate;
    RepeatRule repeat;

    bool operator==(const Next &) const = default;
};

/// Day [monthDay] (-1 = the last) of the month of [month]; a day the month lacks becomes its last day.
CivilDate monthDayIn(const CivilDate &month, int monthDay);
/// The [nth] [weekday] (1 = Monday) of the month of [month], negative from its end, or nothing when it has none.
std::optional<CivilDate> nthWeekdayIn(const CivilDate &month, int nth, int weekday);

/// The next date of a series after [date], or nothing when no later date exists.
std::optional<Position> step(const RepeatRule &rule, const CivilDate &date);

/**
 * The next occurrence when a task of [rule] is completed on [today] (YYYY-MM-DD in the user's zone). Counted from
 * the due date, the first date of the series after today: a late completion skips the dates it missed, and they
 * count against `count`. Counted from completion (or without a due date), the first date after today.
 */
std::optional<Next> advance(const RepeatRule &rule, const std::optional<QString> &dueDate, const QString &today);

/// Dates of a series whose first occurrence is [start], from [from] to [to] (both included), at most [limit].
QStringList occurrences(const RepeatRule &rule, const QString &start, const QString &from, const QString &to,
                        int limit = 500);

} // namespace Recurrence
} // namespace dayhand
