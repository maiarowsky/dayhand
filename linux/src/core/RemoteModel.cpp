#include "RemoteModel.h"

#include "HelmDates.h"
#include "Json.h"

#include <QJsonArray>
#include <QJsonObject>

using namespace Qt::StringLiterals;

namespace dayhand::RemoteJson {

namespace {

template <class T> QList<T> listOf(const QJsonValue &value, std::optional<T> (*parse)(const QJsonValue &))
{
    QList<T> out;
    for (const auto &item : value.toArray()) {
        if (const auto parsed = parse(item))
            out.append(*parsed);
    }
    return out;
}

QStringList strings(const QJsonValue &value)
{
    QStringList out;
    for (const auto &item : value.toArray()) {
        if (item.isString())
            out.append(item.toString());
    }
    return out;
}

} // namespace

QJsonValue tasksArgs()
{
    return QJsonObject{{u"includeArchived"_s, true}, {u"includeDone"_s, true}};
}

std::optional<RemoteTask> task(const QJsonValue &o)
{
    const auto id = json::string(o[u"id"]);
    if (!id)
        return std::nullopt;
    RemoteTask t;
    t.id = *id;
    t.clientId = json::string(o[u"clientId"]);
    t.title = o[u"title"].toString();
    t.note = json::string(o[u"note"]);
    t.dueDate = json::string(o[u"dueDate"]);
    t.dueTime = json::string(o[u"dueTime"]);
    t.status = json::string(o[u"status"]).value_or(u"todo"_s);
    t.isNow = o[u"isNow"].toBool(false);
    t.resumeNote = json::string(o[u"resumeNote"]);
    t.completedAt = json::integer(o[u"completedAt"]);
    t.archivedAt = json::integer(o[u"archivedAt"]);
    t.createdAt = json::integer(o[u"createdAt"]).value_or(0);
    t.updatedAt = json::integer(o[u"updatedAt"]).value_or(0);
    t.repeat = RepeatRule::parse(o[u"repeat"]);
    t.labels = strings(o[u"labels"]);
    t.links = listOf<TaskLink>(o[u"links"], &TaskLink::parse);
    t.deletedAt = json::integer(o[u"deletedAt"]);
    t.checklist = listOf<ChecklistItem>(o[u"checklist"], &ChecklistItem::parse);
    if (o[u"reminders"].isArray())
        t.reminders = listOf<TaskReminder>(o[u"reminders"], &TaskReminder::parse);
    return t;
}

QList<RemoteTask> tasks(const QJsonValue &value)
{
    return listOf<RemoteTask>(value, &task);
}

ReminderSettings settings(const QJsonValue &value)
{
    ReminderSettings out;
    const auto timezone = json::string(value[u"timezone"]);
    if (timezone && HelmDates::isTimezone(*timezone))
        out.timezone = *timezone;
    out.summaryTime = json::string(value[u"summaryTime"]).value_or(ReminderRules::defaultSummaryTime);
    if (value[u"defaultReminderMinutes"].isArray()) {
        out.reminderMinutes.clear();
        for (const auto &minutes : value[u"defaultReminderMinutes"].toArray()) {
            if (const auto number = json::int32(minutes))
                out.reminderMinutes.append(*number);
        }
    }
    return out;
}

QJsonValue settingsJson(const ReminderSettings &settings)
{
    QJsonArray minutes;
    for (int m : settings.reminderMinutes)
        minutes.append(m);
    return QJsonObject{{u"timezone"_s, settings.timezone},
                       {u"summaryTime"_s, settings.summaryTime},
                       {u"defaultReminderMinutes"_s, minutes}};
}

Snapshot snapshot(const QJsonValue &active, const QJsonValue &trash, const QJsonValue &settingsValue)
{
    return {tasks(active) + tasks(trash), settings(settingsValue)};
}

QString errorCode(const QJsonValue &data)
{
    return data[u"code"].toString();
}

} // namespace dayhand::RemoteJson
