#include "TaskItem.h"

#include "Json.h"

#include <QJsonArray>
#include <QJsonObject>

using namespace Qt::StringLiterals;

namespace dayhand {

QString statusWire(TaskStatus status)
{
    switch (status) {
    case TaskStatus::Doing:
        return QStringLiteral("doing");
    case TaskStatus::Done:
        return QStringLiteral("done");
    case TaskStatus::Todo:
        break;
    }
    return QStringLiteral("todo");
}

TaskStatus statusFromWire(const QString &value)
{
    if (value == u"doing")
        return TaskStatus::Doing;
    if (value == u"done")
        return TaskStatus::Done;
    return TaskStatus::Todo;
}

namespace {

std::optional<RepeatEvery> everyFromWire(const QJsonValue &value)
{
    const QString text = value.toString();
    if (text == u"day")
        return RepeatEvery::Day;
    if (text == u"week")
        return RepeatEvery::Week;
    if (text == u"month")
        return RepeatEvery::Month;
    if (text == u"year")
        return RepeatEvery::Year;
    return std::nullopt;
}

QString everyWire(RepeatEvery every)
{
    switch (every) {
    case RepeatEvery::Week:
        return QStringLiteral("week");
    case RepeatEvery::Month:
        return QStringLiteral("month");
    case RepeatEvery::Year:
        return QStringLiteral("year");
    case RepeatEvery::Day:
        break;
    }
    return QStringLiteral("day");
}

/// The weekdays of a rule: nothing when absent or null, false when present but not a list of whole numbers.
bool parseWeekdays(const QJsonValue &value, std::optional<QList<int>> &out)
{
    if (value.isUndefined() || value.isNull())
        return true;
    if (!value.isArray())
        return false;
    QList<int> days;
    for (const auto &day : value.toArray()) {
        const auto number = json::int32(day);
        if (!number)
            return false;
        days.append(*number);
    }
    out = days;
    return true;
}

} // namespace

std::optional<RepeatRule> RepeatRule::parse(const QJsonValue &value)
{
    if (!value.isObject())
        return std::nullopt;
    const QJsonObject o = value.toObject();
    const auto every = everyFromWire(o.value(u"every"));
    const auto interval = json::int32(o.value(u"interval"));
    if (!every || !interval)
        return std::nullopt;
    RepeatRule rule;
    rule.every = *every;
    rule.interval = *interval;
    if (!parseWeekdays(o.value(u"weekdays"), rule.weekdays))
        return std::nullopt;
    const QJsonValue nth = o.value(u"weekdayOfMonth");
    if (nth.isObject()) {
        const auto n = json::int32(nth.toObject().value(u"nth"));
        const auto weekday = json::int32(nth.toObject().value(u"weekday"));
        if (!n || !weekday)
            return std::nullopt;
        rule.weekdayOfMonth = WeekdayOfMonth{*n, *weekday};
    }
    const auto from = json::string(o.value(u"from"));
    if (from == u"due" || from == u"completion")
        rule.from = from;
    rule.monthDay = json::int32(o.value(u"monthDay"));
    rule.until = json::string(o.value(u"until"));
    rule.count = json::int32(o.value(u"count"));
    return rule;
}

QJsonValue RepeatRule::wire() const
{
    QJsonObject o{{u"every"_s, everyWire(every)}, {u"interval"_s, interval}};
    if (weekdays) {
        QJsonArray days;
        for (int day : *weekdays)
            days.append(day);
        o.insert(u"weekdays", days);
    }
    if (from)
        o.insert(u"from", *from);
    if (monthDay)
        o.insert(u"monthDay", *monthDay);
    if (weekdayOfMonth)
        o.insert(u"weekdayOfMonth", QJsonObject{{u"nth"_s, weekdayOfMonth->nth}, {u"weekday"_s, weekdayOfMonth->weekday}});
    if (until)
        o.insert(u"until", *until);
    if (count)
        o.insert(u"count", *count);
    return o;
}

std::optional<ChecklistItem> ChecklistItem::parse(const QJsonValue &value)
{
    const auto id = json::string(value[u"id"]);
    const auto title = json::string(value[u"title"]);
    if (!id || !title)
        return std::nullopt;
    return ChecklistItem{*id, *title, value[u"done"].toBool(false)};
}

QJsonValue ChecklistItem::wire() const
{
    return QJsonObject{{u"id"_s, id}, {u"title"_s, title}, {u"done"_s, done}};
}

std::optional<TaskReminder> TaskReminder::parse(const QJsonValue &value)
{
    if (const auto minutes = json::int32(value[u"minutesBefore"]))
        return before(*minutes);
    const auto time = json::string(value[u"time"]);
    if (!time)
        return std::nullopt;
    return at(*time, json::int32(value[u"daysBefore"]).value_or(0));
}

QJsonValue TaskReminder::wire() const
{
    QJsonObject o;
    if (minutesBefore)
        o.insert(u"minutesBefore", *minutesBefore);
    if (time)
        o.insert(u"time", *time);
    if (daysBefore)
        o.insert(u"daysBefore", *daysBefore);
    return o;
}

std::optional<TaskLink> TaskLink::parse(const QJsonValue &value)
{
    const auto url = json::string(value[u"url"]);
    if (!url)
        return std::nullopt;
    return TaskLink{*url, json::string(value[u"title"])};
}

QJsonValue TaskLink::wire() const
{
    QJsonObject o{{u"url"_s, url}};
    if (title)
        o.insert(u"title", *title);
    return o;
}

} // namespace dayhand
