#pragma once

#include <QString>

#include <optional>

namespace dayhand {

/**
 * One local change waiting for the server. Rows are sent strictly in [seq] order and deleted only after the server
 * answered, so they survive the app being quit and the computer restarting.
 *
 * [argsJson] holds the mutation arguments without `taskId`: the task is named by [taskLocalId] and its server id is
 * filled in at send time, because a task created offline has none yet. [clientId] is also inside [argsJson]; the
 * backend applies an operation with a known `clientId` only once, so resending after a lost answer is safe.
 */
struct OutboxOp {
    qint64 seq = 0;
    QString opId;
    /// Convex function name, e.g. `app:add`.
    QString mutation;
    QString argsJson;
    std::optional<QString> taskLocalId;
    QString clientId;
    qint64 createdAt = 0;
    int attempts = 0;
    std::optional<QString> lastError;

    bool operator==(const OutboxOp &) const = default;
};

/// Mutations of the app layer (`backend/convex/app.ts`) that the outbox sends.
namespace Mutations {
inline const QString add = QStringLiteral("app:add");
inline const QString complete = QStringLiteral("app:complete");
inline const QString setStatus = QStringLiteral("app:setStatus");
inline const QString reschedule = QStringLiteral("app:reschedule");
inline const QString archive = QStringLiteral("app:archive");
inline const QString setNow = QStringLiteral("app:setNow");
inline const QString update = QStringLiteral("app:update");
inline const QString softDelete = QStringLiteral("app:softDelete");
inline const QString restore = QStringLiteral("app:restore");
} // namespace Mutations

} // namespace dayhand
