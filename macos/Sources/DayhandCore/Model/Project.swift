import Foundation

/// A project's color: a named token, as the backend spells it (`PROJECT_COLORS` in `convex/lib/validators.ts`). Each
/// app maps the token to a shade that reads well in its light and dark appearance; no token is a neutral outline.
public enum ProjectColor: String, Sendable, Codable, CaseIterable {
    case red, orange, amber, green, teal, cyan, blue, indigo, purple, pink, brown, gray
}

/**
 * A project as the screens see it (backend 0.13.0, `convex/lib/projectOps.ts`): a flat list in the order of
 * [position], with an archive. A task is in at most one project; labels stay free tags across projects.
 *
 * [localId] is stable from the moment the project exists on this Mac: the `clientId` of the `addProject` mutation for
 * projects made here, the server id for projects made elsewhere, as a task's.
 */
public struct Project: Hashable, Sendable, Identifiable {
    public var localId: String
    public var serverId: String?
    public var clientId: String?
    public var name: String
    public var color: ProjectColor?
    /// One emoji shown instead of the color dot.
    public var icon: String?
    /// What the project is about, for people and agents.
    public var note: String?
    /// Place in the sidebar, lowest first.
    public var position: Double
    public var archivedAt: Int64?
    public var createdAt: Int64
    public var updatedAt: Int64
    /// `updatedAt` of the last server copy merged into this row; nil until the server has it.
    public var serverUpdatedAt: Int64?
    /// Deleted on this Mac; the row stays, hidden, until the server has the deletion, so the deletion can still name
    /// the project by its server id.
    public var removing: Bool

    public init(
        localId: String, serverId: String? = nil, clientId: String? = nil, name: String, color: ProjectColor? = nil,
        icon: String? = nil, note: String? = nil, position: Double, archivedAt: Int64? = nil, createdAt: Int64,
        updatedAt: Int64, serverUpdatedAt: Int64? = nil, removing: Bool = false
    ) {
        self.localId = localId
        self.serverId = serverId
        self.clientId = clientId
        self.name = name
        self.color = color
        self.icon = icon
        self.note = note
        self.position = position
        self.archivedAt = archivedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.serverUpdatedAt = serverUpdatedAt
        self.removing = removing
    }

    public var id: String { localId }

    public var isArchived: Bool { archivedAt != nil }

    /// The sidebar's order: by position, then by when the project was made (the backend's `by_user` index order).
    public static func menuOrder(_ a: Project, _ b: Project) -> Bool {
        if a.position != b.position { return a.position < b.position }
        return a.createdAt != b.createdAt ? a.createdAt < b.createdAt : a.localId < b.localId
    }
}

/// A project as the app layer returns it (`toProject` in `convex/lib/projectOps.ts`).
public struct RemoteProject: Hashable, Sendable {
    public var id: String
    public var clientId: String?
    public var name: String
    public var color: ProjectColor?
    public var icon: String?
    public var note: String?
    public var position: Double
    public var archivedAt: Int64?
    public var createdAt: Int64
    public var updatedAt: Int64

    public init(
        id: String, clientId: String? = nil, name: String, color: ProjectColor? = nil, icon: String? = nil,
        note: String? = nil, position: Double, archivedAt: Int64? = nil, createdAt: Int64, updatedAt: Int64
    ) {
        self.id = id
        self.clientId = clientId
        self.name = name
        self.color = color
        self.icon = icon
        self.note = note
        self.position = position
        self.archivedAt = archivedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/**
 * Whether the connected server has projects (backend 0.13.0 or later). Unknown until a snapshot has said so (no
 * server yet, or not reached yet): projects can then be made on this Mac and wait in the outbox. A server without
 * projects (0.12.x) leaves them waiting; changes about projects never reach it, and tasks keep everything else.
 */
public enum ProjectSupport: String, Hashable, Sendable {
    case unknown, supported, unsupported
}
