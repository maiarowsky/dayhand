#include "Credentials.h"

#include "Json.h"
#include "PairingInput.h"

#include <QJsonObject>

using namespace Qt::StringLiterals;

namespace dayhand {

QString DeviceCredential::toJson() const
{
    return json::encode(QJsonObject{{u"serverUrl"_s, serverUrl},
                                    {u"convexUrl"_s, convexUrl},
                                    {u"deviceId"_s, deviceId},
                                    {u"deviceName"_s, deviceName},
                                    {u"deviceToken"_s, deviceToken}});
}

std::optional<DeviceCredential> DeviceCredential::fromJson(const QString &text)
{
    const QJsonValue value = json::decode(text);
    DeviceCredential credential;
    const std::pair<const char16_t *, QString *> fields[] = {
        {u"serverUrl", &credential.serverUrl},   {u"convexUrl", &credential.convexUrl},
        {u"deviceId", &credential.deviceId},     {u"deviceName", &credential.deviceName},
        {u"deviceToken", &credential.deviceToken},
    };
    for (const auto &[key, target] : fields) {
        const auto field = json::string(value[QStringView(key)]);
        // A damaged item reads as "not paired", never as a crash.
        if (!field)
            return std::nullopt;
        *target = *field;
    }
    return credential;
}

namespace DevicePairing {

ConnectResult connect(const PairingApi &api, CredentialStore &store, const QString &address, const QString &code,
                      const QString &deviceName)
{
    const auto serverUrl = PairingInput::normalizeServerUrl(address);
    if (!serverUrl)
        return {ConnectError::BadAddress, {}, {}};
    const auto normalizedCode = PairingInput::normalizeCode(code);
    if (!normalizedCode)
        return {ConnectError::BadCode, {}, {}};
    const PairResult answer = api.pair(*serverUrl, *normalizedCode, label(deviceName));
    switch (answer.kind) {
    case PairResult::Kind::Paired:
        break;
    case PairResult::Kind::InvalidCode:
        return {ConnectError::InvalidCode, {}, {}};
    case PairResult::Kind::RateLimited:
        return {ConnectError::RateLimited, {}, answer.retryAfterSeconds};
    case PairResult::Kind::Unreachable:
        return {ConnectError::Unreachable, {}, {}};
    case PairResult::Kind::NotDayhand:
        return {ConnectError::NotDayhand, {}, {}};
    case PairResult::Kind::ServerError:
        return {ConnectError::ServerError, {}, {}};
    }
    const DeviceCredential credential{*serverUrl, PairingInput::reachableConvexUrl(answer.convexUrl, *serverUrl),
                                      answer.deviceId, answer.deviceName, answer.deviceToken};
    if (!store.save(credential).isEmpty())
        return {ConnectError::Storage, {}, {}};
    return {ConnectError::None, credential, {}};
}

QString label(const QString &name)
{
    QString trimmed = name.trimmed();
    // The server counts UTF-16 units, as JavaScript does; a surrogate pair is not split.
    while (trimmed.size() > maxName)
        trimmed.chop(trimmed.size() >= 2 && trimmed.back().isLowSurrogate() ? 2 : 1);
    return trimmed.isEmpty() ? u"Linux"_s : trimmed;
}

QString message(ConnectError error, std::optional<int> retryAfterSeconds)
{
    switch (error) {
    case ConnectError::None:
        return {};
    case ConnectError::BadAddress:
        return u"That is not a server address. It looks like https://<name>.convex.site."_s;
    case ConnectError::BadCode:
        return u"A pairing code has 12 letters and digits, like E6M8-FE02-XSNT."_s;
    case ConnectError::InvalidCode:
        return u"The code is wrong, used or expired. Run dayhand pair again for a new one."_s;
    case ConnectError::RateLimited: {
        const QString wait = !retryAfterSeconds         ? u"a few minutes"_s
                             : *retryAfterSeconds >= 60 ? u"%1 min"_s.arg((*retryAfterSeconds + 59) / 60)
                                                        : u"%1 s"_s.arg(*retryAfterSeconds);
        return u"Too many wrong codes on this server. Try again in %1."_s.arg(wait);
    }
    case ConnectError::Unreachable:
        return u"The server cannot be reached. Check the address and the network."_s;
    case ConnectError::NotDayhand:
        return u"Something answered at that address, but it is not a Dayhand server."_s;
    case ConnectError::ServerError:
        return u"The server has a problem. Try again later."_s;
    case ConnectError::Storage:
        return u"The sign-in could not be saved in the keyring (is a Secret Service such as gnome-keyring running?)."_s;
    }
    return {};
}

} // namespace DevicePairing
} // namespace dayhand
