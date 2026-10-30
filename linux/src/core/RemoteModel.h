#pragma once

#include "Reminders.h"
#include "TaskItem.h"

#include <QJsonValue>
#include <QList>
#include <QString>

#include <optional>

namespace dayhand {

/// A task as the app layer returns it (`toTask` in `backend/convex/lib/core.ts`).
struct RemoteTask {
    QString id;
    std::optional<QString> clientId;
    QString title;
    std::optional<QString> note;
    std::optional<QString> dueDate;
    std::optional<QString> dueTime;
    QString status = QStringLiteral("todo");
    bool isNow = false;
    std::optional<QString> resumeNote;
    std::optional<qint64> completedAt;
    std::optional<qint64> archivedAt;
    qint64 createdAt = 0;
    qint64 updatedAt = 0;
    std::optional<RepeatRule> repeat;
    QList<TaskLink> links;
    std::optional<qint64> deletedAt;
    QList<ChecklistItem> checklist;
    /// Unset: the default reminders from the settings.
    std::optional<QList<TaskReminder>> reminders;

    bool operator==(const RemoteTask &) const = default;
};

/// Every task (the trash included) and the settings, as one poll of the server sees them.
struct Snapshot {
    QList<RemoteTask> tasks;
    ReminderSettings settings;
};

/// What the server did with one mutation or query.
struct SendResult {
    enum class Kind {
        /// The server applied the mutation (or had already applied it: same `clientId`).
        Applied,
        /// The server's function refused it for good (bad argument, task gone); resending cannot help.
        Rejected,
        /// The token is missing, wrong or expired; keep the change until the user fixes it.
        Unauthorized,
        /// No answer or a transient server problem; try again later.
        Failed,
    };

    Kind kind = Kind::Failed;
    QJsonValue value;
    QString message;

    static SendResult applied(const QJsonValue &value) { return {Kind::Applied, value, {}}; }
    static SendResult rejected(const QString &message) { return {Kind::Rejected, {}, message}; }
    static SendResult unauthorized() { return {Kind::Unauthorized, {}, {}}; }
    static SendResult failed(const QString &message) { return {Kind::Failed, {}, message}; }
};

/// Parsing of the app layer's JSON. Convex sends `v.number()` fields as JSON doubles.
namespace RemoteJson {

inline const QString queryTasks = QStringLiteral("app:listAll");
inline const QString querySettings = QStringLiteral("app:getSettings");
inline const QString queryTrash = QStringLiteral("app:listTrash");
inline const QString queryTask = QStringLiteral("app:getTask");

/// Arguments of [queryTasks]: everything except the trash, done and archived included.
QJsonValue tasksArgs();

std::optional<RemoteTask> task(const QJsonValue &value);
QList<RemoteTask> tasks(const QJsonValue &value);
/// Missing settings take the backend defaults.
ReminderSettings settings(const QJsonValue &value);
QJsonValue settingsJson(const ReminderSettings &settings);
/// A snapshot from the results of [queryTasks], [queryTrash] and [querySettings].
Snapshot snapshot(const QJsonValue &active, const QJsonValue &trash, const QJsonValue &settings);
/// The `{code}` a ConvexError carries in its data, e.g. `unauthenticated`.
QString errorCode(const QJsonValue &data);

} // namespace RemoteJson
} // namespace dayhand
