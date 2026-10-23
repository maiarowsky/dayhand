import Foundation
@testable import DayhandCore

/**
 * A Helm server in memory, behind the same `HTTPTransport` the app uses: `/auth/pair`, `/auth/token`, and the app
 * functions over `/api/mutation` and `/api/query`, with the backend's rules that sync depends on (one now task,
 * `clientId` idempotency, the trash, `updatedAt`). It can go offline, lose an answer after applying a change, and
 * revoke the device. No network, no production.
 */
final class FakeServer: HTTPTransport, @unchecked Sendable {
    static let site = "https://fake.convex.site"
    static let cloud = "https://fake.convex.cloud"
    static let pairingCode = "E6M8-FE02-XSNT"
    static let deviceToken = "helmdev_fake.secret"

    private let lock = NSLock()
    private var tasks: [String: JSONValue] = [:]
    private var order: [String] = []
    private var seenClientIds: [String: JSONValue] = [:]
    private var nextId = 1
    private var nextJwt = 1
    private var validJwts: Set<String> = []
    private(set) var settings: JSONValue = ["timezone": "Europe/London", "summaryTime": "05:00", "defaultReminderMinutes": [0]]

    var clock: @Sendable () -> Int64 = { 1_800_000_000_000 }
    var offline = false
    var revoked = false
    /// The next mutation is applied but its answer never arrives (a dropped connection).
    var loseNextAnswer = false
    /// The next mutation is refused with a 503 before it runs (a server hiccup).
    var failNextMutation = false
    private(set) var requests: [(path: String, bearer: String?, body: JSONValue)] = []

    func post(_ url: URL, json: Data, bearer: String?) async throws -> HTTPReply {
        try lock.locked {
            let body = JSONValue.decode(json) ?? .null
            requests.append((url.path, bearer, body))
            if offline { throw URLError(.notConnectedToInternet) }
            switch url.path {
            case "/auth/pair": return pair(body)
            case "/auth/token": return token(body)
            case "/api/mutation", "/api/query":
                guard let bearer, validJwts.contains(bearer) else {
                    return HTTPReply(status: Self.udfFailed, json: ["status": "error", "errorMessage": "Sign in required", "errorData": ["code": "unauthenticated"]])
                }
                if url.path == "/api/mutation", failNextMutation {
                    failNextMutation = false
                    return HTTPReply(status: 503, body: Data("busy".utf8))
                }
                let path = body["path"]?.string ?? ""
                let args = body["args"]?.array?.first ?? [:]
                let reply = url.path == "/api/query" ? query(path, args) : mutation(path, args)
                if url.path == "/api/mutation", loseNextAnswer {
                    loseNextAnswer = false
                    throw URLError(.networkConnectionLost)
                }
                return reply
            default:
                return HTTPReply(status: 404, body: Data("<html>Not found</html>".utf8))
            }
        }
    }

    static let udfFailed = 560

    // MARK: Test helpers

    /// A task added by someone else (an agent through MCP).
    @discardableResult
    func addElsewhere(_ title: String, dueDate: String? = nil) -> String {
        lock.locked {
            var args: [String: JSONValue] = ["title": .string(title)]
            if let dueDate { args["dueDate"] = .string(dueDate) }
            return add(.object(args))["id"]?.string ?? ""
        }
    }

    func editElsewhere(_ id: String, _ fields: [String: JSONValue]) {
        lock.locked { change(id) { task in for (key, value) in fields { task[key] = value } } }
    }

    var allTasks: [JSONValue] { lock.locked { order.compactMap { tasks[$0] } } }

    func task(titled title: String) -> JSONValue? { allTasks.first { $0["title"]?.string == title } }

    func mutationsSent() -> [String] {
        lock.locked { requests.filter { $0.path == "/api/mutation" }.compactMap { $0.body["path"]?.string } }
    }

    func expireTokens() { lock.locked { validJwts.removeAll() } }

    // MARK: Auth

    private func pair(_ body: JSONValue) -> HTTPReply {
        guard body["code"]?.string == Self.pairingCode else {
            return HTTPReply(status: 401, json: ["error": "invalid_grant", "error_description": "The code or token is not valid"])
        }
        return HTTPReply(status: 200, json: [
            "deviceId": "dev1", "deviceName": body["deviceName"] ?? "Phone", "deviceToken": .string(Self.deviceToken),
            "convexUrl": .string(Self.cloud),
        ])
    }

