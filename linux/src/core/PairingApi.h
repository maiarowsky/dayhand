#pragma once

#include "Http.h"

#include <QString>

#include <functional>
#include <optional>

namespace dayhand {

/// What `POST /auth/pair` answered.
struct PairResult {
    enum class Kind {
        Paired,
        /// Wrong, expired, used or burned code: the server gives the same answer for all of them.
        InvalidCode,
        /// Too many failed attempts on this server; codes are not checked for [retryAfterSeconds].
        RateLimited,
        /// No answer at all (no route, timeout, TLS failure).
        Unreachable,
        /// Something answered, but not a Dayhand server (404, HTML, another JSON).
        NotDayhand,
        /// A Dayhand server with a problem of its own (5xx, 400).
        ServerError,
    };

    Kind kind = Kind::NotDayhand;
    QString deviceId;
    QString deviceName;
    QString deviceToken;
    QString convexUrl;
    std::optional<int> retryAfterSeconds;
    int status = 0;
    QString reason;
};

/// What `POST /auth/token` answered.
struct TokenResult {
    enum class Kind {
        /// An app JWT valid until [expiresAt] (Unix ms).
        Issued,
        /// The device was revoked or its token is corrupt: drop it and pair again.
        Revoked,
        /// No network, timeout or `503 not_configured`: keep the device token and try later.
        Unavailable,
    };

    Kind kind = Kind::Unavailable;
    QString token;
    qint64 expiresAt = 0;
    QString reason;

    static TokenResult issued(const QString &token, qint64 expiresAt) { return {Kind::Issued, token, expiresAt, {}}; }
    static TokenResult revoked() { return {Kind::Revoked, {}, 0, {}}; }
    static TokenResult unavailable(const QString &reason) { return {Kind::Unavailable, {}, 0, reason}; }
};

/**
 * `POST /auth/pair` and `POST /auth/token` on the server's HTTP actions URL (docs/pairing.md). The device token is
 * a secret: it is never logged, and failures carry only a status or an error kind.
 */
class PairingApi {
public:
    explicit PairingApi(HttpTransport &transport)
        : transport(transport)
    {
    }

    PairResult pair(const QString &serverUrl, const QString &code, const QString &deviceName) const;
    TokenResult token(const QString &serverUrl, const QString &deviceToken) const;

private:
    HttpTransport &transport;
};

/// Where the app JWT for the HTTP API comes from.
class AppTokens {
public:
    virtual ~AppTokens() = default;
    /// A token to send now. [forceRefresh] asks for a new one even when the cached one still looks valid.
    virtual TokenResult token(bool forceRefresh) = 0;
};

/**
 * App JWTs (1 hour) for a paired computer, from `POST /auth/token`, as the Android app's `DeviceTokens`. The JWT is
 * kept in memory only and fetched again when less than five minutes are left. `401 invalid_grant` means the device
 * was revoked: [onRevoked] runs. Network errors and `503` keep the device token; a cached JWT that is still valid
 * is used meanwhile. Used from one thread (the sync worker).
 */
class DeviceTokens final : public AppTokens {
public:
    /// Refresh when less than 5 minutes are left (docs/pairing.md).
    static constexpr qint64 refreshMarginMs = 5 * 60 * 1000;
    /// A cached token this close to its end is not worth sending when a refresh failed.
    static constexpr qint64 stillUsableMs = 30 * 1000;

    DeviceTokens(QString serverUrl, QString deviceToken, const PairingApi &api, std::function<void()> onRevoked,
                 std::function<qint64()> clock);

    TokenResult token(bool forceRefresh) override;

private:
    QString serverUrl;
    QString deviceToken;
    const PairingApi &api;
    std::function<void()> onRevoked;
    std::function<qint64()> clock;
    std::optional<TokenResult> cached;
};

} // namespace dayhand
