import DayhandLocalization
import Foundation
import GRDB

/**
 * Projects (backend 0.13.0) on this Mac. Managing them is online only: `SyncEngine`'s project calls check a change
 * here, send it to the server at once and write the server's answer here (`ProjectCalls.swift`); nothing about a
 * project is queued. Moving a task into a project is a task change and is queued as any other, but only into a
 * project the server has.
 */
extension TaskRepository {
    // MARK: Reading

    /// The projects, archived ones included, in the sidebar's order.
    public func projects() async throws -> [Project] {
        try await writer.read { db in try Self.allProjects(db) }
    }

    public func observeProjects() -> AsyncValueObservation<[Project]> {
        ValueObservation.tracking { db in try Self.allProjects(db) }.values(in: writer)
    }

    public func observeProjectSupport() -> AsyncValueObservation<ProjectSupport> {
        ValueObservation.tracking { db in try Meta.projectSupport(db) }.values(in: writer)
    }

    static func allProjects(_ db: Database) throws -> [Project] {
        try Project.fetchAll(db).sorted(by: Project.menuOrder)
    }

    // MARK: Tasks in projects

    /// Moves a task into project [projectLocalId], which the server must have, or out of its project (nil).
    public func setProject(_ taskLocalId: String, _ projectLocalId: String?) async throws {
        let now = clock()
        let op = makeOp(Mutations.update, taskLocalId, ["projectId": projectLocalId.map(JSONValue.string) ?? .null], now: now)
        let changed = try await writer.write { db -> Bool in
            guard var task = try TaskItem.fetchOne(db, key: taskLocalId), task.projectLocalId != projectLocalId, !task.inTrash else { return false }
            if let projectLocalId { try Self.checkTarget(db, projectLocalId, current: task.projectLocalId) } else { try Self.requireProjects(db) }
            task.projectLocalId = projectLocalId
            task.updatedAt = now
            try task.save(db)
            var op = op
            try op.insert(db)
            return true
        }
        if changed { onOutboxChanged() }
    }

    // MARK: Checks

    /// Projects need a server that has them, or none known yet.
    static func requireProjects(_ db: Database) throws {
        if let requirement = try Meta.projectSupport(db).requirement {
            throw RepositoryError.invalid(requirement)
        }
    }

    /**
     * A task can go into [localId]: the server has it and it is not archived, unless the task is in it already
     * ([current]). Returns its server id.
     */
    @discardableResult
    static func checkTarget(_ db: Database, _ localId: String, current: String? = nil) throws -> String {
        try requireProjects(db)
        guard let project = try Project.fetchOne(db, key: localId) else {
            throw RepositoryError.invalid(tr("That project no longer exists."))
        }
        let serverId = try confirmed(project)
        if project.isArchived, localId != current {
            throw RepositoryError.invalid(tr("“\(project.name)” is archived; restore it first."))
        }
        return serverId
    }

    /// The server id of [project]; every project here has one, so a project without it is refused.
    static func confirmed(_ project: Project) throws -> String {
        guard let serverId = project.serverId else { throw RepositoryError.invalid(tr("That project is not on the server yet.")) }
        return serverId
    }

    // MARK: Project calls (online only, `SyncEngine`)

    /// The `addProject` arguments of a new project, checked as the server checks them, without its `clientId`.
    func newProjectArgs(_ fields: ProjectInput) async throws -> [String: JSONValue] {
        try await writer.read { db in
            try Self.requireProjects(db)
            let projects = try Self.allProjects(db)
            guard projects.count < ProjectRules.maxProjects else {
                throw RepositoryError.invalid(tr("There can be at most \(ProjectRules.maxProjects) projects, archived ones included."))
            }
            let name = try fields.checkedName(among: projects, except: nil)
            var args: [String: JSONValue] = ["name": .string(name)]
            if let color = fields.color { args["color"] = .string(color.rawValue) }
            if let icon = fields.icon { args["icon"] = .string(icon) }
            if let note = fields.note { args["note"] = .string(note) }
            return args
        }
    }

    /**
     * The `updateProject` arguments that make project [localId] what [change] returns (the fields that change), with
     * the project's server id and without a `clientId`; nil when nothing changes or the project is gone.
     */
    func projectChangeArgs(
        _ localId: String, _ change: @escaping @Sendable (Project, [Project]) throws -> [String: JSONValue]
    ) async throws -> [String: JSONValue]? {
        try await writer.read { db in
            try Self.requireProjects(db)
            guard let project = try Project.fetchOne(db, key: localId) else { return nil }
            let serverId = try Self.confirmed(project)
            var args = try change(project, try Self.allProjects(db))
            guard !args.isEmpty else { return nil }
            args["projectId"] = .string(serverId)
            return args
        }
    }

    /// The `deleteProject` arguments of project [localId], its tasks going to [target] (a project's `localId`) or out
    /// of any project (nil), without a `clientId`; nil when the project is gone.
    func projectDeletionArgs(_ localId: String, moveTasksTo target: String?) async throws -> [String: JSONValue]? {
        try await writer.read { db in
            try Self.requireProjects(db)
            guard let project = try Project.fetchOne(db, key: localId) else { return nil }
            var moveTo = ProjectRules.noProject
            if let target {
                guard target != localId else { throw RepositoryError.invalid(tr("Move the tasks to another project.")) }
                moveTo = try Self.checkTarget(db, target)
            }
            return ["projectId": .string(try Self.confirmed(project)), "moveTasksTo": .string(moveTo)]
        }
    }

