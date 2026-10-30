#pragma once

#include "Http.h"

#include <QHash>
#include <QJsonArray>
#include <QJsonObject>
#include <QJsonValue>
#include <QList>
#include <QStringList>

#include <functional>

namespace dayhand::test {

/**
 * A Dayhand server in memory, behind the same [HttpTransport] the app uses: `/auth/pair`, `/auth/token`, and the
 * app functions over `/api/mutation` and `/api/query`, with the backend's rules that sync depends on (one now task,
 * `clientId` idempotency, the trash, `updatedAt`). It can go offline, lose an answer after applying a change, and
 * revoke the device. The macOS app's FakeServer.swift. No network, no production, synthetic data only.
 */
class FakeServer final : public HttpTransport {
public:
    static inline const QString site = QStringLiteral("https://fake.convex.site");
    static inline const QString cloud = QStringLiteral("https://fake.convex.cloud");
    static inline const QString pairingCode = QStringLiteral("E6M8-FE02-XSNT");
    static inline const QString deviceToken = QStringLiteral("helmdev_fake.secret");
    static constexpr int udfFailed = 560;

    struct Request {
        QString path;
        QString bearer;
        QJsonValue body;
    };

    HttpReply post(const QUrl &url, const QByteArray &json, const QString &bearer) override;

    std::function<qint64()> clock = [] { return qint64(1'800'000'000'000); };
    bool offline = false;
    bool revoked = false;
    /// The next mutation is applied but its answer never arrives (a dropped connection).
    bool loseNextAnswer = false;
    /// The next mutation is refused with a 503 before it runs (a server hiccup).
    bool failNextMutation = false;
    QList<Request> requests;
    QJsonObject settings{{QStringLiteral("timezone"), QStringLiteral("Europe/London")},
                         {QStringLiteral("summaryTime"), QStringLiteral("05:00")},
                         {QStringLiteral("defaultReminderMinutes"), QJsonArray{0}}};

    /// A task added by someone else (an agent through MCP); its id.
    QString addElsewhere(const QString &title, const QString &dueDate = {});
    void editElsewhere(const QString &id, const QJsonObject &fields);
    /// The task leaves the server for good, as the daily purge of the trash does.
    void purge(const QString &id);
    /// This computer now talks to another Convex deployment: none of the tasks, and ids of a table of its own.
    void becomeAnotherDeployment();
    /// This task leaves the trash elsewhere right after the next `app:listAll` answer, before `app:listTrash` is read.
    QString restoreAfterNextActiveQuery;
    QList<QJsonObject> allTasks() const;
    std::optional<QJsonObject> taskTitled(const QString &title) const;
    QStringList mutationsSent() const;
    void expireTokens() { validJwts.clear(); }

private:
    HttpReply pair(const QJsonValue &body);
    HttpReply token(const QJsonValue &body);
    HttpReply query(const QString &path, const QJsonObject &args);
    HttpReply mutation(const QString &path, const QJsonObject &args);
    bool applyChange(const QString &path, const QString &id, const QJsonObject &args);
    QJsonObject add(const QJsonObject &args);
    void change(const QString &id, const std::function<void(QJsonObject &)> &edit, bool touch = true);

    QHash<QString, QJsonObject> tasks;
    QStringList order;
    QHash<QString, QJsonValue> seenClientIds;
    int nextId = 1;
    /// What this deployment's task ids start with; an id of another deployment is not a task id to it.
    QString idPrefix = QStringLiteral("srv");
    int nextJwt = 1;
    QStringList validJwts;
};

} // namespace dayhand::test
