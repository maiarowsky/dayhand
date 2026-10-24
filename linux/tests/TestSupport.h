#pragma once

#include "CivilDate.h"
#include "TaskItem.h"

#include <QDateTime>
#include <QStringList>
#include <QTimeZone>

#include <functional>

namespace dayhand::test {

/// Unix ms of a UTC minute written as `2026-10-22T10:00`.
inline qint64 utc(const QString &isoMinute)
{
    const QDateTime time = QDateTime::fromString(isoMinute + QStringLiteral(":00Z"), Qt::ISODate);
    Q_ASSERT_X(time.isValid(), "utc", "bad test date");
    return time.toMSecsSinceEpoch();
}

inline CivilDate day(const QString &iso)
{
    const auto date = CivilDate::parse(iso);
    Q_ASSERT_X(date.has_value(), "day", "bad test day");
    return *date;
}

inline TaskItem task(const QString &id, std::optional<QString> due = std::nullopt, std::optional<QString> time = std::nullopt,
                     TaskStatus status = TaskStatus::Todo, qint64 created = 0,
                     const std::function<void(TaskItem &)> &change = {})
{
    TaskItem item;
    item.localId = id;
    item.title = id;
    item.dueDate = due;
    item.dueTime = time;
    item.status = status;
    item.createdAt = created;
    if (change)
        change(item);
    return item;
}

/// Ids, in order, for short expectations.
inline QStringList ids(const QList<TaskItem> &tasks)
{
    QStringList out;
    for (const auto &t : tasks)
        out.append(t.localId);
    return out;
}

/// Ids `id-1`, `id-2`, … so tests can name what the repository creates.
struct TestIds {
    int counter = 0;
    QString next() { return QStringLiteral("id-%1").arg(++counter); }
};

} // namespace dayhand::test
