#pragma once

#include "Database.h"
#include "Outbox.h"
#include "RemoteModel.h"
#include "Reminders.h"
#include "TaskItem.h"

#include <QJsonObject>
#include <QJsonValue>

#include <functional>
#include <optional>

namespace dayhand {

/// A change refused before it reached the outbox (the server would refuse it too).
struct InvalidChange : std::runtime_error {
    explicit InvalidChange(const QString &message)
        : std::runtime_error(message.toStdString())
    {
    }
};

/**
 * Every user action changes the local row and appends its server mutation to the outbox in one transaction, as
 * the Android app's `TaskRepository` and the macOS app's `TaskRepository.swift`, so the screen updates at once and
 * the change cannot be lost or sent without being shown. [onChanged] tells the screens and wakes the sync worker.
 * Throws [InvalidChange] for input the backend would refuse and [StoreError] when the database fails.
 */
class TaskRepository {
public:
    struct Hooks {
        std::function<qint64()> clock;
        std::function<QString()> newId;
        /// The time zone of this computer, which decides "today" until a server has sent its settings.
        std::function<QString()> localTimezone;
        /// After every local change that queued a mutation.
        std::function<void()> onChanged;
    };

    TaskRepository(Database &database, Hooks hooks);

    Database &database() { return db; }

    // Reading
    QList<TaskItem> allTasks() const { return db.tasks(); }
    std::optional<TaskItem> task(const QString &localId) const { return db.task(localId); }
    QList<OutboxOp> pendingOps() const { return db.pendingOps(); }
    qint64 pendingCount() const { return db.pendingCount(); }
    /// The server's settings; until a server has sent them, the day and the reminders follow this computer's zone.
    ReminderSettings settings() const;

    // Changes
    TaskItem add(const QString &title, const std::optional<QString> &dueDate, const std::optional<QString> &dueTime,
                 const std::optional<QString> &note = std::nullopt);
    void complete(const QString &localId);
    /// Back from done to the to-do list.
    void reopen(const QString &localId);
    void rename(const QString &localId, const QString &title);
    /// Sets the day (YYYY-MM-DD) and the optional time (HH:MM); no day clears both.
    void setDue(const QString &localId, const std::optional<QString> &date, const std::optional<QString> &time);
    /// Moves a task to [date] (YYYY-MM-DD), keeping its time.
    void reschedule(const QString &localId, const QString &date);
    void setResumeNote(const QString &localId, const QString &note);
    void archive(const QString &localId);
    /// Moves a task to the trash; the server keeps it there for 30 days.
    void moveToTrash(const QString &localId);
    /// Brings a task back from the trash, or from the archive when it is not in the trash (backend `restore`).
    void restore(const QString &localId);
    /// Makes [localId] the single "now" task (status doing), as the backend's `setNow` does.
    void setNow(const QString &localId);
    /// No task is "now" any more.
    void clearNow();

    // Server snapshots
    /// Writes a server snapshot into the database (see `SnapshotMerger`) and keeps its settings.
    void apply(const Snapshot &snapshot);
    /// Forgets every task and waiting change (pairing with another account).
    void eraseAll() { db.eraseAll(); }

    // The outbox, as the processor needs it
    std::optional<OutboxOp> next() const { return db.nextOp(); }
    std::optional<QString> serverIdOf(const QString &taskLocalId) const;
    /// The server applied [op]: forget it (and remember the server id of a new task).
    void acknowledge(const OutboxOp &op, const QJsonValue &value);
    /// The server refused [op] for good: forget it and let the next snapshot repair the row.
    void reject(const OutboxOp &op);
    void recordFailure(const OutboxOp &op, const QString &reason) { db.recordFailure(op.seq, reason); }

private:
    using Change = std::function<void(TaskItem &, qint64)>;

    void edit(const QString &localId, const QString &mutation, const QJsonObject &args, const Change &change);
    OutboxOp makeOp(const QString &mutation, const std::optional<QString> &taskLocalId, QJsonObject args, qint64 now,
                    const std::optional<QString> &clientId = std::nullopt);
    void changed();

    Database &db;
    Hooks hooks;
};

} // namespace dayhand
