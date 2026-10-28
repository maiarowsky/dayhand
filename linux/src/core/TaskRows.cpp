#include "TaskRows.h"

#include "Json.h"

#include <QJsonArray>
#include <QStringList>
#include <QVariant>

using namespace Qt::StringLiterals;

namespace dayhand::TaskRows {

namespace {

const QStringList names{
    u"localId"_s,   u"serverId"_s,  u"clientId"_s,   u"title"_s,           u"note"_s,     u"dueDate"_s,
    u"dueTime"_s,   u"status"_s,    u"isNow"_s,      u"resumeNote"_s,      u"completedAt"_s, u"archivedAt"_s,
    u"createdAt"_s, u"updatedAt"_s, u"serverUpdatedAt"_s, u"repeat"_s,     u"links"_s,    u"deletedAt"_s,
    u"checklist"_s, u"reminders"_s,
};

QVariant text(const std::optional<QString> &value)
{
    return value ? QVariant(*value) : QVariant(QMetaType::fromType<QString>());
}

QVariant number(const std::optional<qint64> &value)
{
    return value ? QVariant(*value) : QVariant(QMetaType::fromType<qint64>());
}

std::optional<QString> optionalText(const QVariant &value)
{
    return value.isNull() ? std::nullopt : std::optional<QString>(value.toString());
}

std::optional<qint64> optionalNumber(const QVariant &value)
{
    return value.isNull() ? std::nullopt : std::optional<qint64>(value.toLongLong());
}

template <class T> QString encodeList(const QList<T> &items)
{
    QJsonArray array;
    for (const T &item : items)
        array.append(item.wire());
    return json::encode(array);
}

template <class T> QList<T> decodeList(const QVariant &column)
{
    QList<T> out;
    for (const auto &item : json::decode(column.toString()).toArray()) {
        if (const auto parsed = T::parse(item))
            out.append(*parsed);
    }
    return out;
}

} // namespace

QString columns()
{
    return names.join(u", ");
}

QString upsertSql()
{
    QStringList updates;
    for (const QString &name : names.mid(1))
        updates.append(u"%1 = excluded.%1"_s.arg(name));
    const QString marks = QStringList(names.size(), u"?"_s).join(u", ");
    return u"INSERT INTO task (%1) VALUES (%2) ON CONFLICT(localId) DO UPDATE SET %3"_s.arg(columns(), marks,
                                                                                         updates.join(u", "));
}

TaskItem read(const QSqlQuery &q)
{
    TaskItem t;
    t.localId = q.value(0).toString();
    t.serverId = optionalText(q.value(1));
    t.clientId = optionalText(q.value(2));
    t.title = q.value(3).toString();
    t.note = optionalText(q.value(4));
    t.dueDate = optionalText(q.value(5));
    t.dueTime = optionalText(q.value(6));
    t.status = statusFromWire(q.value(7).toString());
    t.isNow = q.value(8).toInt() != 0;
    t.resumeNote = optionalText(q.value(9));
    t.completedAt = optionalNumber(q.value(10));
    t.archivedAt = optionalNumber(q.value(11));
    t.createdAt = q.value(12).toLongLong();
    t.updatedAt = q.value(13).toLongLong();
    t.serverUpdatedAt = optionalNumber(q.value(14));
    if (!q.value(15).isNull())
        t.repeat = RepeatRule::parse(json::decode(q.value(15).toString()));
    t.links = decodeList<TaskLink>(q.value(16));
    t.deletedAt = optionalNumber(q.value(17));
    t.checklist = decodeList<ChecklistItem>(q.value(18));
    if (!q.value(19).isNull())
        t.reminders = decodeList<TaskReminder>(q.value(19));
    return t;
}

QVariantList values(const TaskItem &t)
{
    const QVariant repeat = t.repeat ? QVariant(json::encode(t.repeat->wire().toObject())) : text(std::nullopt);
    const QVariant reminders = t.reminders ? QVariant(encodeList(*t.reminders)) : text(std::nullopt);
    return {t.localId,         text(t.serverId),       text(t.clientId),      t.title,
            text(t.note),      text(t.dueDate),        text(t.dueTime),       statusWire(t.status),
            t.isNow ? 1 : 0,   text(t.resumeNote),     number(t.completedAt), number(t.archivedAt),
            t.createdAt,       t.updatedAt,            number(t.serverUpdatedAt), repeat,
            encodeList(t.links), number(t.deletedAt),  encodeList(t.checklist), reminders};
}

} // namespace dayhand::TaskRows
