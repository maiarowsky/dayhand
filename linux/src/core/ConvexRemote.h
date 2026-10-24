#pragma once

#include "Http.h"
#include "PairingApi.h"
#include "RemoteModel.h"

#include <QJsonValue>
#include <QString>

namespace dayhand {

/// Sends one mutation of the outbox.
class MutationSender {
public:
    virtual ~MutationSender() = default;
    virtual SendResult send(const QString &mutation, const QJsonValue &args) = 0;
};

/// Reads the whole plan for the merge.
class SnapshotSource {
public:
    struct Result {
        std::optional<Snapshot> snapshot;
        bool unauthorized = false;
        QString reason;
    };

    virtual ~SnapshotSource() = default;
    virtual Result snapshot() = 0;
};

/**
 * The Convex HTTP API (`POST /api/mutation`, `/api/query`), the same calls the Android app's `HttpTaskRemote` and
 * the macOS app's `ConvexRemote` make. A function that failed answers 560 with `{status: "error"}`. The app JWT
 * comes from [tokens]; a refused one is refreshed and the call tried once more. Live updates come from polling
 * [snapshot]: `listAll`, `listTrash` and `getSettings`.
 */
class ConvexRemote final : public MutationSender, public SnapshotSource {
public:
    static constexpr int udfFailed = 560;

    ConvexRemote(const QString &deploymentUrl, AppTokens &tokens, HttpTransport &transport);

    SendResult send(const QString &mutation, const QJsonValue &args) override;
    SendResult query(const QString &path, const QJsonValue &args);
    Result snapshot() override;

    static QByteArray requestBody(const QString &path, const QJsonValue &args);
    /**
     * Only a function that ran and refused the change is final. Anything else (no answer, 5xx, a wrong address
     * answering 404) keeps the change for a later try, so a misconfigured server never throws away the user's work.
     */
    static SendResult classify(const HttpReply &reply);

private:
    SendResult call(const QString &endpoint, const QString &path, const QJsonValue &args);
    SendResult post(const QUrl &url, const QByteArray &body, const QString &token);

    QString deploymentUrl;
    AppTokens &tokens;
    HttpTransport &transport;
};

} // namespace dayhand
