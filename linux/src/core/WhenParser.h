#pragma once

#include "CivilDate.h"

#include <QString>
#include <QStringList>

#include <optional>

namespace dayhand {

/// A day, and a time when the phrase named one.
struct When {
    QString date;
    std::optional<QString> time;
    /// The typed time does not exist that day (clocks go forward) and was moved forward to [time].
    std::optional<QString> shiftedFrom;

    bool operator==(const When &) const = default;
};

/// What [WhenParser::parse] made of a phrase: a day, or the reason it is not one.
struct WhenResult {
    std::optional<When> when;
    QString error;

    bool ok() const { return when.has_value(); }
};

/**
 * Dates in plain English, the grammar of `dayhand` (`cli/src/when/parse.ts`) and of the macOS app's `When.swift`,
 * case for case: "tomorrow", "fri 2pm", "next mon", "in 3 days", "23 oct", "2026-10-23". A small deterministic
 * grammar (no NLP): the same phrase at the same moment in the same time zone always gives the same day.
 */
namespace WhenParser {

/// Forms shown in help (`WHEN_EXAMPLES`).
QStringList examples();

WhenResult parse(const QString &text, qint64 now, const QString &timezone);

/// For a day column: "today", "tomorrow", "in 3 days", "2 days ago".
QString relativeDay(const QString &date, const QString &today);

} // namespace WhenParser
} // namespace dayhand
