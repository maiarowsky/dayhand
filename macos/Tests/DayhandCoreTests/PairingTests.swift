import Foundation
import Testing
@testable import DayhandCore

/// The Android app's `PairingInputTest`, plus the `dayhand://pair` link of the new name.
struct PairingInputTests {
    @Test func codesAreReadLikeTheBackendReadsThem() {
        #expect(PairingInput.normalizeCode("E6M8-FE02-XSNT") == "E6M8-FE02-XSNT")
        #expect(PairingInput.normalizeCode(" e6m8 fe02 xsnt ") == "E6M8-FE02-XSNT")
        #expect(PairingInput.normalizeCode("e6m8fe02xsnt") == "E6M8-FE02-XSNT")
        // O is read as 0, I and L as 1.
        #expect(PairingInput.normalizeCode("ilOo-abcd-efgh") == "1100-ABCD-EFGH")
    }

    @Test func codesOfTheWrongLengthOrOutsideTheAlphabetAreRefused() {
        for code in ["E6M8-FE02-XSN", "E6M8-FE02-XSNTT", "E6M8-FE02-XSNU", "E6M8_FE02_XSNT", ""] {
            #expect(PairingInput.normalizeCode(code) == nil, "\(code)")
        }
    }

    @Test func serverAddressesAreTrimmedAndACloudAddressBecomesItsHTTPActionsAddress() {
        #expect(PairingInput.normalizeServerUrl(" https://impressive-grouse-796.eu-west-1.convex.site/ ") == "https://impressive-grouse-796.eu-west-1.convex.site")
        #expect(PairingInput.normalizeServerUrl("https://happy-otter-123.convex.cloud") == "https://happy-otter-123.convex.site")
        #expect(PairingInput.normalizeServerUrl("http://127.0.0.1:3211") == "http://127.0.0.1:3211")
    }

    @Test func onlyHttpAndHttpsAddressesWithAHostAndNoPathAreAccepted() {
        for address in ["10.0.2.2:3211", "ftp://example.com", "https://", "http://exa mple.com", "https://example.convex.site/auth/pair"] {
            #expect(PairingInput.normalizeServerUrl(address) == nil, "\(address)")
        }
    }

    @Test func aPairingLinkGivesTheServerAndTheCode() {
        let link = PairingInput.parseLink("helm://pair?url=https%3A%2F%2Fimpressive-grouse-796.eu-west-1.convex.site&code=E6M8-FE02-XSNT")
        #expect(link == PairingLink(serverUrl: "https://impressive-grouse-796.eu-west-1.convex.site", code: "E6M8-FE02-XSNT"))
        #expect(PairingInput.parseLink("helm://pair?url=http://127.0.0.1:3211") == PairingLink(serverUrl: "http://127.0.0.1:3211", code: nil))
    }

    @Test func theDayhandSchemeIsTheSameLink() {
        let link = PairingInput.parseLink("dayhand://pair?url=http%3A%2F%2F127.0.0.1%3A3211&code=e6m8fe02xsnt")
        #expect(link == PairingLink(serverUrl: "http://127.0.0.1:3211", code: "E6M8-FE02-XSNT"))
    }

    @Test func otherLinksAreNotPairingLinks() {
        #expect(PairingInput.parseLink("https://example.com/pair?code=E6M8-FE02-XSNT") == nil)
        #expect(PairingInput.parseLink("helm://task?id=1") == nil)
        #expect(PairingInput.parseLink("not a link") == nil)
    }

    @Test func aLocalBackendsLoopbackAddressIsReplacedByTheHostThatWasReached() {
        #expect(PairingInput.reachableConvexUrl("http://127.0.0.1:3210", serverUrl: "http://127.0.0.1:3211") == "http://127.0.0.1:3210")
        #expect(PairingInput.reachableConvexUrl("http://localhost:3210", serverUrl: "http://192.168.1.20:3211") == "http://192.168.1.20:3210")
        #expect(PairingInput.reachableConvexUrl("https://grouse.eu-west-1.convex.cloud", serverUrl: "https://grouse.eu-west-1.convex.site") == "https://grouse.eu-west-1.convex.cloud")
    }

    @Test func theDeviceNameIsTrimmedAndBounded() {
        #expect(DevicePairing.label("  MacBook ") == "MacBook")
        #expect(DevicePairing.label("   ") == "Mac")
        #expect(DevicePairing.label(String(repeating: "x", count: 150)).count == 100)
    }
}

/// A transport that answers from a list, for the replies the fake server does not produce.
final class ScriptedTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var replies: [Result<HTTPReply, URLError>]
    private(set) var calls = 0

    init(_ replies: [Result<HTTPReply, URLError>]) {
        self.replies = replies
    }

    func post(_ url: URL, json: Data, bearer: String?) async throws -> HTTPReply {
        try lock.locked {
            calls += 1
            return try replies.removeFirst().get()
        }
    }
}

struct PairingAPITests {
    func pair(_ reply: Result<HTTPReply, URLError>) async -> PairResult {
        await PairingAPI(transport: ScriptedTransport([reply])).pair(serverUrl: "https://x", code: "E6M8-FE02-XSNT", deviceName: "Mac")
    }

