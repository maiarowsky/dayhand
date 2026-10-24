#pragma once

#include <QJsonValue>
#include <QList>
#include <QString>
#include <QStringList>

#include <optional>

namespace dayhand {

/// Task status, spelled as the backend spells it (`convex/lib/validators.ts`).
enum class TaskStatus { Todo, Doing, Done };

QString statusWire(TaskStatus status);
TaskStatus statusFromWire(const QString &value);

/// Repeat unit, spelled as the backend spells it (`repeatValidator`).
enum class RepeatEvery { Day, Week, Month, Year };

/// The [nth] (1 to 5, or -1 = last to -5) [weekday] (1 = Monday) of a month: "the 2nd Tuesday".
struct WeekdayOfMonth {
    int nth = 1;
    int weekday = 1;

    bool operator==(const WeekdayOfMonth &) const = default;
};

/**
 * Repeat every [interval] units; weekly rules may pick [weekdays] (1 = Monday ... 7 = Sunday), monthly ones may pin
 * [monthDay] (1 to 31, -1 = the last day) or [weekdayOfMonth]. [fromCompletion] counts the next date from the day
 * the task is done instead of its due date; [until] (the last date) or [count] (occurrences left, this one
 * included) end the series. The backend's `repeatValidator`; the dates are in `Recurrence`.
 */
struct RepeatRule {
    RepeatEvery every = RepeatEvery::Day;
    int interval = 1;
    std::optional<QList<int>> weekdays;
    /// "due" or "completion" as sent; unset means "due".
    std::optional<QString> from;
    std::optional<int> monthDay;
    std::optional<WeekdayOfMonth> weekdayOfMonth;
    std::optional<QString> until;
    std::optional<int> count;

    bool fromCompletion() const { return from == QStringLiteral("completion"); }

    /// A rule as the server sends it (numbers may come as `1.0`); anything else is nothing.
    static std::optional<RepeatRule> parse(const QJsonValue &value);
    /// The rule as a mutation argument: required fields always, unset optional ones left out.
    QJsonValue wire() const;

    bool operator==(const RepeatRule &) const = default;
};

/// One checklist item; the list's order is the order shown. [id] stays with the item across edits.
struct ChecklistItem {
    QString id;
    QString title;
    bool done = false;

    static std::optional<ChecklistItem> parse(const QJsonValue &value);
    QJsonValue wire() const;

    bool operator==(const ChecklistItem &) const = default;
};

/**
 * One reminder of a task (`reminderValidator`): [minutesBefore] its due time (timed tasks only), or [time] (HH:MM)
 * on the due day or [daysBefore] days earlier. Exactly one of [minutesBefore] and [time] is set.
 */
struct TaskReminder {
    std::optional<int> minutesBefore;
    std::optional<QString> time;
    std::optional<int> daysBefore;

    static TaskReminder before(int minutes) { return {minutes, std::nullopt, std::nullopt}; }
    static TaskReminder at(const QString &time, int daysBefore = 0)
    {
        return {std::nullopt, time, daysBefore > 0 ? std::optional<int>(daysBefore) : std::nullopt};
    }

    static std::optional<TaskReminder> parse(const QJsonValue &value);
    QJsonValue wire() const;

    bool operator==(const TaskReminder &) const = default;
};

/// A link attached to a task.
struct TaskLink {
    QString url;
    std::optional<QString> title;

    static std::optional<TaskLink> parse(const QJsonValue &value);
    QJsonValue wire() const;

    bool operator==(const TaskLink &) const = default;
};

/**
 * A task as the screens see it. The local database is the source of truth for the UI; the server copy arrives
 * through sync and local changes leave through the outbox.
 *
 * [localId] is stable from the moment the task exists on this computer: the `clientId` of the `add` mutation for
 * tasks created here, the server id for tasks created elsewhere.
 */
struct TaskItem {
    QString localId;
    std::optional<QString> serverId;
    std::optional<QString> clientId;
    QString title;
    std::optional<QString> note;
    /// Calendar day in the user's time zone, YYYY-MM-DD.
    std::optional<QString> dueDate;
    /// Local wall-clock time, HH:MM.
    std::optional<QString> dueTime;
    TaskStatus status = TaskStatus::Todo;
    bool isNow = false;
    /// "Where I stopped / next step".
    std::optional<QString> resumeNote;
    std::optional<qint64> completedAt;
    std::optional<qint64> archivedAt;
    qint64 createdAt = 0;
    qint64 updatedAt = 0;
    /// `updatedAt` of the last server copy merged into this row; nothing until the server has it.
    std::optional<qint64> serverUpdatedAt;
    std::optional<RepeatRule> repeat;
    /// Labels, which also serve as projects (the backend has one list for both).
    QStringList labels;
    QList<TaskLink> links;
    /// In the trash since then; the server purges it 30 days later unless restored.
    std::optional<qint64> deletedAt;
    QList<ChecklistItem> checklist;
    /// This task's own reminders; unset = the default reminders from the settings, empty = none.
    std::optional<QList<TaskReminder>> reminders;

    bool inTrash() const { return deletedAt.has_value(); }
    /// Shown on Today: neither archived nor in the trash.
    bool isActive() const { return !archivedAt && !deletedAt; }

    bool operator==(const TaskItem &) const = default;
};

} // namespace dayhand
