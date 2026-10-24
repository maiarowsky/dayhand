#pragma once

#include "Outbox.h"
#include "RemoteModel.h"
#include "TaskItem.h"

#include <QHash>
#include <QList>
#include <QSet>
#include <QStringList>

namespace dayhand {

/// Groups of task fields that one kind of change touches.
enum class Field { Title, Note, Due, Status, Now, Resume, Archived, Repeat, Labels, Links, Deleted, Checklist, Reminders };

inline size_t qHash(Field field, size_t seed = 0)
{
    return ::qHash(static_cast<int>(field), seed);
}

using FieldSet = QSet<Field>;

struct MergePlan {
    QList<TaskItem> upserts;
    QStringList deletes;
};

/// Which fields of which tasks have changes still waiting in the outbox.
class DirtyFields {
public:
    explicit DirtyFields(const QList<OutboxOp> &pending);

    bool hasChanges(const QString &localId) const { return byTask.contains(localId); }
    FieldSet forTask(const QString &localId) const;

    static FieldSet fieldsOf(const OutboxOp &op);

private:
    QHash<QString, FieldSet> byTask;
    /// `setNow` moves the "now" flag off every other task too.
    bool nowEverywhere = false;
};

/**
 * Merges a server snapshot into the local rows, last write wins per field, as the Android app's `SnapshotMerger`
 * and the macOS app's `SnapshotMerger.swift`:
 *
 * - A field changed by a change still in the outbox keeps its local value. That change reaches the server after
 *   everything already there, so the server will end up with it too.
 * - Every other field takes the server value, but only from a server copy newer than the one merged before
 *   (`updatedAt`), so a late snapshot never undoes a newer state.
 * - A task missing from the snapshot was purged (or never reached the server) and goes, unless it still has
 *   changes waiting or is too fresh to be in any snapshot yet. Tasks in the trash are part of the snapshot.
 */
namespace SnapshotMerger {

/// How long a task the server has not shown yet is kept (a snapshot may predate it).
constexpr qint64 unseenGraceMs = 2 * 60 * 1000;

MergePlan merge(const QList<TaskItem> &local, const QList<OutboxOp> &pending, const QList<RemoteTask> &remote,
                qint64 nowMs);

} // namespace SnapshotMerger
} // namespace dayhand
