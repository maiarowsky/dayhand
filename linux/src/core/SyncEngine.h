#pragma once

#include "ConvexRemote.h"
#include "TaskRepository.h"

#include <QString>

#include <functional>

namespace dayhand {

enum class DrainResult { Done, MoreLeft, RetryLater, Unauthorized };

/**
 * Sends the outbox strictly in order, one change at a time, as the Android app's `OutboxProcessor`. A change
 * leaves the queue only when the server answered; on any doubt the processor stops, so nothing behind it can
 * overtake it. Resending after a lost answer is safe because every change carries the `clientId` the backend
 * deduplicates on.
 */
class OutboxProcessor {
public:
    static constexpr int maxOpsPerRun = 200;

    OutboxProcessor(TaskRepository &store, MutationSender &sender, int maxOps = maxOpsPerRun);
    DrainResult drain();

private:
    /// Stored arguments plus the task's server id, which a task created offline gets only after its `add`.
    std::optional<QJsonValue> argsFor(const OutboxOp &op) const;

    TaskRepository &store;
    MutationSender &sender;
    int maxOps;
};

/// What the server connection is doing, for the status line on Today and the tray.
struct SyncStatus {
    enum class Kind {
        NotConnected,
        Connecting,
        Synced,
        /// The server answered no (revoked device); the user has to pair again.
        SignedOut,
        /// No answer or a server problem; changes wait in the outbox and the next round tries again.
        Offline,
    };

    Kind kind = Kind::NotConnected;
    qint64 at = 0;
    QString reason;

    bool operator==(const SyncStatus &) const = default;
};

/**
 * One round of keeping the local database and the server in step: send the outbox in order ([OutboxProcessor]),
 * then read the whole plan and merge it (`SnapshotMerger`). Sending and reading never overlap, so a snapshot is
 * always taken after the changes before it were sent. The worker thread ([SyncWorker]) runs rounds every 15
 * seconds and at once after a local change; tests call [round] directly.
 */
class SyncEngine {
public:
    SyncEngine(TaskRepository &repository, MutationSender &sender, SnapshotSource &source,
               std::function<qint64()> clock);

    SyncStatus round();

private:
    TaskRepository &repository;
    MutationSender &sender;
    SnapshotSource &source;
    std::function<qint64()> clock;
};

} // namespace dayhand
