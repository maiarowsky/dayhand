#include "SyncWorker.h"

#include "HelmDates.h"

#include <QTimeZone>
#include <QUuid>

namespace dayhand {

SyncWorker::SyncWorker(QString databasePath, DeviceCredential credential, QObject *parent)
    : QThread(parent)
    , databasePath(std::move(databasePath))
    , credential(std::move(credential))
{
}

SyncWorker::~SyncWorker()
{
    stop();
}

void SyncWorker::poke()
{
    QMutexLocker locker(&mutex);
    poked = true;
    wake.wakeAll();
}

void SyncWorker::stop()
{
    {
        QMutexLocker locker(&mutex);
        stopping = true;
        wake.wakeAll();
    }
    wait();
}

bool SyncWorker::waitForNextRound()
{
    QMutexLocker locker(&mutex);
    if (!poked && !stopping)
        wake.wait(&mutex, pollIntervalMs);
    poked = false;
    return !stopping;
}

void SyncWorker::run()
{
    emit statusChanged(int(SyncStatus::Kind::Connecting), 0, {});
    std::unique_ptr<Database> database;
    try {
        database = Database::open(databasePath);
    } catch (const StoreError &error) {
        emit statusChanged(int(SyncStatus::Kind::Offline), 0, QString::fromStdString(error.what()));
        return;
    }
    NetworkTransport transport;
    const PairingApi api(transport);
    bool wasRevoked = false;
    DeviceTokens tokens(credential.serverUrl, credential.deviceToken, api, [&wasRevoked] { wasRevoked = true; }, &nowMs);
    ConvexRemote remote(credential.convexUrl, tokens, transport);
    TaskRepository repository(*database, {&nowMs, [] { return QUuid::createUuid().toString(QUuid::WithoutBraces); },
                                          [] { return QString::fromUtf8(QTimeZone::systemTimeZoneId()); }, {}});
    SyncEngine engine(repository, remote, remote, &nowMs);
    do {
        const SyncStatus status = engine.round();
        emit databaseChanged();
        emit statusChanged(int(status.kind), status.at, status.reason);
        if (wasRevoked)
            emit revoked();
        if (status.kind == SyncStatus::Kind::SignedOut)
            return;
    } while (waitForNextRound());
}

} // namespace dayhand
