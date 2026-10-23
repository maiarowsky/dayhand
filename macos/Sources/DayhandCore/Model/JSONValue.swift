import Foundation

/**
 * Any JSON value. Mutation arguments are built from it and server answers are read through it, so a field the
 * server adds later or a number sent as `1.0` never breaks decoding.
 */
public enum JSONValue: Hashable, Sendable, Codable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .null
        } else if let b = try? c.decode(Bool.self) {
            self = .bool(b)
        } else if let n = try? c.decode(Double.self) {
            self = .number(n)
        } else if let s = try? c.decode(String.self) {
            self = .string(s)
        } else if let a = try? c.decode([JSONValue].self) {
            self = .array(a)
        } else {
            self = .object(try c.decode([String: JSONValue].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n):
            // Whole numbers go out without a fraction, as JavaScript writes them.
            if n.rounded() == n, abs(n) < 9_007_199_254_740_992 { try c.encode(Int64(n)) } else { try c.encode(n) }
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    public subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    public var string: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    public var double: Double? {
        if case .number(let n) = self { return n }
        return nil
    }

    /// A whole number (sent as `1` or `1.0`), or nil.
    public var int: Int? {
        guard case .number(let n) = self, n.rounded() == n, abs(n) < 9_007_199_254_740_992 else { return nil }
        return Int(n)
    }

    public var int64: Int64? {
        guard case .number(let n) = self, n.isFinite else { return nil }
        return Int64(n)
    }

    public var bool: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    public var array: [JSONValue]? {
        if case .array(let a) = self { return a }
        return nil
    }

    public var object: [String: JSONValue]? {
        if case .object(let o) = self { return o }
        return nil
    }

    public var isNull: Bool { self == .null }

    /// Compact JSON with sorted keys, so equal values give equal text.
    public func encoded() -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        // Encoding a JSONValue cannot fail: every case maps to plain JSON.
        return (try? String(decoding: encoder.encode(self), as: UTF8.self)) ?? "null"
    }

    public static func decode(_ text: String) -> JSONValue? {
        try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    }

    public static func decode(_ data: Data) -> JSONValue? {
        try? JSONDecoder().decode(JSONValue.self, from: data)
    }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByBooleanLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral, ExpressibleByNilLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, JSONValue)...) {
        self = .object(Dictionary(elements, uniquingKeysWith: { _, last in last }))
    }
    public init(nilLiteral: ()) { self = .null }
}

extension JSONValue {
    public static func of(_ value: String?) -> JSONValue { value.map(JSONValue.string) ?? .null }
    public static func of(_ value: Int) -> JSONValue { .number(Double(value)) }
    public static func of(_ value: Int64) -> JSONValue { .number(Double(value)) }
}
