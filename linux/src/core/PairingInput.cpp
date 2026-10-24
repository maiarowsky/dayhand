#include "PairingInput.h"

#include <QSet>
#include <QUrl>
#include <QUrlQuery>

using namespace Qt::StringLiterals;

namespace dayhand::PairingInput {

namespace {

/// Crockford base32 without I, L, O and U, as `CODE_ALPHABET` in `backend/convex/lib/secrets.ts`.
const QString codeAlphabet = u"0123456789ABCDEFGHJKMNPQRSTVWXYZ"_s;
constexpr int codeLength = 12;

bool isLoopbackHost(const QString &host)
{
    static const QSet<QString> hosts{u"127.0.0.1"_s, u"localhost"_s, u"0.0.0.0"_s, u"::1"_s, u"[::1]"_s};
    return hosts.contains(host.toLower());
}

QString withoutTrailingSlashes(QString url)
{
    while (url.endsWith(u'/'))
        url.chop(1);
    return url;
}

} // namespace

std::optional<QString> normalizeCode(const QString &input)
{
    QString code;
    for (QChar c : input.toUpper()) {
        if (c.isSpace() || c == u'-')
            continue;
        if (c == u'O')
            c = u'0';
        else if (c == u'I' || c == u'L')
            c = u'1';
        if (!codeAlphabet.contains(c))
            return std::nullopt;
        code.append(c);
    }
    if (code.size() != codeLength)
        return std::nullopt;
    return code.mid(0, 4) + u'-' + code.mid(4, 4) + u'-' + code.mid(8, 4);
}

std::optional<QString> normalizeServerUrl(const QString &input)
{
    const QString url = withoutTrailingSlashes(input.trimmed());
    const QUrl parsed(url, QUrl::StrictMode);
    const QString scheme = parsed.scheme().toLower();
    if (!parsed.isValid() || (scheme != u"http" && scheme != u"https") || parsed.host().isEmpty())
        return std::nullopt;
    if (!parsed.path().isEmpty() || parsed.hasQuery() || parsed.hasFragment() || !parsed.userInfo().isEmpty())
        return std::nullopt;
    if (parsed.host().endsWith(u".convex.cloud"))
        return QString(url).replace(u".convex.cloud"_s, u".convex.site"_s);
    return url;
}

std::optional<PairingLink> parseLink(const QString &text)
{
    const QUrl url(text.trimmed(), QUrl::StrictMode);
    const QString scheme = url.scheme().toLower();
    if (!url.isValid() || (scheme != u"dayhand" && scheme != u"helm") || url.host() != u"pair")
        return std::nullopt;
    std::optional<QString> server;
    std::optional<QString> code;
    bool seenUrl = false;
    bool seenCode = false;
    for (const auto &[name, value] : QUrlQuery(url).queryItems(QUrl::FullyDecoded)) {
        if (name == u"url" && !seenUrl) {
            seenUrl = true;
            server = normalizeServerUrl(value);
        } else if (name == u"code" && !seenCode) {
            seenCode = true;
            code = normalizeCode(value);
        }
    }
    return PairingLink{server, code};
}

QString reachableConvexUrl(const QString &convexUrl, const QString &serverUrl)
{
    QUrl convex(convexUrl);
    const QUrl server(serverUrl);
    if (!convex.isValid() || convex.host().isEmpty() || !server.isValid())
        return convexUrl;
    if (!isLoopbackHost(convex.host()))
        return withoutTrailingSlashes(convexUrl);
    convex.setHost(server.host());
    convex.setPath(QString());
    return convex.toString();
}

bool isLoopback(const QString &url)
{
    const QUrl parsed(url);
    return parsed.isValid() && isLoopbackHost(parsed.host());
}

} // namespace dayhand::PairingInput