    /// Writes the server's copy of a project it made or changed; the row keeps its `localId`.
    @discardableResult
    func saveServerProject(_ remote: RemoteProject) async throws -> Project {
        try await writer.write { db in
            try Meta.write(db, ProjectSupport.supported)
            var existing = try Project.filter(Column("serverId") == remote.id).fetchOne(db)
            if existing == nil, let clientId = remote.clientId {
                existing = try Project.filter(Column("clientId") == clientId).fetchOne(db)
            }
            let project = ProjectMerger.row(existing, remote)
            try project.save(db)
            return project
        }
    }

    /// The server deleted project [localId] and moved its tasks (in every state, the trash included) to [target] or
    /// out of any project (nil): so does this Mac.
    func removeServerProject(_ localId: String, movingTasksTo target: String?) async throws {
        let now = clock()
        try await writer.write { db in
            for var task in try TaskItem.filter(Column("projectLocalId") == localId).fetchAll(db) {
                task.projectLocalId = target
                task.updatedAt = now
                try task.save(db)
            }
            _ = try Project.deleteOne(db, key: localId)
        }
    }

    /// The server does not have projects (0.12.x).
    func markProjectsUnsupported() async throws {
        try await writer.write { db in try Meta.write(db, ProjectSupport.unsupported) }
    }
}

/// The editor's fields, checked as the backend checks them (`ProjectRules`); the name is checked against the other
/// projects just before the change is sent.
struct ProjectInput: Sendable {
    let name: String
    let color: ProjectColor?
    let icon: String?
    let note: String?

    init(name: String, color: ProjectColor?, icon: String, note: String) throws {
        guard let cleanIcon = ProjectRules.icon(icon) else { throw RepositoryError.invalid(tr("The icon must be a single emoji.")) }
        guard let cleanNote = ProjectRules.note(note) else { throw RepositoryError.invalid(tr("The note is too long.")) }
        self.name = name
        self.color = color
        self.icon = cleanIcon
        self.note = cleanNote
    }

    func checkedName(among projects: [Project], except localId: String?) throws -> String {
        switch ProjectRules.name(name, among: projects, except: localId) {
        case .success(let clean): return clean
        case .failure(let problem): throw RepositoryError.invalid(problem.message)
        }
    }

    /// The fields of [project] these change, as `updateProject` takes them (null clears).
    func changes(to project: Project, among projects: [Project]) throws -> [String: JSONValue] {
        let clean = try checkedName(among: projects, except: project.localId)
        var args: [String: JSONValue] = [:]
        if clean != project.name { args["name"] = .string(clean) }
        if color != project.color { args["color"] = color.map { .string($0.rawValue) } ?? .null }
        if icon != project.icon { args["icon"] = .of(icon) }
        if note != project.note { args["note"] = .of(note) }
        return args
    }
}

// MARK: - Sync

/**
 * The sync side of projects: the projects of a snapshot, and what a refusal about a task's project means for the task.
 * A task never goes because of its project: a task change the server refuses for its project is sent again without it.
 */
enum ProjectSync {
    /**
     * A task change the server refused about its project, handled here (true) or left to the task rules (false):
     *
     * - For its project (archived or deleted elsewhere): the change keeps its place in the queue, marked with the
     *   refusal (`lastError`), and goes again without the project. The task leaves the project here unless a later
     *   change moves it, and the next snapshot shows where the server has it.
     * - For its `projectId` argument (a server without projects, 0.12.x): the server is marked as such and the change
     *   goes again without `projectId`; the task keeps its project on this Mac.
     *
     * Either happens once: a change already sent again is refused by the task rules.
     */
    static func refused(_ db: Database, _ op: OutboxOp, reason: String) throws -> Bool {
        guard let localId = op.taskLocalId, let project = JSONValue.decode(op.argsJson)?["projectId"] else { return false }
        if RemoteJSON.refusesProjectField(reason), try Meta.projectSupport(db) != .unsupported {
            try Meta.write(db, ProjectSupport.unsupported)
            return true
        }
        guard RemoteJSON.refusesProject(reason), op.lastError.map(RemoteJSON.refusesProject) != true else { return false }
        try db.execute(sql: "UPDATE outbox SET lastError = ? WHERE seq = ?", arguments: [reason, op.seq])
        guard var task = try TaskItem.fetchOne(db, key: localId) else { return true }
        let later = try OutboxOp.filter(Column("taskLocalId") == localId && Column("seq") > (op.seq ?? 0)).fetchAll(db)
        let movedLater = later.contains { JSONValue.decode($0.argsJson)?["projectId"] != nil }
        if !movedLater, task.projectLocalId == project.string { task.projectLocalId = nil }
        task.serverUpdatedAt = nil
        try task.save(db)
        return true
    }

    /// The projects of a snapshot, merged (`ProjectMerger`) from a server with projects; returns how the tasks'
    /// server `projectId` reads on this Mac. A server without projects (nil) leaves the projects and memberships here.
    static func apply(_ db: Database, _ remote: [RemoteProject]?) throws -> ProjectMapping {
        guard let remote else {
            try Meta.write(db, ProjectSupport.unsupported)
            return ProjectMapping(preservingLocalMembership: true)
        }
        try Meta.write(db, ProjectSupport.supported)
        let plan = ProjectMerger.merge(local: try Project.fetchAll(db), remote: remote)
        if !plan.deletes.isEmpty { _ = try Project.deleteAll(db, keys: plan.deletes) }
        for project in plan.upserts { try project.save(db) }
        return ProjectMapping(projects: try Project.fetchAll(db))
    }
}
