import Foundation

/// A pairing link from `dayhand pair` (text or QR), see docs/pairing.md.
public struct PairingLink: Hashable, Sendable {
    public let serverUrl: String?
    public let code: String?
}

/// Checks of what the user types on the Connect screen, the same rules as the backend and the Android app.
public enum PairingInput {
    /// Crockford base32 without I, L, O and U, as `CODE_ALPHABET` in `backend/convex/lib/secrets.ts`.
    static let codeAlphabet = Set("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
    static let codeLength = 12
    static let loopbackHosts: Set<String> = ["127.0.0.1", "localhost", "0.0.0.0", "::1", "[::1]"]
    /// `dayhand://pair` is what `dayhand pair` prints; `helm://pair` is the same link from `hlm pair` before the rename.
    public static let linkSchemes: Set<String> = ["dayhand", "helm"]

    /**
     * `XXXX-XXXX-XXXX` from a typed code (any case, with or without dashes and spaces; `O` is read as `0`, `I` and `L`
     * as `1`), or nil when it cannot be a pairing code.
     */
    public static func normalizeCode(_ input: String) -> String? {
        let code = input.uppercased()
            .filter { !$0.isWhitespace && $0 != "-" }
            .map { char -> Character in
                switch char {
                case "O": return "0"
                case "I", "L": return "1"
                default: return char
                }
            }
        guard code.count == codeLength, code.allSatisfy(codeAlphabet.contains) else { return nil }
        let text = String(code)
        return [0, 4, 8].map { offset -> String in
            let start = text.index(text.startIndex, offsetBy: offset)
            return String(text[start..<text.index(start, offsetBy: 4)])
        }.joined(separator: "-")
    }

    /**
     * The HTTP actions URL (`https://<name>.convex.site`) without a trailing slash, or nil. A Convex deployment URL
     * (`.convex.cloud`) is turned into its HTTP actions URL, since that is the address people copy most often.
     */
    public static func normalizeServerUrl(_ input: String) -> String? {
        var url = input.trimmingCharacters(in: .whitespacesAndNewlines)
        while url.hasSuffix("/") { url.removeLast() }
        guard let components = URLComponents(string: url), let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https", let host = components.host, !host.isEmpty,
              components.percentEncodedPath.isEmpty, components.query == nil, components.fragment == nil,
              components.user == nil else { return nil }
        if host.hasSuffix(".convex.cloud") { return url.replacingOccurrences(of: ".convex.cloud", with: ".convex.site") }
        return url
    }

    /// The server and code from a `dayhand://pair?url=…&code=…` or `helm://pair?…` link, or nil when it is not one.
    public static func parseLink(_ text: String) -> PairingLink? {
        guard let components = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = components.scheme?.lowercased(), linkSchemes.contains(scheme),
              components.host == "pair" else { return nil }
        var params: [String: String] = [:]
        for item in components.queryItems ?? [] where params[item.name] == nil {
            if let value = item.value { params[item.name] = value }
        }
        return PairingLink(
            serverUrl: params["url"].flatMap(normalizeServerUrl),
            code: params["code"].flatMap(normalizeCode)
        )
    }

    /**
     * The Convex URL to use from this Mac. `/auth/pair` returns the deployment's own view of its address; a local
     * backend calls itself `127.0.0.1`, which another machine cannot reach, so there the host of the server just
     * talked to is used with the returned port.
     */
    public static func reachableConvexUrl(_ convexUrl: String, serverUrl: String) -> String {
        guard var convex = URLComponents(string: convexUrl), let server = URLComponents(string: serverUrl),
              let host = convex.host else { return convexUrl }
        if !loopbackHosts.contains(host) {
            var trimmed = convexUrl
            while trimmed.hasSuffix("/") { trimmed.removeLast() }
            return trimmed
        }
        convex.host = server.host
        convex.path = ""
        return convex.string ?? convexUrl
    }

    /// True when [url] names this machine, where plain HTTP is safe (a local backend).
    public static func isLoopback(_ url: String) -> Bool {
        URLComponents(string: url)?.host.map(loopbackHosts.contains) ?? false
    }
}
