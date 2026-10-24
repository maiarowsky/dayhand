#include "FakeServer.h"

#include "Json.h"

#include <QJsonArray>

#include <algorithm>

using namespace Qt::StringLiterals;

namespace dayhand::test {

namespace {

HttpReply reply(int status, const QJsonObject &body)
{
    return {status, json::encode(body).toUtf8(), {}, {}};
}

HttpReply success(const QJsonValue &value)
{
    return reply(200, {{u"status"_s, u"success"_s}, {u"value"_s, value}});
}

HttpReply failure(const QString &message)
{
    return reply(FakeServer::udfFailed, {{u"status"_s, u"error"_s}, {u"errorMessage"_s, message}});
}

HttpReply invalidGrant()
{
    return reply(401, {{u"error"_s, u"invalid_grant"_s}, {u"error_description"_s, u"The code or token is not valid"_s}});
}

} // namespace

HttpReply FakeServer::post(const QUrl &url, const QByteArray &json, const QString &bearer)
{
    const QJsonValue body = json::decode(json);
    const QString path = url.path();
    requests.append({path, bearer, body});
    if (offline)
        return HttpReply::unreachable(u"HostNotFoundError"_s);
    if (path == u"/auth/pair")
        return pair(body);
    if (path == u"/auth/token")
        return token(body);
    if (path != u"/api/mutation" && path != u"/api/query")
        return {404, "<html>Not found</html>", {}, {}};
    if (!validJwts.contains(bearer))
        return reply(udfFailed, {{u"status"_s, u"error"_s}, {u"errorMessage"_s, u"Sign in required"_s},
                                 {u"errorData"_s, QJsonObject{{u"code"_s, u"unauthenticated"_s}}}});
    if (path == u"/api/mutation" && failNextMutation) {
        failNextMutation = false;
        return {503, "busy", {}, {}};
    }
    const QString function = body[u"path"].toString();
    const QJsonObject args = body[u"args"][0].toObject();
    if (path == u"/api/query")
        return query(function);
    const HttpReply answer = mutation(function, args);
    if (loseNextAnswer) {
        loseNextAnswer = false;
        return HttpReply::unreachable(u"RemoteHostClosedError"_s);
    }
    return answer;
}

QString FakeServer::addElsewhere(const QString &title, const QString &dueDate)
{
    QJsonObject args{{u"title"_s, title}};
    if (!dueDate.isEmpty())
        args.insert(u"dueDate", dueDate);
    return add(args)[u"id"].toString();
}

void FakeServer::editElsewhere(const QString &id, const QJsonObject &fields)
{
    change(id, [&fields](QJsonObject &task) {
        for (auto it = fields.begin(); it != fields.end(); ++it)
            task.insert(it.key(), it.value());
    });
}

QList<QJsonObject> FakeServer::allTasks() const
{
    QList<QJsonObject> out;
    for (const QString &id : order)
        out.append(tasks.value(id));
    return out;
}

std::optional<QJsonObject> FakeServer::taskTitled(const QString &title) const
{
    for (const QJsonObject &task : allTasks()) {
        if (task[u"title"].toString() == title)
            return task;
    }
    return std::nullopt;
}

QStringList FakeServer::mutationsSent() const
{
    QStringList out;
    for (const Request &request : requests) {
        if (request.path == u"/api/mutation")
            out.append(request.body[u"path"].toString());
    }
    return out;
}

HttpReply FakeServer::pair(const QJsonValue &body)
{
    if (body[u"code"].toString() != pairingCode)
        return invalidGrant();
    const QJsonValue name = body[u"deviceName"].isString() ? body[u"deviceName"] : QJsonValue(u"Phone"_s);
    return reply(200, {{u"deviceId"_s, u"dev1"_s}, {u"deviceName"_s, name}, {u"deviceToken"_s, deviceToken}, {u"convexUrl"_s, cloud}});
}

HttpReply FakeServer::token(const QJsonValue &body)
{
    if (revoked || body[u"deviceToken"].toString() != deviceToken)
        return invalidGrant();
    const QString jwt = u"jwt-%1"_s.arg(nextJwt++);
    validJwts.append(jwt);
    return reply(200, {{u"token"_s, jwt}, {u"tokenType"_s, u"Bearer"_s}, {u"expiresIn"_s, 3600},
                       {u"expiresAt"_s, clock() + 3'600'000}});
}

HttpReply FakeServer::query(const QString &path)
{
    if (path == u"app:getSettings")
        return success(settings);
    if (path != u"app:listAll" && path != u"app:listTrash")
        return failure(u"unknown query "_s + path);
    const bool trash = path == u"app:listTrash";
    QJsonArray list;
    for (const QJsonObject &task : allTasks()) {
        if (task.contains(u"deletedAt") == trash)
            list.append(task);
    }
    return success(list);
}

HttpReply FakeServer::mutation(const QString &path, const QJsonObject &args)
{
    const QString clientId = args[u"clientId"].toString();
    if (!clientId.isEmpty() && seenClientIds.contains(clientId))
        return success(seenClientIds.value(clientId));
    QJsonValue value;
    if (path == u"app:add") {
        value = add(args);
    } else {
        const QString id = args[u"taskId"].toString();
        const bool clearNow = path == u"app:setNow" && args[u"taskId"].isNull();
        if (!clearNow && !tasks.contains(id))
            return failure(u"Task not found"_s);
        if (!clearNow && tasks.value(id).contains(u"deletedAt") && path != u"app:restore")
            return failure(u"Task is in the trash"_s);
        if (!applyChange(path, id, args))
            return failure(u"unknown mutation "_s + path);
        value = clearNow ? QJsonValue(QJsonValue::Null) : QJsonValue(tasks.value(id));
    }
    if (!clientId.isEmpty())
        seenClientIds.insert(clientId, value);
    return success(value);
}

bool FakeServer::applyChange(const QString &path, const QString &id, const QJsonObject &args)
{
    const qint64 now = clock();
    if (path == u"app:update") {
        change(id, [&args](QJsonObject &task) {
            for (auto it = args.begin(); it != args.end(); ++it) {
                if (it.key() == u"taskId" || it.key() == u"clientId")
                    continue;
                if (it.value().isNull())
                    task.remove(it.key());
                else
                    task.insert(it.key(), it.value());
            }
        });
    } else if (path == u"app:complete") {
        change(id, [now](QJsonObject &t) { t[u"status"] = u"done"_s; t[u"completedAt"] = now; t[u"isNow"] = false; });
    } else if (path == u"app:setStatus") {
        change(id, [&args](QJsonObject &t) {
            const QString status = args[u"status"].toString();
            t[u"status"] = status;
            if (status != u"doing")
                t[u"isNow"] = false;
            if (status != u"done")
                t.remove(u"completedAt");
        });
    } else if (path == u"app:setNow") {
        for (const QString &other : order) {
            if (other != id && tasks.value(other)[u"isNow"].toBool())
                change(other, [](QJsonObject &t) { t[u"isNow"] = false; });
        }
        if (!id.isEmpty())
            change(id, [](QJsonObject &t) { t[u"isNow"] = true; t[u"status"] = u"doing"_s; });
    } else if (path == u"app:reschedule") {
        change(id, [&args](QJsonObject &t) { t[u"dueDate"] = args[u"dueDate"]; });
    } else if (path == u"app:archive") {
        change(id, [now](QJsonObject &t) { t[u"archivedAt"] = now; t[u"isNow"] = false; });
    } else if (path == u"app:softDelete") {
        change(id, [now](QJsonObject &t) { t[u"deletedAt"] = now; t[u"isNow"] = false; });
    } else if (path == u"app:restore") {
        change(id, [](QJsonObject &t) { t.contains(u"deletedAt") ? t.remove(u"deletedAt") : t.remove(u"archivedAt"); });
    } else {
        return false;
    }
    return true;
}

QJsonObject FakeServer::add(const QJsonObject &args)
{
    const QString id = u"srv%1"_s.arg(nextId++);
    QJsonObject task{{u"id"_s, id}, {u"title"_s, args[u"title"]}, {u"status"_s, u"todo"_s}, {u"isNow"_s, false},
                     {u"labels"_s, QJsonArray()}, {u"links"_s, QJsonArray()}, {u"checklist"_s, QJsonArray()},
                     {u"createdAt"_s, clock()}, {u"updatedAt"_s, clock()}};
    for (const char16_t *key : {u"note", u"dueDate", u"dueTime", u"clientId"}) {
        if (args.contains(QStringView(key)))
            task.insert(QStringView(key), args[QStringView(key)]);
    }
    tasks.insert(id, task);
    order.append(id);
    return task;
}

void FakeServer::change(const QString &id, const std::function<void(QJsonObject &)> &edit, bool touch)
{
    if (!tasks.contains(id))
        return;
    QJsonObject task = tasks.value(id);
    edit(task);
    if (touch)
        task[u"updatedAt"] = std::max(clock(), json::integer(task[u"updatedAt"]).value_or(0) + 1);
    tasks.insert(id, task);
}

} // namespace dayhand::test
