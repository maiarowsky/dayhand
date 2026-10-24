#pragma once

#include "CivilDate.h"
#include "TaskItem.h"

#include <QString>
#include <QTimeZone>

namespace dayhand {

/**
 * Calendar dates are plain YYYY-MM-DD strings in the user's time zone, exactly as in `backend/convex/lib/dates.ts`,
 * the Android app's `HelmDates` and the macOS app's `HelmDates.swift`. Everything that decides "today" or "overdue"
 * goes through here. Instants are Unix milliseconds, as the server sends them.
 */
namespace HelmDates {

/// The backend's default when the user has not set a zone (`DEFAULT_SETTINGS.timezone`).
inline const QString defaultTimezone = QStringLiteral("Europe/London");
constexpr qint64 dayMs = 86'400'000;

QTimeZone zone(const QString &timezone);
bool isTimezone(const QString &timezone);

/// The wall clock in [timezone] at instant [epochMs], seconds dropped.
LocalMoment localAt(qint64 epochMs, const QString &timezone);
/// The calendar date at instant [epochMs] in [timezone] (backend `localDate`).
QString localDate(qint64 epochMs, const QString &timezone);
CivilDate today(qint64 epochMs, const QString &timezone);

/**
 * The instant of a wall-clock time, like Temporal's "compatible" choice: a time that happens twice (clocks going
 * back) is the earlier one; a time that does not exist (clocks going forward) moves forward by the gap.
 */
qint64 instantOf(const LocalMoment &local, const QString &timezone);

std::optional<QString> addDays(const QString &date, int days);
/// Overdue = not done, still active, and due before today in the user's zone (backend `isOverdue`).
bool isOverdue(const TaskItem &task, const QString &today);
/// Unix ms of the next local midnight after [epochMs], when "today" changes.
qint64 nextMidnight(qint64 epochMs, const QString &timezone);

qint64 floorDiv(qint64 a, qint64 b);

} // namespace HelmDates

/// Wall-clock time in Unix milliseconds, as the server counts.
qint64 nowMs();

} // namespace dayhand
