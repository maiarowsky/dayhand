// Pairing: the input rules (the Android app's PairingInputTest, plus the dayhand://pair link), the answers of
// /auth/pair and /auth/token, the device tokens (DeviceTokensTest), and connecting against the fake server.
#include "Credentials.h"
#include "FakeServer.h"
#include "Json.h"
#include "PairingApi.h"
#include "PairingInput.h"

#include <QJsonObject>
#include <QTest>

using namespace dayhand;
using namespace dayhand::test;
using namespace Qt::StringLiterals;

namespace {

/// A transport that answers from a list, for the replies the fake server does not produce.
class ScriptedTransport final : public HttpTransport {
public:
    explicit ScriptedTransport(QList<HttpReply> replies)
        : replies(std::move(replies))
    {
    }
    HttpReply post(const QUrl &, const QByteArray &, const QString &) override
    {
        ++calls;
        return replies.takeFirst();
    }
    QList<HttpReply> replies;
    int calls = 0;
};

HttpReply answer(int status, const QJsonObject &body, const QString &retryAfter = {})
{
    return {status, json::encode(body).toUtf8(), retryAfter, {}};
}

PairResult::Kind pairKind(const HttpReply &reply)
{
    ScriptedTransport transport({reply});
    return PairingApi(transport).pair(u"https://x"_s, u"E6M8-FE02-XSNT"_s, u"Linux"_s).kind;
}

TokenResult tokenOf(const HttpReply &reply)
{
    ScriptedTransport transport({reply});
    return PairingApi(transport).token(u"https://x"_s, u"t"_s);
}

HttpReply issued(const QString &token, qint64 expiresAt)
{
    return answer(200, {{u"token"_s, token}, {u"expiresAt"_s, expiresAt}});
}

constexpr qint64 hour = 3'600'000;

} // namespace

class PairingTest : public QObject {
    Q_OBJECT

private slots:
    void codesAreReadLikeTheBackendReadsThem()
    {
        QCOMPARE(PairingInput::normalizeCode(u"E6M8-FE02-XSNT"_s), u"E6M8-FE02-XSNT"_s);
        QCOMPARE(PairingInput::normalizeCode(u" e6m8 fe02 xsnt "_s), u"E6M8-FE02-XSNT"_s);
        QCOMPARE(PairingInput::normalizeCode(u"e6m8fe02xsnt"_s), u"E6M8-FE02-XSNT"_s);
        QCOMPARE(PairingInput::normalizeCode(u"ilOo-abcd-efgh"_s), u"1100-ABCD-EFGH"_s);
        for (const QString &code : {u"E6M8-FE02-XSN"_s, u"E6M8-FE02-XSNTT"_s, u"E6M8-FE02-XSNU"_s, u"E6M8_FE02_XSNT"_s, QString()})
            QVERIFY2(!PairingInput::normalizeCode(code), qPrintable(code));
    }

    void serverAddressesAreTrimmedAndACloudAddressBecomesItsHTTPActionsAddress()
    {
        QCOMPARE(PairingInput::normalizeServerUrl(u" https://example-deployment-123.eu-west-1.convex.site/ "_s),
                 u"https://example-deployment-123.eu-west-1.convex.site"_s);
        QCOMPARE(PairingInput::normalizeServerUrl(u"https://happy-otter-123.convex.cloud"_s), u"https://happy-otter-123.convex.site"_s);
        QCOMPARE(PairingInput::normalizeServerUrl(u"http://127.0.0.1:3211"_s), u"http://127.0.0.1:3211"_s);
        for (const QString &address : {u"10.0.2.2:3211"_s, u"ftp://example.com"_s, u"https://"_s, u"http://exa mple.com"_s,
                                       u"https://example.convex.site/auth/pair"_s})
            QVERIFY2(!PairingInput::normalizeServerUrl(address), qPrintable(address));
    }

    void aPairingLinkGivesTheServerAndTheCode()
    {
        QCOMPARE(PairingInput::parseLink(u"helm://pair?url=https%3A%2F%2Fexample-deployment-123.eu-west-1.convex.site&code=E6M8-FE02-XSNT"_s),
                 (PairingLink{u"https://example-deployment-123.eu-west-1.convex.site"_s, u"E6M8-FE02-XSNT"_s}));
        QCOMPARE(PairingInput::parseLink(u"helm://pair?url=http://127.0.0.1:3211"_s), (PairingLink{u"http://127.0.0.1:3211"_s, std::nullopt}));
        QCOMPARE(PairingInput::parseLink(u"dayhand://pair?url=http%3A%2F%2F127.0.0.1%3A3211&code=e6m8fe02xsnt"_s),
                 (PairingLink{u"http://127.0.0.1:3211"_s, u"E6M8-FE02-XSNT"_s}));
        QVERIFY(!PairingInput::parseLink(u"https://example.com/pair?code=E6M8-FE02-XSNT"_s));
        QVERIFY(!PairingInput::parseLink(u"helm://task?id=1"_s));
        QVERIFY(!PairingInput::parseLink(u"not a link"_s));
    }

    void aLocalBackendsLoopbackAddressIsReplacedByTheHostThatWasReached()
    {
        QCOMPARE(PairingInput::reachableConvexUrl(u"http://127.0.0.1:3210"_s, u"http://127.0.0.1:3211"_s), u"http://127.0.0.1:3210"_s);
        QCOMPARE(PairingInput::reachableConvexUrl(u"http://localhost:3210"_s, u"http://192.168.1.20:3211"_s), u"http://192.168.1.20:3210"_s);
        QCOMPARE(PairingInput::reachableConvexUrl(u"https://grouse.eu-west-1.convex.cloud"_s, u"https://grouse.eu-west-1.convex.site"_s),
                 u"https://grouse.eu-west-1.convex.cloud"_s);
    }

