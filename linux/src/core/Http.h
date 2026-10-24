#pragma once

#include <QByteArray>
#include <QString>
#include <QUrl>

#include <memory>

class QNetworkAccessManager;

namespace dayhand {

/// An HTTP answer, or the kind of failure when there was no answer at all.
struct HttpReply {
    int status = 0;
    QByteArray body;
    /// `Retry-After` of a 429, the only header the app reads.
    QString retryAfter;
    /// Empty when the server answered; otherwise the kind of failure (never its text, which may hold the address).
    QString failure;

    bool answered() const { return failure.isEmpty(); }

    static HttpReply unreachable(const QString &kind) { return {0, {}, {}, kind}; }
};

/// POSTs JSON and waits for the answer. Tests replace it with a server in memory.
class HttpTransport {
public:
    virtual ~HttpTransport() = default;
    virtual HttpReply post(const QUrl &url, const QByteArray &json, const QString &bearer) = 0;
};

/**
 * [HttpTransport] on a `QNetworkAccessManager` of the calling thread, waiting in a local event loop, so it belongs
 * on a worker thread. No cookies, no cache, a fixed timeout so a dead network fails fast, and redirects are not
 * followed: a secret is never sent on to another address.
 */
class NetworkTransport final : public HttpTransport {
public:
    static constexpr int timeoutMs = 15'000;

    NetworkTransport();
    ~NetworkTransport() override;

    HttpReply post(const QUrl &url, const QByteArray &json, const QString &bearer) override;

private:
    std::unique_ptr<QNetworkAccessManager> manager;
};

} // namespace dayhand
