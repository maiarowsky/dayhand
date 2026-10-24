#pragma once

#include "PairingApi.h"

#include <QString>

#include <optional>

namespace dayhand {

/// A paired computer: the server, the Convex URL it gave, and the long-lived device token (a secret).
struct DeviceCredential {
    /// The HTTP actions URL (`/auth/*`), e.g. `https://<name>.convex.site`.
    QString serverUrl;
    /// The Convex URL for `/api/query` and `/api/mutation`, e.g. `https://<name>.convex.cloud`.
    QString convexUrl;
    QString deviceId;
    QString deviceName;
    QString deviceToken;

    QString toJson() const;
    static std::optional<DeviceCredential> fromJson(const QString &text);

    bool operator==(const DeviceCredential &) const = default;
};

/// What reading the store gave: a credential, none, or a failure (the keyring is locked or missing).
struct CredentialLoad {
    std::optional<DeviceCredential> credential;
    QString error;
};

/// Where the pairing is kept. The app uses the Secret Service keyring; tests use memory.
class CredentialStore {
public:
    virtual ~CredentialStore() = default;
    virtual CredentialLoad load() = 0;
    /// An empty string when saved, otherwise why not.
    virtual QString save(const DeviceCredential &credential) = 0;
    virtual QString remove() = 0;
};

class MemoryCredentialStore final : public CredentialStore {
public:
    CredentialLoad load() override { return {value, {}}; }
    QString save(const DeviceCredential &credential) override
    {
        value = credential;
        return {};
    }
    QString remove() override
    {
        value.reset();
        return {};
    }

private:
    std::optional<DeviceCredential> value;
};

/**
 * The pairing in the desktop keyring through the Secret Service API (libsecret; gnome-keyring on Omarchy), as one
 * item: the device token never touches a file, a log or the settings. The app JWT is never stored at all.
 */
class SecretServiceStore final : public CredentialStore {
public:
    static constexpr const char *schemaName = "io.github.maiarowsky.dayhand";

    CredentialLoad load() override;
    QString save(const DeviceCredential &credential) override;
    QString remove() override;
};

/// Why connecting failed, in the words the Connect screen uses.
enum class ConnectError { None, BadAddress, BadCode, InvalidCode, RateLimited, Unreachable, NotDayhand, ServerError, Storage };

struct ConnectResult {
    ConnectError error = ConnectError::None;
    std::optional<DeviceCredential> credential;
    std::optional<int> retryAfterSeconds;
};

/**
 * Pairs this computer with a server: checks the input, exchanges the one-time code for a device token
 * (`POST /auth/pair`) and stores it. Nothing is stored unless the server accepted the code.
 */
namespace DevicePairing {

/// The backend accepts 1 to 100 characters (`deviceName` in docs/pairing.md).
constexpr int maxName = 100;

ConnectResult connect(const PairingApi &api, CredentialStore &store, const QString &address, const QString &code,
                      const QString &deviceName);
QString label(const QString &name);
QString message(ConnectError error, std::optional<int> retryAfterSeconds);

} // namespace DevicePairing
} // namespace dayhand