    private func token(_ body: JSONValue) -> HTTPReply {
        guard !revoked, body["deviceToken"]?.string == Self.deviceToken else {
            return HTTPReply(status: 401, json: ["error": "invalid_grant", "error_description": "The code or token is not valid"])
        }
        let jwt = "jwt-\(nextJwt)"
        nextJwt += 1
        validJwts.insert(jwt)
        return HTTPReply(status: 200, json: ["token": .string(jwt), "tokenType": "Bearer", "expiresIn": 3600, "expiresAt": .of(clock() + 3_600_000)])
    }

    // MARK: App functions

    private func success(_ value: JSONValue) -> HTTPReply { HTTPReply(status: 200, json: ["status": "success", "value": value]) }

    private func failure(_ message: String) -> HTTPReply {
        HTTPReply(status: Self.udfFailed, json: ["status": "error", "errorMessage": .string(message)])
    }

    private func query(_ path: String, _ args: JSONValue) -> HTTPReply {
        switch path {
        case "app:listAll": return success(.array(order.compactMap { tasks[$0] }.filter { $0["deletedAt"] == nil }))
        case "app:listTrash": return success(.array(order.compactMap { tasks[$0] }.filter { $0["deletedAt"] != nil }))
        case "app:getSettings": return success(settings)
        default: return failure("unknown query \(path)")
        }
    }

    private func mutation(_ path: String, _ args: JSONValue) -> HTTPReply {
        if let clientId = args["clientId"]?.string, let earlier = seenClientIds[clientId] { return success(earlier) }
        let value: JSONValue
        switch path {
        case "app:add":
            value = add(args)
        default:
            guard let id = args["taskId"]?.string, tasks[id] != nil else { return failure("Task not found") }
            if tasks[id]?["deletedAt"] != nil, path != "app:restore" { return failure("Task is in the trash") }
            switch path {
            case "app:update":
                change(id) { task in
                    for (key, field) in args.object ?? [:] where key != "taskId" && key != "clientId" {
                        task[key] = field.isNull ? nil : field
                    }
                }
            case "app:complete":
                change(id) { $0["status"] = "done"; $0["completedAt"] = .of(clock()); $0["isNow"] = false }
            case "app:setStatus":
                change(id) { task in
                    task["status"] = args["status"]
                    if args["status"]?.string != "doing" { task["isNow"] = false }
                    if args["status"]?.string != "done" { task["completedAt"] = nil }
                }
            case "app:setNow":
                for other in order where other != id { change(other, touch: tasks[other]?["isNow"]?.bool == true) { $0["isNow"] = false } }
                change(id) { $0["isNow"] = true; $0["status"] = "doing" }
            case "app:reschedule":
                change(id) { $0["dueDate"] = args["dueDate"] }
            case "app:archive":
                change(id) { $0["archivedAt"] = .of(clock()); $0["isNow"] = false }
            case "app:softDelete":
                change(id) { $0["deletedAt"] = .of(clock()); $0["isNow"] = false }
            case "app:restore":
                change(id) { task in if task["deletedAt"] != nil { task["deletedAt"] = nil } else { task["archivedAt"] = nil } }
            default:
                return failure("unknown mutation \(path)")
            }
            value = tasks[id] ?? .null
        }
        if let clientId = args["clientId"]?.string { seenClientIds[clientId] = value }
        return success(value)
    }

    private func add(_ args: JSONValue) -> JSONValue {
        let id = "srv\(nextId)"
        nextId += 1
        var task: [String: JSONValue] = [
            "id": .string(id), "ref": .of(nextId - 1), "title": args["title"] ?? "", "status": "todo", "isNow": false,
            "labels": [], "links": [], "checklist": [], "createdAt": .of(clock()), "updatedAt": .of(clock()),
        ]
        for key in ["note", "dueDate", "dueTime", "clientId"] { if let value = args[key] { task[key] = value } }
        tasks[id] = .object(task)
        order.append(id)
        return .object(task)
    }

    private func change(_ id: String, touch: Bool = true, _ edit: (inout [String: JSONValue]) -> Void) {
        guard var task = tasks[id]?.object else { return }
        edit(&task)
        if touch { task["updatedAt"] = .of(max(clock(), (task["updatedAt"]?.int64 ?? 0) + 1)) }
        tasks[id] = .object(task)
    }
}
