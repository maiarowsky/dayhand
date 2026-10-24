import Foundation

public enum PairResult: Hashable, Sendable {
    case paired(deviceId: String, deviceName: String, deviceToken: String, convexUrl: String)
    /// Wrong, expired, used or burned code: the server gives the same answer for all of them.
    case invalidCode
    /// Too many failed attempts on this server; codes are not checked for that many seconds.
    case rateLimited(retryAfterSeconds: Int?)
    /// No answer at all (no route, timeout, TLS failure).
    case unreachable(String)
    /// Something answered, but not a Dayhand server (404, HTML, another JSON).
    case notDayhand
    /// A Dayhand server with a problem of its own (5xx, 400).
    case serverError(Int)
}

public enum TokenResult: Hashable, Sendable {
    /// An app JWT valid until [expiresAt] (Unix ms).
    case issued(token: String, expiresAt: Int64)
    /// The device was revoked or its token is corrupt: drop it and pair again.
    case revoked
    /// No network, timeout or `503 not_configured`: keep the device token and try later.
    case unavailable(String)
}

/**
 * `POST /auth/pair` and `POST /auth/token` on the server's HTTP actions URL (docs/pairing.md). The device token is a
 * secret: it is never logged, and failures carry only a status or an error kind.
 */
public struct PairingAPI: Sendable {
    let transport: HTTPTransport

    public init(transport: HTTPTransport = URLSessionTransport()) {
        self.transport = transport
    }

    public func pair(serverUrl: String, code: String, deviceName: String) async -> PairResult {
        guard let url = URL(string: serverUrl + "/auth/pair") else { return .notDayhand }
        let body: JSONValue = ["code": .string(code), "deviceName": .string(deviceName)]
        let reply: HTTPReply
        do {
            reply = try await transport.post(url, json: Data(body.encoded().utf8), bearer: nil)
        } catch {
            return .unreachable(Self.reason(error))
        }
        let answer = JSONValue.decode(reply.body)
        switch reply.status {
        case 200:
            guard let id = answer?["deviceId"]?.string, let name = answer?["deviceName"]?.string,
                  let token = answer?["deviceToken"]?.string, let convexUrl = answer?["convexUrl"]?.string else { return .notDayhand }
            return .paired(deviceId: id, deviceName: name, deviceToken: token, convexUrl: convexUrl)
        case 401:
            return answer?["error"]?.string == "invalid_grant" ? .invalidCode : .notDayhand
        case 429:
            return .rateLimited(retryAfterSeconds: reply.retryAfter.flatMap { Int($0.trimmingCharacters(in: .whitespaces)) })
        case 400:
            return answer?["error"]?.string != nil ? .serverError(400) : .notDayhand
        case 500...599:
            return .serverError(reply.status)
        default:
            return .notDayhand
        }
    }

    public func token(serverUrl: String, deviceToken: String) async -> TokenResult {
        guard let url = URL(string: serverUrl + "/auth/token") else { return .unavailable("bad address") }
        let body: JSONValue = ["deviceToken": .string(deviceToken)]
        let reply: HTTPReply
        do {
            reply = try await transport.post(url, json: Data(body.encoded().utf8), bearer: nil)
        } catch {
            return .unavailable(Self.reason(error))
        }
        let answer = JSONValue.decode(reply.body)
        // Only the server's own "not valid" ends the pairing; a proxy's 401 or a wrong address must not.
        if reply.status == 401, answer?["error"]?.string == "invalid_grant" { return .revoked }
        guard reply.status == 200 else { return .unavailable("HTTP \(reply.status)") }
        guard let token = answer?["token"]?.string else { return .unavailable("no token") }
        guard let expiresAt = answer?["expiresAt"]?.int64 else { return .unavailable("no expiry") }
        return .issued(token: token, expiresAt: expiresAt)
    }

    /// The kind of a network failure, never its text (which could hold the address or a body).
    static func reason(_ error: Error) -> String {
        if let urlError = error as? URLError { return "URLError \(urlError.code.rawValue)" }
        return String(describing: type(of: error))
    }
}

/// Where the app JWT for the HTTP API comes from.
public protocol AppTokens: Sendable {
    /// A token to send now. [forceRefresh] asks for a new one even when the cached one still looks valid.
    func token(forceRefresh: Bool) async -> TokenResult
}

/// A fixed token (tests, scripts); it cannot be refreshed.
public struct StaticTokens: AppTokens {
    let value: String

    public init(_ value: String) {
        self.value = value
    }

    public func token(forceRefresh: Bool) async -> TokenResult { .issued(token: value, expiresAt: .max) }
}

/**
 * App JWTs (1 hour) for a paired Mac, from `POST /auth/token`, as the Android app's `DeviceTokens`. One instance is
 * shared by the poll and the outbox. The JWT is kept in memory only and fetched again when less than five minutes
 * are left. `401 invalid_grant` means the device was revoked: [onRevoked] drops the pairing. Network errors and
 * `503` keep the device token; a cached JWT that is still valid is used meanwhile.
 */
public actor DeviceTokens: AppTokens {
    /// Refresh when less than 5 minutes are left (docs/pairing.md).
    public static let refreshMarginMs: Int64 = 5 * 60 * 1000
    /// A cached token this close to its end is not worth sending when a refresh failed.
    static let stillUsableMs: Int64 = 30 * 1000

    private let serverUrl: String
    private let deviceToken: String
    private let api: PairingAPI
    private let onRevoked: @Sendable () async -> Void
    private let clock: @Sendable () -> Int64
    private var cached: (token: String, expiresAt: Int64)?
    private var inFlight: Task<TokenResult, Never>?

    public init(
        serverUrl: String, deviceToken: String, api: PairingAPI, onRevoked: @escaping @Sendable () async -> Void,
        clock: @escaping @Sendable () -> Int64 = Clock.nowMs
    ) {
        self.serverUrl = serverUrl
        self.deviceToken = deviceToken
        self.api = api
        self.onRevoked = onRevoked
        self.clock = clock
    }

    public func token(forceRefresh: Bool) async -> TokenResult {
        let now = clock()
        if !forceRefresh, let current = cached, current.expiresAt - now > Self.refreshMarginMs {
            return .issued(token: current.token, expiresAt: current.expiresAt)
        }
        // Callers arriving while a request is out share its answer instead of asking again.
        let request: Task<TokenResult, Never>
        if let inFlight {
            request = inFlight
        } else {
            let (api, serverUrl, deviceToken) = (api, serverUrl, deviceToken)
            request = Task { await api.token(serverUrl: serverUrl, deviceToken: deviceToken) }
            inFlight = request
        }
        let fresh = await request.value
        if inFlight == request { inFlight = nil }
        switch fresh {
        case .issued(let token, let expiresAt):
            cached = (token, expiresAt)
            return fresh
        case .revoked:
            cached = nil
            await onRevoked()
            return fresh
        case .unavailable:
            if let current = cached, current.expiresAt - clock() > Self.stillUsableMs {
                return .issued(token: current.token, expiresAt: current.expiresAt)
            }
            return fresh
        }
    }
}

/// Wall-clock time in Unix milliseconds, as the server counts.
public enum Clock {
    @Sendable public static func nowMs() -> Int64 { Int64((Date().timeIntervalSince1970 * 1000).rounded()) }
}
