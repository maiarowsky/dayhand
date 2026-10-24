#pragma once

#include "Credentials.h"
#include "SyncEngine.h"

#include <QMutex>
#include <QThread>
#include <QWaitCondition>

namespace dayhand {

/**
 * Runs [SyncEngine] rounds on its own thread while the app runs: every [pollIntervalMs] (the "live" view of changes
 * made elsewhere) and at once after a local change ([poke]). The thread has its own connection to the database file
 * and its own network access, so the screens never wait for the network. Its signals arrive on the thread of the
 * object they are connected to.
 */
class SyncWorker final : public QThread {
    Q_OBJECT

public:
    /// Polling every 15 seconds stays far under the server's limits (docs/architecture.md) and feels live enough.
    static constexpr int pollIntervalMs = 15'000;

    SyncWorker(QString databasePath, DeviceCredential credential, QObject *parent = nullptr);
    ~SyncWorker() override;

    /// A local change is waiting: run a round now instead of at the next poll. Safe from any thread.
    void poke();
    /// Ends the loop after the round in progress and waits for the thread.
    void stop();

signals:
    void statusChanged(int kind, qint64 at, const QString &reason);
    /// A round wrote to the database; the screens should read it again.
    void databaseChanged();
    /// `401 invalid_grant` from `/auth/token`: the device was revoked (`dayhand revoke`).
    void revoked();

protected:
    void run() override;

private:
    /// Waits for a poke, a stop or the poll interval; false when stopping.
    bool waitForNextRound();

    QString databasePath;
    DeviceCredential credential;
    QMutex mutex;
    QWaitCondition wake;
    bool poked = false;
    bool stopping = false;
};

} // namespace dayhand
