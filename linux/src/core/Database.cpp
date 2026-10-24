#include "Database.h"

#include "TaskRows.h"

#include <QAtomicInteger>
#include <QDir>
#include <QFileInfo>
#include <QSqlError>
#include <QSqlQuery>
#include <QVariant>

using namespace Qt::StringLiterals;

namespace dayhand {

namespace {

QAtomicInteger<int> connectionCounter;

const char *const schemaV1[] = {
    "CREATE TABLE task ("
    " localId TEXT PRIMARY KEY NOT NULL, serverId TEXT UNIQUE, clientId TEXT, title TEXT NOT NULL, note TEXT,"
    " dueDate TEXT, dueTime TEXT, status TEXT NOT NULL, isNow INTEGER NOT NULL DEFAULT 0, resumeNote TEXT,"
    " completedAt INTEGER, archivedAt INTEGER, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,"
    " serverUpdatedAt INTEGER, repeat TEXT, labels TEXT NOT NULL DEFAULT '[]', links TEXT NOT NULL DEFAULT '[]',"
    " deletedAt INTEGER, checklist TEXT NOT NULL DEFAULT '[]', reminders TEXT)",
    "CREATE INDEX task_clientId ON task (clientId)",
    "CREATE TABLE outbox ("
    " seq INTEGER PRIMARY KEY AUTOINCREMENT, opId TEXT NOT NULL UNIQUE, mutation TEXT NOT NULL,"
    " argsJson TEXT NOT NULL, taskLocalId TEXT, clientId TEXT NOT NULL, createdAt INTEGER NOT NULL,"
    " attempts INTEGER NOT NULL DEFAULT 0, lastError TEXT)",
    "CREATE INDEX outbox_taskLocalId ON outbox (taskLocalId)",
    "CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
};

QSqlQuery run(const QSqlDatabase &db, const QString &sql, const QVariantList &binds = {})
{
    QSqlQuery query(db);
    if (!query.prepare(sql))
        throw StoreError(u"SQL prepare failed: %1"_s.arg(query.lastError().text()));
    for (const QVariant &value : binds)
        query.addBindValue(value);
    if (!query.exec())
        throw StoreError(u"SQL failed: %1"_s.arg(query.lastError().text()));
    return query;
}

QVariant text(const std::optional<QString> &value)
{
    return value ? QVariant(*value) : QVariant(QMetaType::fromType<QString>());
}

OutboxOp readOp(const QSqlQuery &q)
{
    OutboxOp op;
    op.seq = q.value(0).toLongLong();
    op.opId = q.value(1).toString();
    op.mutation = q.value(2).toString();
    op.argsJson = q.value(3).toString();
    if (!q.value(4).isNull())
        op.taskLocalId = q.value(4).toString();
    op.clientId = q.value(5).toString();
    op.createdAt = q.value(6).toLongLong();
    op.attempts = q.value(7).toInt();
    if (!q.value(8).isNull())
        op.lastError = q.value(8).toString();
    return op;
}

const QString opColumns = u"seq, opId, mutation, argsJson, taskLocalId, clientId, createdAt, attempts, lastError"_s;

} // namespace

std::unique_ptr<Database> Database::open(const QString &path)
{
    if (path != u":memory:")
        QDir().mkpath(QFileInfo(path).absolutePath());
    const QString name = u"dayhand-%1"_s.arg(connectionCounter.fetchAndAddRelaxed(1));
    QSqlDatabase db = QSqlDatabase::addDatabase(u"QSQLITE"_s, name);
    db.setDatabaseName(path);
    db.setConnectOptions(u"QSQLITE_BUSY_TIMEOUT=5000"_s);
    if (!db.open()) {
        const QString reason = db.lastError().text();
        db = QSqlDatabase();
        QSqlDatabase::removeDatabase(name);
        throw StoreError(u"The database could not be opened: %1"_s.arg(reason));
    }
    std::unique_ptr<Database> database(new Database(name, path));
    database->migrate();
    return database;
}

Database::Database(QString connection, QString file)
    : connection(std::move(connection))
    , file(std::move(file))
{
}

Database::~Database()
{
    {
        QSqlDatabase db = QSqlDatabase::database(connection, false);
        db.close();
    }
    QSqlDatabase::removeDatabase(connection);
}

QSqlDatabase Database::handle() const
{
    return QSqlDatabase::database(connection, false);
}

void Database::migrate()
{
    const QSqlDatabase db = handle();
    if (file != u":memory:")
        run(db, u"PRAGMA journal_mode=WAL"_s);
    QSqlQuery version = run(db, u"PRAGMA user_version"_s);
    const int current = version.next() ? version.value(0).toInt() : 0;
    if (current >= schemaVersion)
        return;
    Transaction transaction(*this);
    for (const char *statement : schemaV1)
        run(db, QString::fromLatin1(statement));
    run(db, u"PRAGMA user_version = %1"_s.arg(schemaVersion));
    transaction.commit();
}

QList<TaskItem> Database::tasks() const
{
    QSqlQuery q = run(handle(), u"SELECT %1 FROM task"_s.arg(TaskRows::columns()));
    QList<TaskItem> out;
    while (q.next())
        out.append(TaskRows::read(q));
    return out;
}

std::optional<TaskItem> Database::task(const QString &localId) const
{
    QSqlQuery q = run(handle(), u"SELECT %1 FROM task WHERE localId = ?"_s.arg(TaskRows::columns()), {localId});
    if (!q.next())
        return std::nullopt;
    return TaskRows::read(q);
}

QList<TaskItem> Database::nowTasks() const
{
    QSqlQuery q = run(handle(), u"SELECT %1 FROM task WHERE isNow = 1"_s.arg(TaskRows::columns()));
    QList<TaskItem> out;
    while (q.next())
        out.append(TaskRows::read(q));
    return out;
}

void Database::save(const TaskItem &task)
{
    run(handle(), TaskRows::upsertSql(), TaskRows::values(task));
}

void Database::removeTask(const QString &localId)
{
    run(handle(), u"DELETE FROM task WHERE localId = ?"_s, {localId});
}

QList<OutboxOp> Database::pendingOps() const
{
    QSqlQuery q = run(handle(), u"SELECT %1 FROM outbox ORDER BY seq"_s.arg(opColumns));
    QList<OutboxOp> out;
    while (q.next())
        out.append(readOp(q));
    return out;
}

std::optional<OutboxOp> Database::nextOp() const
{
    QSqlQuery q = run(handle(), u"SELECT %1 FROM outbox ORDER BY seq LIMIT 1"_s.arg(opColumns));
    if (!q.next())
        return std::nullopt;
    return readOp(q);
}

qint64 Database::pendingCount() const
{
    QSqlQuery q = run(handle(), u"SELECT COUNT(*) FROM outbox"_s);
    return q.next() ? q.value(0).toLongLong() : 0;
}

void Database::insert(OutboxOp &op)
{
    QSqlQuery q = run(handle(),
                      u"INSERT INTO outbox (opId, mutation, argsJson, taskLocalId, clientId, createdAt, attempts, lastError)"
                      " VALUES (?, ?, ?, ?, ?, ?, ?, ?)"_s,
                      {op.opId, op.mutation, op.argsJson, text(op.taskLocalId), op.clientId, op.createdAt, op.attempts,
                       text(op.lastError)});
    op.seq = q.lastInsertId().toLongLong();
}

void Database::removeOp(qint64 seq)
{
    run(handle(), u"DELETE FROM outbox WHERE seq = ?"_s, {seq});
}

void Database::removeOpsOf(const QString &taskLocalId)
{
    run(handle(), u"DELETE FROM outbox WHERE taskLocalId = ?"_s, {taskLocalId});
}

void Database::recordFailure(qint64 seq, const QString &reason)
{
    run(handle(), u"UPDATE outbox SET attempts = attempts + 1, lastError = ? WHERE seq = ?"_s, {reason, seq});
}

std::optional<QString> Database::meta(const QString &key) const
{
    QSqlQuery q = run(handle(), u"SELECT value FROM meta WHERE key = ?"_s, {key});
    if (!q.next())
        return std::nullopt;
    return q.value(0).toString();
}

void Database::setMeta(const QString &key, const QString &value)
{
    run(handle(), u"INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"_s,
        {key, value});
}

void Database::eraseAll()
{
    Transaction transaction(*this);
    run(handle(), u"DELETE FROM task"_s);
    run(handle(), u"DELETE FROM outbox"_s);
    run(handle(), u"DELETE FROM meta"_s);
    transaction.commit();
}

Transaction::Transaction(const Database &database)
    : db(database.handle())
{
    run(db, u"BEGIN IMMEDIATE"_s);
}

Transaction::~Transaction()
{
    if (!done) {
        QSqlQuery rollback(db);
        rollback.exec(u"ROLLBACK"_s);
    }
}

void Transaction::commit()
{
    run(db, u"COMMIT"_s);
    done = true;
}

} // namespace dayhand