    @Test func everyAnswerOfPairIsToldApart() async {
        #expect(await pair(.success(HTTPReply(status: 200, json: ["deviceId": "d", "deviceName": "Mac", "deviceToken": "t", "convexUrl": "https://c"])))
            == .paired(deviceId: "d", deviceName: "Mac", deviceToken: "t", convexUrl: "https://c"))
        #expect(await pair(.success(HTTPReply(status: 401, json: ["error": "invalid_grant"]))) == .invalidCode)
        #expect(await pair(.success(HTTPReply(status: 429, json: ["error": "rate_limited"], retryAfter: " 120 "))) == .rateLimited(retryAfterSeconds: 120))
        #expect(await pair(.success(HTTPReply(status: 400, json: ["error": "invalid_request"]))) == .serverError(400))
        #expect(await pair(.success(HTTPReply(status: 503, json: ["error": "x"]))) == .serverError(503))
        #expect(await pair(.success(HTTPReply(status: 404, body: Data("<html>".utf8)))) == .notHelm)
        #expect(await pair(.success(HTTPReply(status: 401, body: Data("proxy says no".utf8)))) == .notHelm)
        #expect(await pair(.success(HTTPReply(status: 200, json: ["something": "else"]))) == .notHelm)
        #expect(await pair(.failure(URLError(.cannotConnectToHost))) == .unreachable("URLError \(URLError.cannotConnectToHost.rawValue)"))
    }

    @Test func onlyTheServersOwnNotValidEndsThePairing() async {
        func token(_ reply: HTTPReply) async -> TokenResult {
            await PairingAPI(transport: ScriptedTransport([.success(reply)])).token(serverUrl: "https://x", deviceToken: "t")
        }
        #expect(await token(HTTPReply(status: 200, json: ["token": "jwt", "expiresAt": 1_792_691_766_000])) == .issued(token: "jwt", expiresAt: 1_792_691_766_000))
        #expect(await token(HTTPReply(status: 401, json: ["error": "invalid_grant"])) == .revoked)
        #expect(await token(HTTPReply(status: 401, body: Data())) == .unavailable("HTTP 401"))
        #expect(await token(HTTPReply(status: 503, json: ["error": "not_configured"])) == .unavailable("HTTP 503"))
        #expect(await token(HTTPReply(status: 200, json: ["token": "jwt"])) == .unavailable("no expiry"))
    }

    @Test func connectStoresNothingUnlessTheServerAcceptedTheCode() async throws {
        let server = FakeServer()
        let store = MemoryCredentialStore()
        let pairing = DevicePairing(api: PairingAPI(transport: server), store: store)
        #expect(await pairing.connect(address: "nonsense", code: FakeServer.pairingCode, deviceName: "Mac") == .failure(.badAddress))
        #expect(await pairing.connect(address: FakeServer.site, code: "short", deviceName: "Mac") == .failure(.badCode))
        #expect(await pairing.connect(address: FakeServer.site, code: "AAAA-AAAA-AAAA", deviceName: "Mac") == .failure(.invalidCode))
        #expect(try store.load() == nil)
        let result = await pairing.connect(address: FakeServer.site + "/", code: "e6m8 fe02 xsnt", deviceName: "MacBook")
        let credential = try result.get()
        #expect(credential == DeviceCredential(
            serverUrl: FakeServer.site, convexUrl: FakeServer.cloud, deviceId: "dev1", deviceName: "MacBook", deviceToken: FakeServer.deviceToken
        ))
        #expect(try store.load() == credential)
    }
}

/// The Android app's `DeviceTokensTest`: the JWT is reused, refreshed five minutes early and dropped when revoked.
struct DeviceTokensTests {
    static let hour: Int64 = 3_600_000

    func issued(_ token: String, _ expiresAt: Int64) -> Result<HTTPReply, URLError> {
        .success(HTTPReply(status: 200, json: ["token": .string(token), "expiresAt": .of(expiresAt)]))
    }

    @Test func aTokenIsReusedUntilFiveMinutesBeforeItEnds() async {
        let clock = TestClock(1_000_000)
        let transport = ScriptedTransport([issued("t1", clock.now + Self.hour), issued("t2", clock.now + 2 * Self.hour)])
        let tokens = DeviceTokens(serverUrl: "https://x", deviceToken: "d", api: PairingAPI(transport: transport), onRevoked: {}, clock: { clock.now })
        #expect(await tokens.token(forceRefresh: false) == .issued(token: "t1", expiresAt: 1_000_000 + Self.hour))
        clock.advance(Self.hour - DeviceTokens.refreshMarginMs - 1000)
        if case .issued(let token, _) = await tokens.token(forceRefresh: false) { #expect(token == "t1") } else { Issue.record("no token") }
        #expect(transport.calls == 1)
        clock.advance(2000)
        if case .issued(let token, _) = await tokens.token(forceRefresh: false) { #expect(token == "t2") } else { Issue.record("no token") }
        #expect(transport.calls == 2)
    }

    @Test func withoutTheServerACachedTokenThatIsStillValidIsUsed() async {
        let clock = TestClock(1_000_000)
        let transport = ScriptedTransport([issued("t1", clock.now + Self.hour), .success(HTTPReply(status: 503, json: ["error": "not_configured"]))])
        let revoked = Counter()
        let tokens = DeviceTokens(serverUrl: "https://x", deviceToken: "d", api: PairingAPI(transport: transport), onRevoked: { revoked.increment() }, clock: { clock.now })
        _ = await tokens.token(forceRefresh: false)
        if case .issued(let token, _) = await tokens.token(forceRefresh: true) { #expect(token == "t1") } else { Issue.record("no token") }
        #expect(revoked.value == 0)
    }

    @Test func aRevokedDeviceIsDroppedOnce() async {
        let transport = ScriptedTransport([.success(HTTPReply(status: 401, json: ["error": "invalid_grant"]))])
        let revoked = Counter()
        let tokens = DeviceTokens(serverUrl: "https://x", deviceToken: "d", api: PairingAPI(transport: transport), onRevoked: { revoked.increment() })
        #expect(await tokens.token(forceRefresh: false) == .revoked)
        #expect(revoked.value == 1)
    }
}

final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    var value: Int { lock.locked { count } }
    func increment() { lock.locked { count += 1 } }
}
