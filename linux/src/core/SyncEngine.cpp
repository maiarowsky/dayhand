#include "SyncEngine.h"

#include "Json.h"

#include <QJsonObject>

using namespace Qt::StringLiterals;

namespace dayhand {

OutboxProcessor::OutboxProcessor(TaskRepository &store, MutationSender &sender, int maxOps)
    : store(store)
    , sender(sender)
    , maxOps(maxOps)
{
}

DrainResult OutboxProcessor::drain()
{
    for (int sent = 0; sent < maxOps; ++sent) {
        const auto op = store.next();
        if (!op)
            return DrainResult::Done;
        const auto args = argsFor(*op);
        if (!args) {
            // "task never reached the server": its add was refused or lost for good.
            store.reject(*op);
            continue;
        }
        const SendResult result = sender.send(op->mutation, *args);
        switch (result.kind) {
        case SendResult::Kind::Applied:
            store.acknowledge(*op, result.value);
            break;
        case SendResult::Kind::Rejected:
            store.reject(*op);
            break;
        case SendResult::Kind::Unauthorized:
            store.recordFailure(*op, u"unauthorized"_s);
            return DrainResult::Unauthorized;
        case SendResult::Kind::Failed:
            store.recordFailure(*op, result.message);
            return DrainResult::RetryLater;
        }
    }
    return store.next() ? DrainResult::MoreLeft : DrainResult::Done;
}

std::optional<QJsonValue> OutboxProcessor::argsFor(const OutboxOp &op) const
{
    const QJsonValue stored = json::decode(op.argsJson);
    if (!stored.isObject())
        return std::nullopt;
    QJsonObject args = stored.toObject();
    if (!op.taskLocalId || op.mutation == Mutations::add)
        return QJsonValue(args);
    const auto serverId = store.serverIdOf(*op.taskLocalId);
    if (!serverId)
        return std::nullopt;
    args.insert(u"taskId", *serverId);
    return QJsonValue(args);
}

SyncEngine::SyncEngine(TaskRepository &repository, MutationSender &sender, SnapshotSource &source,
                       std::function<qint64()> clock)
    : repository(repository)
    , sender(sender)
    , source(source)
    , clock(std::move(clock))
{
}

SyncStatus SyncEngine::round()
{
    try {
        OutboxProcessor processor(repository, sender);
        DrainResult drained = processor.drain();
        while (drained == DrainResult::MoreLeft)
            drained = processor.drain();
        if (drained == DrainResult::Unauthorized)
            return {SyncStatus::Kind::SignedOut, 0, {}};
        // On RetryLater the plan is read anyway: changes made elsewhere still show, and waiting ones keep their fields.
        QStringList knownTaskIds;
        for (const TaskItem &task : repository.allTasks()) {
            if (task.serverId)
                knownTaskIds.append(*task.serverId);
        }
        const SnapshotSource::Result read = source.snapshot(knownTaskIds);
        if (read.unauthorized)
            return {SyncStatus::Kind::SignedOut, 0, {}};
        if (!read.snapshot)
            return {SyncStatus::Kind::Offline, 0, read.reason};
        repository.apply(*read.snapshot);
        if (drained == DrainResult::RetryLater) {
            const auto waiting = repository.next();
            const QString reason = waiting && waiting->lastError ? *waiting->lastError : u"a change could not be sent"_s;
            return {SyncStatus::Kind::Offline, 0, reason};
        }
        return {SyncStatus::Kind::Synced, clock(), {}};
    } catch (const StoreError &error) {
        return {SyncStatus::Kind::Offline, 0, u"database: %1"_s.arg(QString::fromStdString(error.what()))};
    }
}

} // namespace dayhand
