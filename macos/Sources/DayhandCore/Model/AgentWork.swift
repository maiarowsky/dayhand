import Foundation

/// One acceptance criterion of a task (`acceptanceItemValidator`): what "done" means, ticked when it is met.
public struct AcceptanceItem: Hashable, Sendable, Codable, Identifiable {
    public var id: String
    public var text: String
    public var met: Bool

    public init(id: String, text: String, met: Bool = false) {
        self.id = id
        self.text = text
        self.met = met
    }

    public static func parse(_ value: JSONValue) -> AcceptanceItem? {
        guard let id = value["id"]?.string, let text = value["text"]?.string else { return nil }
        return AcceptanceItem(id: id, text: text, met: value["met"]?.bool ?? false)
    }
}

/// One check behind a completion (`proofCheckValidator`), e.g. a test run, with its [result] `pass` or `fail`.
public struct ProofCheck: Hashable, Sendable, Codable {
    public var name: String
    public var result: String
    public var url: String?

    public init(name: String, result: String, url: String? = nil) {
        self.name = name
        self.result = result
        self.url = url
    }

    public var passed: Bool { result == "pass" }

    public static func parse(_ value: JSONValue) -> ProofCheck? {
        guard let name = value["name"]?.string, let result = value["result"]?.string else { return nil }
        return ProofCheck(name: name, result: result, url: value["url"]?.string)
    }
}

/// What the last `complete_task` was given to show the work is done (`proofValidator`).
public struct TaskProof: Hashable, Sendable, Codable {
    public var summary: String?
    public var links: [TaskLink]
    public var checks: [ProofCheck]

    public init(summary: String? = nil, links: [TaskLink] = [], checks: [ProofCheck] = []) {
        self.summary = summary
        self.links = links
        self.checks = checks
    }

    public var isEmpty: Bool { (summary ?? "").isEmpty && links.isEmpty && checks.isEmpty }

    /// A proof as the server sends it; anything that is not an object is nil.
    public static func parse(_ value: JSONValue?) -> TaskProof? {
        guard let o = value, o.object != nil else { return nil }
        return TaskProof(
            summary: o["summary"]?.string,
            links: o["links"]?.array?.compactMap(TaskLink.parse) ?? [],
            checks: o["checks"]?.array?.compactMap(ProofCheck.parse) ?? []
        )
    }
}
