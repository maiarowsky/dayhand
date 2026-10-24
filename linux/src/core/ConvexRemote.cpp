#include "ConvexRemote.h"

#include "Json.h"

#include <QJsonArray>
#include <QJsonObject>

using namespace Qt::StringLiterals;

namespace dayhand {

namespace {

SendResult fromToken(const TokenResult &token)
{
    if (token.kind == TokenResult::Kind::Revoked)
        return SendResult::unauthorized();
    return SendResult::failed(token.reason);
}

SnapshotSource::Result feedError(const SendResult &result)
{
    if (result.kind == SendResult::Kind::Unauthorized)
        return {std::nullopt, true, {}};
    return {std::nullopt, false, result.message.isEmpty() ? u"unexpected"_s : result.message};
}

} // namespace

ConvexRemote::ConvexRemote(const QString &deploymentUrl, AppTokens &tokens, HttpTransport &transport)
    : deploymentUrl(deploymentUrl)
    , tokens(tokens)
    , transport(transport)
{
    while (this->deploymentUrl.endsWith(u'/'))
        this->deploymentUrl.chop(1);
}

SendResult ConvexRemote::send(const QString &mutation, const QJsonValue &args)
{
    return call(u"/api/mutation"_s, mutation, args);
}

SendResult ConvexRemote::query(const QString &path, const QJsonValue &args)
{
    return call(u"/api/query"_s, path, args);
}

SnapshotSource::Result ConvexRemote::snapshot()
{
    const SendResult active = query(RemoteJson::queryTasks, RemoteJson::tasksArgs());
    if (active.kind != SendResult::Kind::Applied)
        return feedError(active);
    const SendResult trash = query(RemoteJson::queryTrash, QJsonObject());
    if (trash.kind != SendResult::Kind::Applied)
        return feedError(trash);
    const SendResult settings = query(RemoteJson::querySettings, QJsonObject());
    if (settings.kind != SendResult::Kind::Applied)
        return feedError(settings);
    return {RemoteJson::snapshot(active.value, trash.value, settings.value), false, {}};
}

SendResult ConvexRemote::call(const QString &endpoint, const QString &path, const QJsonValue &args)
{
    const QUrl url(deploymentUrl + endpoint);
    if (!url.isValid())
        return SendResult::failed(u"bad address"_s);
    const QByteArray body = requestBody(path, args);
    const TokenResult first = tokens.token(false);
    if (first.kind != TokenResult::Kind::Issued)
        return fromToken(first);
    const SendResult result = post(url, body, first.token);
    if (result.kind != SendResult::Kind::Unauthorized)
        return result;
    // The JWT may have expired early (clock skew) or been rotated: one more try with a new one.
    const TokenResult second = tokens.token(true);
    if (second.kind != TokenResult::Kind::Issued || second.token == first.token)
        return result;
    return post(url, body, second.token);
}

SendResult ConvexRemote::post(const QUrl &url, const QByteArray &body, const QString &token)
{
    const HttpReply reply = transport.post(url, body, token);
    if (!reply.answered())
        return SendResult::failed(reply.failure);
    return classify(reply);
}

QByteArray ConvexRemote::requestBody(const QString &path, const QJsonValue &args)
{
    const QJsonObject body{{u"path"_s, path}, {u"format"_s, u"convex_encoded_json"_s}, {u"args"_s, QJsonArray{args}}};
    return json::encode(body).toUtf8();
}

SendResult ConvexRemote::classify(const HttpReply &reply)
{
    if (reply.status == 401 || reply.status == 403)
        return SendResult::unauthorized();
    if (reply.status != 200 && reply.status != udfFailed)
        return SendResult::failed(u"HTTP %1"_s.arg(reply.status));
    const QJsonValue body = json::decode(reply.body);
    if (!body.isObject())
        return SendResult::failed(u"unreadable answer"_s);
    const QString status = body[u"status"].toString();
    if (status == u"success")
        return SendResult::applied(body[u"value"].isUndefined() ? QJsonValue(QJsonObject()) : body[u"value"]);
    if (status == u"error") {
        if (RemoteJson::errorCode(body[u"errorData"]) == u"unauthenticated")
            return SendResult::unauthorized();
        return SendResult::rejected(json::string(body[u"errorMessage"]).value_or(u"error"_s));
    }
    return SendResult::failed(u"unexpected answer"_s);
}

} // namespace dayhand
