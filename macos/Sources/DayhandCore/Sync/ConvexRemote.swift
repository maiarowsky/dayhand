import Foundation

/// Sends one mutation of the outbox.
public protocol MutationSender: Sendable {
    func send(mutation: String, args: JSONValue) async -> SendResult
}

/// Reads the whole plan for the merge.
public protocol SnapshotSource: Sendable {
    func snapshot() async -> Result<Snapshot, FeedError>
}

public enum FeedError: Error, Hashable, Sendable {
    case unauthorized
    case failed(String)
}

/**
 * The Convex HTTP API (`POST /api/mutation`, `/api/query`), the same calls the Android app's `HttpTaskRemote` and the
 * official `ConvexHttpClient` make. A function that failed answers 560 with `{status: "error"}`. The app JWT comes
 * from [tokens]; a refused one is refreshed and the call tried once more. Live updates come from polling
 * [snapshot]: `listAll`, `listTrash` and `getSettings`.
 */
public struct ConvexRemote: MutationSender, SnapshotSource {
    public static let udfFailed = 560

    let deploymentUrl: String
    let tokens: AppTokens
    let transport: HTTPTransport

    public init(deploymentUrl: String, tokens: AppTokens, transport: HTTPTransport = URLSessionTransport()) {
        var url = deploymentUrl
        while url.hasSuffix("/") { url.removeLast() }
        self.deploymentUrl = url
        self.tokens = tokens
        self.transport = transport
    }

    public func send(mutation: String, args: JSONValue) async -> SendResult {
        await call("/api/mutation", path: mutation, args: args)
    }

    public func query(_ path: String, args: JSONValue = [:]) async -> SendResult {
        await call("/api/query", path: path, args: args)
    }

    public func snapshot() async -> Result<Snapshot, FeedError> {
        let tasks = await query(RemoteJSON.queryTasks, args: RemoteJSON.tasksArgs)
        guard case .applied(let taskList) = tasks else { return .failure(Self.feedError(tasks)) }
        let trash = await query(RemoteJSON.queryTrash)
        guard case .applied(let trashList) = trash else { return .failure(Self.feedError(trash)) }
        let settings = await query(RemoteJSON.querySettings)
        guard case .applied(let settingsValue) = settings else { return .failure(Self.feedError(settings)) }
        return .success(RemoteJSON.snapshot(tasks: taskList, trash: trashList, settings: settingsValue))
    }

    private func call(_ endpoint: String, path: String, args: JSONValue) async -> SendResult {
        guard let url = URL(string: deploymentUrl + endpoint) else { return .failed("bad address") }
        let body = Data(Self.requestBody(path: path, args: args).utf8)
        let first = await tokens.token(forceRefresh: false)
        guard case .issued(let firstToken, _) = first else { return Self.asSendResult(first) }
        let result = await post(url, body, firstToken)
        guard result == .unauthorized else { return result }
        // The JWT may have expired early (clock skew) or been rotated: one more try with a new one.
        let second = await tokens.token(forceRefresh: true)
        guard case .issued(let secondToken, _) = second, secondToken != firstToken else { return result }
        return await post(url, body, secondToken)
    }

    private func post(_ url: URL, _ body: Data, _ token: String) async -> SendResult {
        do {
            return Self.classify(try await transport.post(url, json: body, bearer: token))
        } catch {
            return .failed(PairingAPI.reason(error))
        }
    }

    public static func requestBody(path: String, args: JSONValue) -> String {
        JSONValue.object(["path": .string(path), "format": "convex_encoded_json", "args": [args]]).encoded()
    }

    /**
     * Only a function that ran and refused the change is final. Anything else (no answer, 5xx, a wrong address
     * answering 404) keeps the change for a later try, so a misconfigured server never throws away the user's work.
     */
    public static func classify(_ reply: HTTPReply) -> SendResult {
        if reply.status == 401 || reply.status == 403 { return .unauthorized }
        guard reply.status == 200 || reply.status == udfFailed else { return .failed("HTTP \(reply.status)") }
        guard let body = JSONValue.decode(reply.body), body.object != nil else { return .failed("unreadable answer") }
        switch body["status"]?.string {
        case "success":
            return .applied(body["value"] ?? .object([:]))
        case "error":
            if RemoteJSON.errorCode(body["errorData"]) == "unauthenticated" { return .unauthorized }
            return .rejected(body["errorMessage"]?.string ?? "error")
        default:
            return .failed("unexpected answer")
        }
    }

    private static func asSendResult(_ token: TokenResult) -> SendResult {
        switch token {
        case .revoked: return .unauthorized
        case .unavailable(let reason): return .failed(reason)
        case .issued: return .failed("unexpected")
        }
    }

    private static func feedError(_ result: SendResult) -> FeedError {
        switch result {
        case .unauthorized: return .unauthorized
        case .rejected(let message), .failed(let message): return .failed(message)
        case .applied: return .failed("unexpected")
        }
    }
}
