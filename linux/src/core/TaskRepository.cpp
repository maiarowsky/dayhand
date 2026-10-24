#include "TaskRepository.h"

#include "CivilDate.h"
#include "Json.h"
#include "SnapshotMerger.h"
#include "TaskRules.h"

using namespace Qt::StringLiterals;

namespace dayhand {

namespace {

const QString settingsKey = u"settings"_s;

QString titleError()
{
    return u"title must be 1 to %1 characters"_s.arg(TaskRules::maxTitle);
}

} // namespace

TaskRepository::TaskRepository(Database &database, Hooks hooks)
    : db(database)
    , hooks(std::move(hooks))
{
}

ReminderSettings TaskRepository::settings() const
{
    const auto stored = db.meta(settingsKey);
    const QJsonValue value = stored ? json::decode(*stored) : QJsonValue();
    if (!value.isObject()) {
        ReminderSettings local;
        local.timezone = hooks.localTimezone ? hooks.localTimezone() : HelmDates::defaultTimezone;
        if (!HelmDates::isTimezone(local.timezone))
            local.timezone = HelmDates::defaultTimezone;
        return local;
    }
    return RemoteJson::settings(value);
}

TaskItem TaskRepository::add(const QString &title, const std::optional<QString> &dueDate,
                             const std::optional<QString> &dueTime, const std::optional<QString> &note)
{
    const auto cleanTitle = TaskRules::title(title);
    if (!cleanTitle)
        throw InvalidChange(titleError());
    const std::optional<QString> cleanNote = note && !note->trimmed().isEmpty() ? note : std::nullopt;
    if (cleanNote && cleanNote->size() > TaskRules::maxNote)
        throw InvalidChange(u"note is too long"_s);
    const std::optional<QString> date = dueDate && CivilDate::parse(*dueDate) ? dueDate : std::nullopt;
    const std::optional<QString> time = date && dueTime && ClockTime::parse(*dueTime) ? dueTime : std::nullopt;
    const qint64 now = hooks.clock();
    const QString localId = hooks.newId();
    TaskItem task;
    task.localId = localId;
    task.clientId = localId;
    task.title = *cleanTitle;
    task.note = cleanNote;
    task.dueDate = date;
    task.dueTime = time;
    task.createdAt = now;
    task.updatedAt = now;
    QJsonObject args{{u"title"_s, *cleanTitle}};
    if (cleanNote)
        args.insert(u"note", *cleanNote);
    if (date)
        args.insert(u"dueDate", *date);
    if (time)
        args.insert(u"dueTime", *time);
    OutboxOp op = makeOp(Mutations::add, localId, args, now, localId);
    Transaction transaction(db);
    db.save(task);
    db.insert(op);
    transaction.commit();
    changed();
    return task;
}

void TaskRepository::complete(const QString &localId)
{
    edit(localId, Mutations::complete, {}, [](TaskItem &task, qint64 now) {
        task.status = TaskStatus::Done;
        task.completedAt = now;
        task.isNow = false;
    });
}

void TaskRepository::reopen(const QString &localId)
{
    edit(localId, Mutations::setStatus, {{u"status"_s, u"todo"_s}}, [](TaskItem &task, qint64) {
        task.status = TaskStatus::Todo;
        task.completedAt.reset();
        task.isNow = false;
    });
}

void TaskRepository::rename(const QString &localId, const QString &title)
{
    const auto clean = TaskRules::title(title);
    if (!clean)
        throw InvalidChange(titleError());
    edit(localId, Mutations::update, {{u"title"_s, *clean}}, [&clean](TaskItem &task, qint64) { task.title = *clean; });
}

void TaskRepository::setDue(const QString &localId, const std::optional<QString> &date, const std::optional<QString> &time)
{
    if (date && !CivilDate::parse(*date))
        throw InvalidChange(u"not a date"_s);
    if (time && !ClockTime::parse(*time))
        throw InvalidChange(u"not a time"_s);
    const std::optional<QString> cleanTime = date ? time : std::nullopt;
    const QJsonObject args{{u"dueDate"_s, json::orNull(date)}, {u"dueTime"_s, json::orNull(cleanTime)}};
    edit(localId, Mutations::update, args, [&](TaskItem &task, qint64) {
        task.dueDate = date;
        task.dueTime = cleanTime;
    });
}

void TaskRepository::reschedule(const QString &localId, const QString &date)
{
    if (!CivilDate::parse(date))
        throw InvalidChange(u"not a date"_s);
    edit(localId, Mutations::reschedule, {{u"dueDate"_s, date}}, [&date](TaskItem &task, qint64) { task.dueDate = date; });
}

void TaskRepository::setResumeNote(const QString &localId, const QString &note)
{
    const QString trimmed = note.trimmed();
    const std::optional<QString> clean = trimmed.isEmpty() ? std::nullopt : std::optional<QString>(trimmed);
    if (clean && clean->size() > TaskRules::maxResumeNote)
        throw InvalidChange(u"note is too long"_s);
    edit(localId, Mutations::update, {{u"resumeNote"_s, json::orNull(clean)}},
         [&clean](TaskItem &task, qint64) { task.resumeNote = clean; });
}

void TaskRepository::archive(const QString &localId)
{
    edit(localId, Mutations::archive, {}, [](TaskItem &task, qint64 now) {
        task.archivedAt = now;
        task.isNow = false;
    });
}

void TaskRepository::moveToTrash(const QString &localId)
{
    edit(localId, Mutations::softDelete, {}, [](TaskItem &task, qint64 now) {
        task.deletedAt = now;
        task.isNow = false;
    });
}

void TaskRepository::restore(const QString &localId)
{
    edit(localId, Mutations::restore, {}, [](TaskItem &task, qint64) {
        if (task.deletedAt)
            task.deletedAt.reset();
        else
            task.archivedAt.reset();
    });
}

void TaskRepository::setNow(const QString &localId)
{
    const qint64 now = hooks.clock();
    OutboxOp op = makeOp(Mutations::setNow, localId, {}, now);
    Transaction transaction(db);
    auto target = db.task(localId);
    if (!target || target->inTrash())
        return;
    for (TaskItem other : db.nowTasks()) {
        if (other.localId == localId)
            continue;
        other.isNow = false;
        other.updatedAt = now;
        db.save(other);
    }
    target->isNow = true;
    target->status = TaskStatus::Doing;
    target->completedAt.reset();
    target->updatedAt = now;
    db.save(*target);
    db.insert(op);
    transaction.commit();
    changed();
}

void TaskRepository::clearNow()
{
    const qint64 now = hooks.clock();
    OutboxOp op = makeOp(Mutations::setNow, std::nullopt, {{u"taskId"_s, QJsonValue::Null}}, now);
    Transaction transaction(db);
    for (TaskItem task : db.nowTasks()) {
        task.isNow = false;
        task.updatedAt = now;
        db.save(task);
    }
    db.insert(op);
    transaction.commit();
    changed();
}

void TaskRepository::apply(const Snapshot &snapshot)
{
    const qint64 now = hooks.clock();
    Transaction transaction(db);
    const MergePlan plan = SnapshotMerger::merge(db.tasks(), db.pendingOps(), snapshot.tasks, now);
    // Deletes first: a task purged on the server frees its serverId before another row could take it.
    for (const QString &localId : plan.deletes)
        db.removeTask(localId);
    for (const TaskItem &task : plan.upserts)
        db.save(task);
    db.setMeta(settingsKey, json::encode(RemoteJson::settingsJson(snapshot.settings).toObject()));
    transaction.commit();
}

std::optional<QString> TaskRepository::serverIdOf(const QString &taskLocalId) const
{
    const auto task = db.task(taskLocalId);
    return task ? task->serverId : std::nullopt;
}

void TaskRepository::acknowledge(const OutboxOp &op, const QJsonValue &value)
{
    Transaction transaction(db);
    db.removeOp(op.seq);
    const auto serverId = json::string(value[u"id"]);
    if (op.mutation == Mutations::add && op.taskLocalId && serverId) {
        if (auto task = db.task(*op.taskLocalId)) {
            task->serverId = serverId;
            db.save(*task);
        }
    }
    transaction.commit();
}

void TaskRepository::reject(const OutboxOp &op)
{
    Transaction transaction(db);
    db.removeOp(op.seq);
    if (op.taskLocalId) {
        if (op.mutation == Mutations::add) {
            // The task never existed on the server: drop it and every change made to it since.
            db.removeOpsOf(*op.taskLocalId);
            db.removeTask(*op.taskLocalId);
        } else if (auto task = db.task(*op.taskLocalId)) {
            // Forget the server version so the next snapshot overwrites the refused local change.
            task->serverUpdatedAt.reset();
            db.save(*task);
        }
    }
    transaction.commit();
}

void TaskRepository::edit(const QString &localId, const QString &mutation, const QJsonObject &args, const Change &change)
{
    const qint64 now = hooks.clock();
    OutboxOp op = makeOp(mutation, localId, args, now);
    Transaction transaction(db);
    auto task = db.task(localId);
    // The server refuses every other change to a task in the trash; restore it first.
    if (!task || (task->inTrash() && mutation != Mutations::restore))
        return;
    change(*task, now);
    task->updatedAt = now;
    db.save(*task);
    db.insert(op);
    transaction.commit();
    changed();
}

OutboxOp TaskRepository::makeOp(const QString &mutation, const std::optional<QString> &taskLocalId, QJsonObject args,
                                qint64 now, const std::optional<QString> &clientId)
{
    const QString id = clientId ? *clientId : hooks.newId();
    args.insert(u"clientId", id);
    OutboxOp op;
    op.opId = mutation == Mutations::add ? hooks.newId() : id;
    op.mutation = mutation;
    op.argsJson = json::encode(args);
    op.taskLocalId = taskLocalId;
    op.clientId = id;
    op.createdAt = now;
    return op;
}

void TaskRepository::changed()
{
    if (hooks.onChanged)
        hooks.onChanged();
}

} // namespace dayhand
