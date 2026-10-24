#include "Http.h"

#include <QEventLoop>
#include <QMetaEnum>
#include <QNetworkAccessManager>
#include <QNetworkCookie>
#include <QNetworkCookieJar>
#include <QNetworkReply>
#include <QNetworkRequest>

using namespace Qt::StringLiterals;

namespace dayhand {

namespace {

/// Keeps no cookies at all.
class NoCookies final : public QNetworkCookieJar {
public:
    bool setCookiesFromUrl(const QList<QNetworkCookie> &, const QUrl &) override { return false; }
    QList<QNetworkCookie> cookiesForUrl(const QUrl &) const override { return {}; }
};

QString errorKind(QNetworkReply::NetworkError error)
{
    const char *name = QMetaEnum::fromType<QNetworkReply::NetworkError>().valueToKey(error);
    return name ? QString::fromLatin1(name) : u"NetworkError %1"_s.arg(int(error));
}

} // namespace

NetworkTransport::NetworkTransport()
    : manager(std::make_unique<QNetworkAccessManager>())
{
    manager->setCookieJar(new NoCookies);
    manager->setRedirectPolicy(QNetworkRequest::ManualRedirectPolicy);
}

NetworkTransport::~NetworkTransport() = default;

HttpReply NetworkTransport::post(const QUrl &url, const QByteArray &json, const QString &bearer)
{
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::ContentTypeHeader, u"application/json"_s);
    request.setTransferTimeout(timeoutMs);
    request.setAttribute(QNetworkRequest::CacheLoadControlAttribute, QNetworkRequest::AlwaysNetwork);
    request.setAttribute(QNetworkRequest::CacheSaveControlAttribute, false);
    if (!bearer.isEmpty())
        request.setRawHeader("Authorization", "Bearer " + bearer.toUtf8());

    QNetworkReply *reply = manager->post(request, json);
    QEventLoop loop;
    QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    if (!reply->isFinished())
        loop.exec(QEventLoop::ExcludeUserInputEvents);

    const QVariant status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute);
    HttpReply result;
    if (!status.isValid()) {
        result = HttpReply::unreachable(errorKind(reply->error()));
    } else {
        result.status = status.toInt();
        result.body = reply->readAll();
        result.retryAfter = QString::fromLatin1(reply->rawHeader("Retry-After"));
    }
    // Not deleteLater: a worker thread has no running event loop to process deferred deletes.
    delete reply;
    return result;
}

} // namespace dayhand
