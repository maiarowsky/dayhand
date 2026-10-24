#pragma once

#include "WhenParser.h"

#include <QString>

#include <optional>

namespace dayhand {

/// What quick add makes of one line: the title, and the day and time from a date phrase at its end.
struct QuickAddInput {
    QString title;
    std::optional<When> when;
    /// The words read as the date ("fri 2pm"), so the field can show what was understood.
    std::optional<QString> phrase;

    bool operator==(const QuickAddInput &) const = default;
};

/**
 * Quick add reads a date phrase at the end of the line, with the same grammar as `dayhand add --due`
 * ([WhenParser]): "Call the accountant fri 2pm" is "Call the accountant" on Friday at 14:00. The longest ending that
 * is a whole phrase wins and at least one word stays as the title, so "Plan next week" is "Plan" next Monday but a
 * line that is only a date ("tomorrow") stays a title. Without a phrase the line is the title and the day is the
 * caller's default. The macOS app's `QuickAdd.swift`, case for case.
 */
namespace QuickAdd {

/// The longest phrase in the grammar has six words ("the 23rd of october 2027 9am").
constexpr int maxPhraseWords = 7;

QuickAddInput parse(const QString &line, qint64 now, const QString &timezone);

} // namespace QuickAdd
} // namespace dayhand