    void theDeviceNameIsTrimmedAndBounded()
    {
        QCOMPARE(DevicePairing::label(u"  ThinkPad "_s), u"ThinkPad"_s);
        QCOMPARE(DevicePairing::label(u"   "_s), u"Linux"_s);
        QCOMPARE(DevicePairing::label(QString(150, u'x')).size(), 100);
    }

    void everyAnswerOfPairIsToldApart()
    {
        using K = PairResult::Kind;
        QCOMPARE(pairKind(answer(200, {{u"deviceId"_s, u"d"_s}, {u"deviceName"_s, u"L"_s}, {u"deviceToken"_s, u"t"_s}, {u"convexUrl"_s, u"https://c"_s}})),
                 K::Paired);
        QCOMPARE(pairKind(answer(401, {{u"error"_s, u"invalid_grant"_s}})), K::InvalidCode);
        QCOMPARE(pairKind(answer(400, {{u"error"_s, u"invalid_request"_s}})), K::ServerError);
        QCOMPARE(pairKind(answer(503, {{u"error"_s, u"x"_s}})), K::ServerError);
        QCOMPARE(pairKind({404, "<html>", {}, {}}), K::NotDayhand);
        QCOMPARE(pairKind({401, "proxy says no", {}, {}}), K::NotDayhand);
        QCOMPARE(pairKind(answer(200, {{u"something"_s, u"else"_s}})), K::NotDayhand);
        QCOMPARE(pairKind(HttpReply::unreachable(u"ConnectionRefusedError"_s)), K::Unreachable);
        ScriptedTransport limited({answer(429, {{u"error"_s, u"rate_limited"_s}}, u" 120 "_s)});
        QCOMPARE(PairingApi(limited).pair(u"https://x"_s, u"E6M8-FE02-XSNT"_s, u"L"_s).retryAfterSeconds, 120);
    }

    void onlyTheServersOwnNotValidEndsThePairing()
    {
        QCOMPARE(tokenOf(issued(u"jwt"_s, 1'792'691'766'000)).token, u"jwt"_s);
        QCOMPARE(tokenOf(answer(401, {{u"error"_s, u"invalid_grant"_s}})).kind, TokenResult::Kind::Revoked);
        QCOMPARE(tokenOf({401, {}, {}, {}}).reason, u"HTTP 401"_s);
        QCOMPARE(tokenOf(answer(503, {{u"error"_s, u"not_configured"_s}})).reason, u"HTTP 503"_s);
        QCOMPARE(tokenOf(answer(200, {{u"token"_s, u"jwt"_s}})).reason, u"no expiry"_s);
    }

    void connectStoresNothingUnlessTheServerAcceptedTheCode()
    {
        FakeServer server;
        const PairingApi api(server);
        MemoryCredentialStore store;
        QCOMPARE(DevicePairing::connect(api, store, u"nonsense"_s, FakeServer::pairingCode, u"L"_s).error, ConnectError::BadAddress);
        QCOMPARE(DevicePairing::connect(api, store, FakeServer::site, u"short"_s, u"L"_s).error, ConnectError::BadCode);
        QCOMPARE(DevicePairing::connect(api, store, FakeServer::site, u"AAAA-AAAA-AAAA"_s, u"L"_s).error, ConnectError::InvalidCode);
        QVERIFY(!store.load().credential);
        const ConnectResult result = DevicePairing::connect(api, store, FakeServer::site + u"/"_s, u"e6m8 fe02 xsnt"_s, u"ThinkPad"_s);
        const DeviceCredential expected{FakeServer::site, FakeServer::cloud, u"dev1"_s, u"ThinkPad"_s, FakeServer::deviceToken};
        QCOMPARE(result.credential, expected);
        QCOMPARE(store.load().credential, expected);
        QCOMPARE(DeviceCredential::fromJson(expected.toJson()), expected);
        QVERIFY(!DeviceCredential::fromJson(u"{\"serverUrl\":1}"_s));
    }

    void aTokenIsReusedUntilFiveMinutesBeforeItEnds()
    {
        qint64 clock = 1'000'000;
        ScriptedTransport transport({issued(u"t1"_s, clock + hour), issued(u"t2"_s, clock + 2 * hour)});
        const PairingApi api(transport);
        DeviceTokens tokens(u"https://x"_s, u"d"_s, api, {}, [&clock] { return clock; });
        QCOMPARE(tokens.token(false).token, u"t1"_s);
        clock += hour - DeviceTokens::refreshMarginMs - 1000;
        QCOMPARE(tokens.token(false).token, u"t1"_s);
        QCOMPARE(transport.calls, 1);
        clock += 2000;
        QCOMPARE(tokens.token(false).token, u"t2"_s);
        QCOMPARE(transport.calls, 2);
    }

    void withoutTheServerACachedTokenThatIsStillValidIsUsedAndARevokedOneIsDroppedOnce()
    {
        qint64 clock = 1'000'000;
        int revoked = 0;
        ScriptedTransport transport({issued(u"t1"_s, clock + hour), answer(503, {{u"error"_s, u"not_configured"_s}}),
                                     answer(401, {{u"error"_s, u"invalid_grant"_s}})});
        const PairingApi api(transport);
        DeviceTokens tokens(u"https://x"_s, u"d"_s, api, [&revoked] { ++revoked; }, [&clock] { return clock; });
        tokens.token(false);
        QCOMPARE(tokens.token(true).token, u"t1"_s);
        QCOMPARE(revoked, 0);
        QCOMPARE(tokens.token(true).kind, TokenResult::Kind::Revoked);
        QCOMPARE(revoked, 1);
    }
};

QTEST_GUILESS_MAIN(PairingTest)
#include "tst_pairing.moc"
