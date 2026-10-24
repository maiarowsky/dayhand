#include "SnapshotMerger.h"

#include "Json.h"

#include <QJsonObject>

#include <algorithm>

using namespace Qt::StringLiterals;

namespace dayhand {

namespace {

const FieldSet allFields{Field::Title,  Field::Note,    Field::Due,     Field::Status,    Field::Now,
                         Field::Resume, Field::Archived, Field::Repeat, Field::Labels,    Field::Links,
                         Field::Deleted, Field::Checklist, Field::Reminders};

FieldSet updatedFields(const QString &argsJson)
{
    const QJsonValue args = json::decode(argsJson);
    if (!args.isObject())
        return allFields;
    const QJsonObject o = args.toObject();
    FieldSet fields;
    const std::pair<const char16_t *, Field> keys[] = {
        {u"title", Field::Title},     {u"note", Field::Note},           {u"dueDate", Field::Due},
        {u"dueTime", Field::Due},     {u"resumeNote", Field::Resume},   {u"repeat", Field::Repeat},
        {u"labels", Field::Labels},   {u"links", Field::Links},         {u"checklist", Field::Checklist},
        {u"reminders", Field::Reminders},
    };
    for (const auto &[key, field] : keys) {
        if (o.contains(QStringView(key)))
            fields.insert(field);
    }
    return fields;
}

TaskItem fromRemote(const std::optional<TaskItem> &row, const RemoteTask &r)
{
    TaskItem task;
    task.localId = row ? row->localId : r.clientId.value_or(r.id);
    task.serverId = r.id;
    task.clientId = r.clientId;
    task.title = r.title;
    task.note = r.note;
    task.dueDate = r.dueDate;
    task.dueTime = r.dueTime;
    task.status = statusFromWire(r.status);
    task.isNow = r.isNow;
    task.resumeNote = r.resumeNote;
    task.completedAt = r.completedAt;
    task.archivedAt = r.archivedAt;
    task.createdAt = r.createdAt;
    task.updatedAt = r.updatedAt;
    task.serverUpdatedAt = r.updatedAt;
    task.repeat = r.repeat;
    task.labels = r.labels;
    task.links = r.links;
    task.deletedAt = r.deletedAt;
    task.checklist = r.checklist;
    task.reminders = r.reminders;
    return task;
}

void keepLocal(TaskItem &task, const TaskItem &row, const FieldSet &keep)
{
    if (keep.contains(Field::Title))
        task.title = row.title;
    if (keep.contains(Field::Note))
        task.note = row.note;
    if (keep.contains(Field::Due)) {
        task.dueDate = row.dueDate;
        task.dueTime = row.dueTime;
    }
    if (keep.contains(Field::Status)) {
        task.status = row.status;
        task.completedAt = row.completedAt;
    }
    if (keep.contains(Field::Now))
        task.isNow = row.isNow;
    if (keep.contains(Field::Resume))
        task.resumeNote = row.resumeNote;
    if (keep.contains(Field::Archived))
        task.archivedAt = row.archivedAt;
    if (keep.contains(Field::Repeat))
        task.repeat = row.repeat;
    if (keep.contains(Field::Labels))
        task.labels = row.labels;
    if (keep.contains(Field::Links))
        task.links = row.links;
    if (keep.contains(Field::Deleted))
        task.deletedAt = row.deletedAt;
    if (keep.contains(Field::Checklist))
        task.checklist = row.checklist;
    if (keep.contains(Field::Reminders))
        task.reminders = row.reminders;
    task.updatedAt = std::max(row.updatedAt, task.updatedAt);
}

} // namespace

DirtyFields::DirtyFields(const QList<OutboxOp> &pending)
{
    for (const OutboxOp &op : pending) {
        if (op.mutation == Mutations::setNow)
            nowEverywhere = true;
        if (op.taskLocalId)
            byTask[*op.taskLocalId].unite(fieldsOf(op));
    }
}

FieldSet DirtyFields::forTask(const QString &localId) const
{
    FieldSet fields = byTask.value(localId);
    if (nowEverywhere)
        fields.insert(Field::Now);
    return fields;
}

FieldSet DirtyFields::fieldsOf(const OutboxOp &op)
{
    const QString &m = op.mutation;
    if (m == Mutations::complete || m == Mutations::setStatus)
        return {Field::Status, Field::Now};
    if (m == Mutations::reschedule)
        return {Field::Due};
    if (m == Mutations::archive)
        return {Field::Archived, Field::Now};
    if (m == Mutations::setNow)
        return {Field::Status, Field::Now, Field::Resume};
    if (m == Mutations::softDelete)
        return {Field::Deleted, Field::Now};
    // `restore` clears the trash, or the archive when the task is not in the trash.
    if (m == Mutations::restore)
        return {Field::Deleted, Field::Archived};
    if (m == Mutations::update)
        return updatedFields(op.argsJson);
    return allFields;
}

namespace SnapshotMerger {

MergePlan merge(const QList<TaskItem> &local, const QList<OutboxOp> &pending, const QList<RemoteTask> &remote,
                qint64 nowMs)
{
    const DirtyFields dirty(pending);
    QHash<QString, const TaskItem *> byServerId;
    QHash<QString, const TaskItem *> byClientId;
    for (const TaskItem &task : local) {
        if (task.serverId)
            byServerId.insert(*task.serverId, &task);
        if (task.clientId)
            byClientId.insert(*task.clientId, &task);
    }
    QSet<QString> seen;
    MergePlan plan;
    for (const RemoteTask &r : remote) {
        const TaskItem *found = byServerId.value(r.id, nullptr);
        if (!found && r.clientId)
            found = byClientId.value(*r.clientId, nullptr);
        const std::optional<TaskItem> row = found ? std::optional<TaskItem>(*found) : std::nullopt;
        if (row)
            seen.insert(row->localId);
        if (row && row->serverUpdatedAt && r.updatedAt <= *row->serverUpdatedAt)
            continue;
        TaskItem merged = fromRemote(row, r);
        const FieldSet keep = row ? dirty.forTask(row->localId) : FieldSet();
        if (row && !keep.isEmpty())
            keepLocal(merged, *row, keep);
        if (merged != row)
            plan.upserts.append(merged);
    }
    for (const TaskItem &task : local) {
        if (seen.contains(task.localId) || dirty.hasChanges(task.localId))
            continue;
        if (task.serverUpdatedAt || nowMs - task.updatedAt > unseenGraceMs)
            plan.deletes.append(task.localId);
    }
    return plan;
}

} // namespace SnapshotMerger
} // namespace dayhand
