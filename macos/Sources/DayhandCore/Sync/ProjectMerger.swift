import Foundation

public struct ProjectMergePlan: Hashable, Sendable {
    public let upserts: [Project]
    public let deletes: [String]
}

/**
 * Merges the server's projects into the local rows. Projects are changed on the server directly (`SyncEngine`'s
 * project calls), never queued, so the server's copy always wins: a newer server copy replaces the row, and a project
 * missing from the server was deleted there and goes. Rows meet their server copy by server id or `clientId` only,
 * never by name.
 */
public enum ProjectMerger {
    public static func merge(local: [Project], remote: [RemoteProject]) -> ProjectMergePlan {
        var byServerId: [String: Project] = [:]
        var byClientId: [String: Project] = [:]
        for project in local {
            if let id = project.serverId { byServerId[id] = project }
            if let id = project.clientId { byClientId[id] = project }
        }
        var seen = Set<String>()
        var upserts: [Project] = []
        for r in remote {
            let row = byServerId[r.id] ?? r.clientId.flatMap { byClientId[$0] }
            if let row { seen.insert(row.localId) }
            if let row, row.serverId == r.id, let known = row.serverUpdatedAt, r.updatedAt <= known { continue }
            let merged = Self.row(row, r)
            if merged != row { upserts.append(merged) }
        }
        let deletes = local.filter { !seen.contains($0.localId) }.map(\.localId)
        return ProjectMergePlan(upserts: upserts, deletes: deletes)
    }

    /// The server's copy [r] as the row [existing] (which keeps its `localId`), or as a new row.
    static func row(_ existing: Project?, _ r: RemoteProject) -> Project {
        Project(
            localId: existing?.localId ?? r.clientId ?? r.id,
            serverId: r.id,
            clientId: r.clientId,
            name: r.name,
            color: r.color,
            icon: r.icon,
            note: r.note,
            position: r.position,
            archivedAt: r.archivedAt,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            serverUpdatedAt: r.updatedAt
        )
    }
}

/**
 * How a task's server `projectId` reads on this Mac: the `localId` of the project with that server id (the server id
 * itself for a project not merged yet, which is the `localId` it gets when it arrives).
 */
public struct ProjectMapping: Sendable {
    private var localIdByServerId: [String: String] = [:]

    /// The tasks keep their local project: the snapshot comes from a server without projects.
    let preservesLocalMembership: Bool

    public init(preservingLocalMembership: Bool = false) {
        preservesLocalMembership = preservingLocalMembership
    }

    public init(projects: [Project]) {
        preservesLocalMembership = false
        for project in projects {
            if let id = project.serverId { localIdByServerId[id] = project.localId }
        }
    }

    public func localId(_ serverId: String?) -> String? {
        serverId.map { localIdByServerId[$0] ?? $0 }
    }
}
