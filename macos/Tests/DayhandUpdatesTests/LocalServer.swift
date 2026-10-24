import Foundation
import Network

/**
 * A tiny HTTP/1.1 server on 127.0.0.1 and a free port, for serving a test appcast and update archive to Sparkle.
 * Each answer closes its connection. A route can promise more bytes than it sends (`truncateAt`), which breaks the
 * download the way a dropped connection does. Nothing outside this Mac is reached.
 */
final class LocalServer: @unchecked Sendable {
    struct Route {
        var status = 200
        var body: Data
        var contentType = "application/octet-stream"
        var truncateAt: Int?
    }

    private let listener: NWListener
    private let queue = DispatchQueue(label: "LocalServer")
    private let lock = NSLock()
    private var routes: [String: Route] = [:]
    private var paths: [String] = []

    init() throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: parameters)
        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { state in
            if case .ready = state { ready.signal() }
        }
        listener.newConnectionHandler = { [weak self] connection in self?.serve(connection) }
        listener.start(queue: queue)
        guard ready.wait(timeout: .now() + 5) == .success else { throw URLError(.cannotConnectToHost) }
    }

    deinit { listener.cancel() }

    var port: UInt16 { listener.port?.rawValue ?? 0 }

    func url(_ path: String) -> URL {
        URL(string: "http://127.0.0.1:\(port)\(path)")!
    }

    func set(_ path: String, _ route: Route) {
        lock.lock()
        routes[path] = route
        lock.unlock()
    }

    /// The paths asked for so far, in order.
    var requested: [String] {
        lock.lock()
        defer { lock.unlock() }
        return paths
    }

    private func serve(_ connection: NWConnection) {
        connection.start(queue: queue)
        receiveRequest(connection, buffer: Data())
    }

    private func receiveRequest(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, done, error in
            guard let self else { return }
            var buffer = buffer
            if let data { buffer.append(data) }
            if buffer.range(of: Data("\r\n\r\n".utf8)) != nil {
                self.answer(connection, request: buffer)
            } else if done || error != nil {
                connection.cancel()
            } else {
                self.receiveRequest(connection, buffer: buffer)
            }
        }
    }

    private func answer(_ connection: NWConnection, request: Data) {
        let line = String(decoding: request.prefix { $0 != 13 }, as: UTF8.self).split(separator: " ")
        let path = line.count > 1 ? String(line[1].split(separator: "?").first ?? "") : ""
        lock.lock()
        paths.append(path)
        let route = routes[path] ?? Route(status: 404, body: Data("not found".utf8), contentType: "text/plain")
        lock.unlock()
        var head = "HTTP/1.1 \(route.status) \(route.status == 200 ? "OK" : "Error")\r\n"
        head += "Content-Type: \(route.contentType)\r\nContent-Length: \(route.body.count)\r\nConnection: close\r\n\r\n"
        var payload = Data(head.utf8)
        payload.append(route.truncateAt.map { route.body.prefix($0) } ?? route.body)
        connection.send(content: payload, completion: .contentProcessed { _ in connection.cancel() })
    }
}
