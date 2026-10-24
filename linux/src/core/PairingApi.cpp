#include "PairingApi.h"

#include "Json.h"

#include <QJsonObject>

using namespace Qt::StringLiterals;

namespace dayhand {

namespace {

QByteArray body(const QJsonObject &object)
{
    return json::encode(object).toUtf8();
}

PairResult paired(const QJsonValue &answer)
{
    const auto id = json::string(answer[u"deviceId"]);
    const auto name = json::string(answer[u"deviceName"]);
    const auto token = json::string(answer[u"deviceToken"]);
    const auto convexUrl = json::string(answer[u"convexUrl"]);
    PairResult result;
    if (!id || !name || !token || !convexUrl)
        return result;
    result.kind = PairResult::Kind::Paired;
    result.deviceId = *id;
    result.deviceName = *name;
    result.deviceToken = *token;
    result.convexUrl = *convexUrl;
    return result;
}

} // namespace

PairResult PairingApi::pair(const QString &serverUrl, const QString &code, const QString &deviceName) const
{
    const QUrl url(serverUrl + u"/auth/pair"_s);
    PairResult result;
    if (!url.isValid())
        return result;
    const HttpReply reply = transport.post(url, body({{u"code"_s, code}, {u"deviceName"_s, deviceName}}), {});
    if (!reply.answered()) {
        result.kind = PairResult::Kind::Unreachable;
        result.reason = reply.failure;
        return result;
    }
    const QJsonValue answer = json::decode(reply.body);
    const bool hasError = answer[u"error"].isString();
    result.status = reply.status;
    if (reply.status == 200)
        return paired(answer);
    if (reply.status == 401)
        result.kind = answer[u"error"].toString() == u"invalid_grant" ? PairResult::Kind::InvalidCode
                                                                        : PairResult::Kind::NotDayhand;
    else if (reply.status == 429) {
        result.kind = PairResult::Kind::RateLimited;
        bool ok = false;
        const int seconds = reply.retryAfter.trimmed().toInt(&ok);
        if (ok)
            result.retryAfterSeconds = seconds;
    } else if (reply.status == 400)
        result.kind = hasError ? PairResult::Kind::ServerError : PairResult::Kind::NotDayhand;
    else if (reply.status >= 500 && reply.status <= 599)
        result.kind = PairResult::Kind::ServerError;
    return result;
}

TokenResult PairingApi::token(const QString &serverUrl, const QString &deviceToken) const
{
    const QUrl url(serverUrl + u"/auth/token"_s);
    if (!url.isValid())
        return TokenResult::unavailable(u"bad address"_s);
    const HttpReply reply = transport.post(url, body({{u"deviceToken"_s, deviceToken}}), {});
    if (!reply.answered())
        return TokenResult::unavailable(reply.failure);
    const QJsonValue answer = json::decode(reply.body);
    // Only the server's own "not valid" ends the pairing; a proxy's 401 or a wrong address must not.
    if (reply.status == 401 && answer[u"error"].toString() == u"invalid_grant")
        return TokenResult::revoked();
    if (reply.status != 200)
        return TokenResult::unavailable(u"HTTP %1"_s.arg(reply.status));
    const auto token = json::string(answer[u"token"]);
    if (!token)
        return TokenResult::unavailable(u"no token"_s);
    const auto expiresAt = json::integer(answer[u"expiresAt"]);
    if (!expiresAt)
        return TokenResult::unavailable(u"no expiry"_s);
    return TokenResult::issued(*token, *expiresAt);
}

DeviceTokens::DeviceTokens(QString serverUrl, QString deviceToken, const PairingApi &api,
                           std::function<void()> onRevoked, std::function<qint64()> clock)
    : serverUrl(std::move(serverUrl))
    , deviceToken(std::move(deviceToken))
    , api(api)
    , onRevoked(std::move(onRevoked))
    , clock(std::move(clock))
{
}

TokenResult DeviceTokens::token(bool forceRefresh)
{
    if (!forceRefresh && cached && cached->expiresAt - clock() > refreshMarginMs)
        return *cached;
    const TokenResult fresh = api.token(serverUrl, deviceToken);
    switch (fresh.kind) {
    case TokenResult::Kind::Issued:
        cached = fresh;
        return fresh;
    case TokenResult::Kind::Revoked:
        cached.reset();
        if (onRevoked)
            onRevoked();
        return fresh;
    case TokenResult::Kind::Unavailable:
        break;
    }
    if (cached && cached->expiresAt - clock() > stillUsableMs)
        return *cached;
    return fresh;
}

} // namespace dayhand
