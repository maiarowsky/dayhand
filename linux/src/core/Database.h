#pragma once

#include "Outbox.h"
#include "TaskItem.h"

#include <QList>
#include <QSqlDatabase>
#include <QString>

#include <memory>
#include <optional>
#include <stdexcept>

namespace dayhand {

/// A database call that failed; the repository turns it into a message at its boundary.
struct StoreError : std::runtime_error {
    explicit StoreError(const QString &message)
        : std::runtime_error(message.toStdString())
    {
    }
};

/**
 * The local SQLite database (Qt SQL): the tasks as the screens see them, the outbox of changes waiting for the
 * server and a small key-value table for the server settings and the reminder clock. The screens read only from
 * here, never from the network. Each thread opens its own connection to the same file (WAL, so the screens and the
 * sync worker do not block each other); `:memory:` gives a private database for tests.
 */
class Database {
public:
    static constexpr int schemaVersion = 1;

    /// Opens and migrates the database at [path] (its folder is created), or ":memory:". Throws [StoreError].
    static std::unique_ptr<Database> open(const QString &path);
    ~Database();

    Database(const Database &) = delete;
    Database &operator=(const Database &) = delete;

    QSqlDatabase handle() const;
    const QString &path() const { return file; }

    // Tasks
    QList<TaskItem> tasks() const;
    std::optional<TaskItem> task(const QString &localId) const;
    void save(const TaskItem &task);
    void removeTask(const QString &localId);
    QList<TaskItem> nowTasks() const;

    // Outbox, oldest first
    QList<OutboxOp> pendingOps() const;
    std::optional<OutboxOp> nextOp() const;
    qint64 pendingCount() const;
    void insert(OutboxOp &op);
    void removeOp(qint64 seq);
    void removeOpsOf(const QString &taskLocalId);
    void recordFailure(qint64 seq, const QString &reason);

    // Key-value
    std::optional<QString> meta(const QString &key) const;
    void setMeta(const QString &key, const QString &value);
    void eraseAll();

private:
    explicit Database(QString connection, QString file);
    void migrate();

    QString connection;
    QString file;
};

/// `BEGIN IMMEDIATE` … `COMMIT`, rolled back when left without [commit] (an exception on the way).
class Transaction {
public:
    explicit Transaction(const Database &database);
    ~Transaction();
    void commit();

    Transaction(const Transaction &) = delete;
    Transaction &operator=(const Transaction &) = delete;

private:
    QSqlDatabase db;
    bool done = false;
};

} // namespace dayhand
