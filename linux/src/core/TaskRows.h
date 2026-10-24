#pragma once

#include "TaskItem.h"

#include <QSqlQuery>
#include <QString>
#include <QVariantList>

namespace dayhand::TaskRows {

/// The columns of the task table in the order [read] and [values] use.
QString columns();
/// An insert that replaces the row with the same localId.
QString upsertSql();
/// A task from a row selected with [columns].
TaskItem read(const QSqlQuery &query);
/// The values of [task] for [upsertSql], in [columns] order. Lists and objects are stored as the backend's JSON.
QVariantList values(const TaskItem &task);

} // namespace dayhand::TaskRows
