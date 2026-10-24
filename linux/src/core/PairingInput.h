#pragma once

#include <QString>

#include <optional>

namespace dayhand {

/// A pairing link from `dayhand pair` (text or QR), see docs/pairing.md.
struct PairingLink {
    std::optional<QString> serverUrl;
    std::optional<QString> code;

    bool operator==(const PairingLink &) const = default;
};

/// Checks of what the user types on the Connect screen, the same rules as the backend and the other apps.
namespace PairingInput {

/**
 * `XXXX-XXXX-XXXX` from a typed code (any case, with or without dashes and spaces; `O` is read as `0`, `I` and `L`
 * as `1`), or nothing when it cannot be a pairing code.
 */
std::optional<QString> normalizeCode(const QString &input);

/**
 * The HTTP actions URL (`https://<name>.convex.site`) without a trailing slash, or nothing. A Convex deployment URL
 * (`.convex.cloud`) is turned into its HTTP actions URL, since that is the address people copy most often.
 */
std::optional<QString> normalizeServerUrl(const QString &input);

/// The server and code from a `dayhand://pair?url=…&code=…` or `helm://pair?…` link, or nothing when it is not one.
std::optional<PairingLink> parseLink(const QString &text);

/**
 * The Convex URL to use from this computer. `/auth/pair` returns the deployment's own view of its address; a local
 * backend calls itself `127.0.0.1`, which another machine (or a container) cannot reach, so there the host of the
 * server just talked to is used with the returned port.
 */
QString reachableConvexUrl(const QString &convexUrl, const QString &serverUrl);

/// True when [url] names this machine, where plain HTTP is safe (a local backend).
bool isLoopback(const QString &url);

} // namespace PairingInput
} // namespace dayhand
