import Foundation
import Security

/// A paired Mac: the server, the Convex URL it gave, and the long-lived device token (a secret).
public struct DeviceCredential: Hashable, Sendable, Codable {
    /// The HTTP actions URL (`/auth/*`), e.g. `https://<name>.convex.site`.
    public var serverUrl: String
    /// The Convex URL for `/api/query` and `/api/mutation`, e.g. `https://<name>.convex.cloud`.
    public var convexUrl: String
    public var deviceId: String
    public var deviceName: String
    public var deviceToken: String

    public init(serverUrl: String, convexUrl: String, deviceId: String, deviceName: String, deviceToken: String) {
        self.serverUrl = serverUrl
        self.convexUrl = convexUrl
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.deviceToken = deviceToken
    }
}

/// Where the pairing is kept. The app uses the Keychain; tests use memory.
public protocol CredentialStore: Sendable {
    func load() throws -> DeviceCredential?
    func save(_ credential: DeviceCredential) throws
    func delete() throws
}

public enum CredentialError: Error, Hashable, Sendable {
    case keychain(OSStatus)
}

/**
 * The pairing in the login Keychain, as one generic password item: the device token never touches a file, a log or
 * `UserDefaults`. The app JWT is never stored at all (`DeviceTokens` keeps it in memory).
 */
public struct KeychainCredentialStore: CredentialStore {
    public static let defaultService = "io.github.maiarowsky.dayhand"

    let service: String
    let account: String

    public init(service: String = KeychainCredentialStore.defaultService, account: String = "device") {
        self.service = service
        self.account = account
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    public func load() throws -> DeviceCredential? {
        var item: CFTypeRef?
        var search = query
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        let status = SecItemCopyMatching(search as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw CredentialError.keychain(status) }
        // A damaged item reads as "not paired", never as a crash.
        return try? JSONDecoder().decode(DeviceCredential.self, from: data)
    }

    public func save(_ credential: DeviceCredential) throws {
        let data = try JSONEncoder().encode(credential)
        let update = [kSecValueData as String: data]
        var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrLabel as String] = "Dayhand server sign-in"
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw CredentialError.keychain(status) }
    }

    public func delete() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw CredentialError.keychain(status) }
    }
}

/// A store in memory (tests, previews).
public final class MemoryCredentialStore: CredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var value: DeviceCredential?

    public init(_ value: DeviceCredential? = nil) {
        self.value = value
    }

    public func load() throws -> DeviceCredential? { lock.locked { value } }
    public func save(_ credential: DeviceCredential) throws { lock.locked { value = credential } }
    public func delete() throws { lock.locked { value = nil } }
}

/// Why connecting failed, in the words the Connect screen uses.
public enum ConnectError: Error, Hashable, Sendable {
    case badAddress
    case badCode
    /// Wrong, expired, used or burned code (the server does not say which).
    case invalidCode
    case rateLimited(retryAfterSeconds: Int?)
    case unreachable
    case notDayhand
    case serverError
    case storage
}

/**
 * Pairs this Mac with a server: checks the input, exchanges the one-time code for a device token
 * (`POST /auth/pair`) and stores it. Nothing is stored unless the server accepted the code.
 */
public struct DevicePairing: Sendable {
    /// The backend accepts 1 to 100 characters (`deviceName` in docs/pairing.md).
    static let maxName = 100
    static let defaultName = "Mac"

    let api: PairingAPI
    let store: CredentialStore

    public init(api: PairingAPI, store: CredentialStore) {
        self.api = api
        self.store = store
    }

    public func connect(address: String, code: String, deviceName: String) async -> Result<DeviceCredential, ConnectError> {
        guard let serverUrl = PairingInput.normalizeServerUrl(address) else { return .failure(.badAddress) }
        guard let normalizedCode = PairingInput.normalizeCode(code) else { return .failure(.badCode) }
        switch await api.pair(serverUrl: serverUrl, code: normalizedCode, deviceName: Self.label(deviceName)) {
        case .paired(let deviceId, let name, let token, let convexUrl):
            let credential = DeviceCredential(
                serverUrl: serverUrl,
                convexUrl: PairingInput.reachableConvexUrl(convexUrl, serverUrl: serverUrl),
                deviceId: deviceId,
                deviceName: name,
                deviceToken: token
            )
            do {
                try store.save(credential)
            } catch {
                return .failure(.storage)
            }
            return .success(credential)
        case .invalidCode: return .failure(.invalidCode)
        case .rateLimited(let seconds): return .failure(.rateLimited(retryAfterSeconds: seconds))
        case .unreachable: return .failure(.unreachable)
        case .notDayhand: return .failure(.notDayhand)
        case .serverError: return .failure(.serverError)
        }
    }

    public static func label(_ name: String) -> String {
        var trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        // The server counts UTF-16 units, as JavaScript does.
        while trimmed.jsLength > maxName { trimmed.removeLast() }
        return trimmed.isEmpty ? defaultName : trimmed
    }
}
