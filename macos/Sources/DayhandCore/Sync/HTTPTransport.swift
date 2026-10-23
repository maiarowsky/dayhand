import Foundation

public struct HTTPReply: Hashable, Sendable {
    public let status: Int
    public let body: Data
    /// `Retry-After` of a 429, the only header the app reads.
    public let retryAfter: String?

    public init(status: Int, body: Data, retryAfter: String? = nil) {
        self.status = status
        self.body = body
        self.retryAfter = retryAfter
    }

    public init(status: Int, json: JSONValue, retryAfter: String? = nil) {
        self.init(status: status, body: Data(json.encoded().utf8), retryAfter: retryAfter)
    }
}

/// POSTs JSON; throws when there is no answer at all (no route, timeout, TLS failure). Tests replace it.
public protocol HTTPTransport: Sendable {
    func post(_ url: URL, json: Data, bearer: String?) async throws -> HTTPReply
}

/**
 * [HTTPTransport] on an ephemeral `URLSession` (no cookies, no cache, nothing written to disk) with a fixed timeout,
 * so a dead network fails fast. Redirects are not followed: a secret is never sent on to another address.
 */
public final class URLSessionTransport: HTTPTransport {
    public static let timeout: TimeInterval = 15

    private let session: URLSession

    public init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = URLSessionTransport.timeout
        configuration.timeoutIntervalForResource = URLSessionTransport.timeout * 2
        configuration.waitsForConnectivity = false
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        session = URLSession(configuration: configuration)
    }

    public func post(_ url: URL, json: Data, bearer: String?) async throws -> HTTPReply {
        var request = URLRequest(url: url, timeoutInterval: URLSessionTransport.timeout)
        request.httpMethod = "POST"
        request.httpBody = json
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await session.data(for: request, delegate: NoRedirects.shared)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return HTTPReply(status: http.statusCode, body: data, retryAfter: http.value(forHTTPHeaderField: "Retry-After"))
    }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    static let shared = NoRedirects()

    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? {
        nil
    }
}
