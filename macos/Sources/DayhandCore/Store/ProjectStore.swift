import DayhandLocalization
import Foundation
import GRDB

/**
 * Projects (backend 0.13.0) on this Mac: each change writes the row and queues its mutation in one transaction, as
 * the task changes do. A project made offline is named in the outbox by its `localId` and gets its server id when its
 * `addProject` is answered (`ProjectOutbox`).
 */
extension TaskRepository {
    // MARK: Reading

    /// The projects, archived ones included, in the sidebar's order; a project being deleted is left out.
    public func projects() async throws -> [Project] {
        try await writer.read { db in try Self.visibleProjects(db) }
    }

    public func observeProjects() -> AsyncValueObservation<[Project]> {
        ValueObservation.tracking { db in try Self.visibleProjects(db) }.values(in: writer)
    }

    public func observeProjectSupport() -> AsyncValueObservation<ProjectSupport> {
        ValueObservation.tracking { db in try Meta.projectSupport(db) }.values(in: writer)
    }

    static func visibleProjects(_ db: Database) throws -> [Project] {
        try Project.filter(Column("removing") == false).fetchAll(db).sorted(by: Project.menuOrder)
    }

    // MARK: Changes

    /// A new project at the end of the sidebar. [icon] and [note] may be blank (none).
    @discardableResult
    public func addProject(name: String, color: ProjectColor? = nil, icon: String = "", note: String = "") async throws -> Project {
        let now = clock()
        let localId = newId()
        let fields = try ProjectInput(name: name, color: color, icon: icon, note: note)
        let project = try await writer.write { [self] db -> Project in
            try Self.requireProjects(db)
            let projects = try Self.visibleProjects(db)
            guard projects.count < ProjectRules.maxProjects else {
                throw RepositoryError.invalid(tr("There can be at most \(ProjectRules.maxProjects) projects, archived ones included."))
            }
            let clean = try fields.checkedName(among: projects, except: nil)
            let project = Project(
                localId: localId, clientId: localId, name: clean, color: color, icon: fields.icon, note: fields.note,
                position: ProjectRules.positionAtEnd(projects), createdAt: now, updatedAt: now
            )
            var args: [String: JSONValue] = ["name": .string(clean)]
            if let color { args["color"] = .string(color.rawValue) }
            if let icon = fields.icon { args["icon"] = .string(icon) }
            if let note = fields.note { args["note"] = .string(note) }
            try project.save(db)
            var op = makeOp(Mutations.addProject, nil, args, now: now, clientId: localId)
            try op.insert(db)
            return project
        }
        onOutboxChanged()
        return project
    }

    /// Saves the editor: the name, color, icon and note; only the fields that changed are sent.
    public func updateProject(_ localId: String, name: String, color: ProjectColor?, icon: String, note: String) async throws {
        let fields = try ProjectInput(name: name, color: color, icon: icon, note: note)
        try await editProject(localId) { project, db in
            let clean = try fields.checkedName(among: try Self.visibleProjects(db), except: localId)
            var args: [String: JSONValue] = [:]
            if clean != project.name { args["name"] = .string(clean) }
            if color != project.color { args["color"] = color.map { .string($0.rawValue) } ?? .null }
            if fields.icon != project.icon { args["icon"] = .of(fields.icon) }
            if fields.note != project.note { args["note"] = .of(fields.note) }
            project.name = clean
            project.color = color
            project.icon = fields.icon
            project.note = fields.note
            return args
        }
    }

    /// Moves a project in the sidebar (`ProjectRules.position`).
    public func moveProject(_ localId: String, to position: Double) async throws {
        guard position.isFinite, abs(position) <= ProjectRules.maxPosition else { return }
        try await editProject(localId) { project, _ in
            guard project.position != position else { return [:] }
            project.position = position
            return ["position": .number(position)]
        }
    }

    /// Archives a project (it leaves the sidebar and the pickers; its tasks stay where they are) or restores it.
    public func setArchived(_ localId: String, _ archived: Bool) async throws {
        let now = clock()
        try await editProject(localId) { project, _ in
            guard project.isArchived != archived else { return [:] }
            project.archivedAt = archived ? now : nil
            return ["archived": .bool(archived)]
        }
    }

    /**
     * Deletes a project; its tasks (in every state, the trash included) move to [target] (a project's `localId`) or
     * out of any project (nil), here at once and on the server with the deletion. The row stays hidden until the
     * server has the deletion.
     */
    public func deleteProject(_ localId: String, moveTasksTo target: String?) async throws {
        let now = clock()
        let op = makeOp(Mutations.deleteProject, nil, ["projectId": .string(localId), "moveTasksTo": .string(target ?? ProjectRules.noProject)], now: now)
        let changed = try await writer.write { db -> Bool in
            try Self.requireProjects(db)
            guard var project = try Project.fetchOne(db, key: localId), !project.removing else { return false }
            if let target {
                guard target != localId else { throw RepositoryError.invalid(tr("Move the tasks to another project.")) }
                try Self.checkTarget(db, target)
            }
            for var task in try TaskItem.filter(Column("projectLocalId") == localId).fetchAll(db) {
                task.projectLocalId = target
                task.updatedAt = now
                try task.save(db)
            }
            project.removing = true
            project.updatedAt = now
            try project.save(db)
            var op = op
            try op.insert(db)
            return true
        }
        if changed { onOutboxChanged() }
    }

    /// Moves a task into project [projectLocalId], or out of its project (nil).
    public func setProject(_ taskLocalId: String, _ projectLocalId: String?) async throws {
        guard let current = try await task(taskLocalId), current.projectLocalId != projectLocalId, !current.inTrash else { return }
        try await writer.read { db in
            if let projectLocalId { try Self.checkTarget(db, projectLocalId, current: current.projectLocalId) } else { try Self.requireProjects(db) }
        }
        try await edit(taskLocalId, Mutations.update, ["projectId": projectLocalId.map(JSONValue.string) ?? .null]) { task, _ in
            task.projectLocalId = projectLocalId
        }
    }

    // MARK: Checks

    /// Projects need a server that has them, or none yet.
    static func requireProjects(_ db: Database) throws {
        if try Meta.projectSupport(db) == .unsupported {
            throw RepositoryError.invalid(tr("This server has no projects. Projects need Dayhand server 0.13.0 or later."))
        }
    }

    /// A task can go into [localId]: it exists and is not archived, unless the task is in it already ([current]).
    static func checkTarget(_ db: Database, _ localId: String, current: String? = nil) throws {
        try requireProjects(db)
        guard let project = try Project.fetchOne(db, key: localId), !project.removing else {
            throw RepositoryError.invalid(tr("That project no longer exists."))
        }
        if project.isArchived, localId != current {
            throw RepositoryError.invalid(tr("“\(project.name)” is archived; restore it first."))
        }
    }

    /// Changes one project and queues `updateProject` with the arguments [change] returns; nothing when it returns none.
    private func editProject(
        _ localId: String, change: @escaping @Sendable (inout Project, Database) throws -> [String: JSONValue]
    ) async throws {
        let now = clock()
        let template = makeOp(Mutations.updateProject, nil, [:], now: now)
        let changed = try await writer.write { db -> Bool in
            try Self.requireProjects(db)
            guard var project = try Project.fetchOne(db, key: localId), !project.removing else { return false }
            var args = try change(&project, db)
            guard !args.isEmpty else { return false }
            project.updatedAt = now
            try project.save(db)
            var op = template
            args["projectId"] = .string(localId)
            args["clientId"] = .string(op.clientId)
            op.argsJson = JSONValue.object(args).encoded()
            try op.insert(db)
            return true
        }
        if changed { onOutboxChanged() }
    }
}

/// The editor's fields, checked as the backend checks them (`ProjectRules`); the name is checked against the others
/// inside the transaction that saves it.
private struct ProjectInput: Sendable {
    let name: String
    let icon: String?
    let note: String?

    init(name: String, color: ProjectColor?, icon: String, note: String) throws {
        guard let cleanIcon = ProjectRules.icon(icon) else { throw RepositoryError.invalid(tr("The icon must be a single emoji.")) }
        guard let cleanNote = ProjectRules.note(note) else { throw RepositoryError.invalid(tr("The note is too long.")) }
        self.name = name
        self.icon = cleanIcon
        self.note = cleanNote
    }

    func checkedName(among projects: [Project], except localId: String?) throws -> String {
        switch ProjectRules.name(name, among: projects, except: localId) {
        case .success(let clean): return clean
        case .failure(let problem): throw RepositoryError.invalid(problem.message)
        }
    }
}

// MARK: - Outbox

/**
 * The outbox's side of projects: what a project is called when a change about it is sent, what an answer means for
 * the rows, and what a refusal about projects undoes. A task never goes because of its project: a task change the
 * server refuses for its project is sent again without it.
 */
enum ProjectOutbox {
    /// The server id of project [localId], or its name while it has none; nil when this Mac has no such project.
    static func ref(_ db: Database, _ localId: String) throws -> String? {
        guard let project = try Project.fetchOne(db, key: localId) else { return nil }
        return project.serverId ?? project.name
    }

    /// A project made here gets its server id; a project deleted here goes once the server has the deletion.
    static func acknowledge(_ db: Database, _ op: OutboxOp, value: JSONValue) throws {
        switch op.mutation {
        case Mutations.addProject:
            guard let serverId = value["project"]?["id"]?.string, var project = try Project.fetchOne(db, key: op.clientId) else { return }
            // A row a snapshot made for the same project meanwhile gives its tasks to this one and goes.
            for other in try Project.filter(Column("serverId") == serverId && Column("localId") != project.localId).fetchAll(db) {
                try db.execute(sql: "UPDATE task SET projectLocalId = ? WHERE projectLocalId = ?", arguments: [project.localId, other.localId])
                _ = try Project.deleteOne(db, key: other.localId)
            }
            project.serverId = serverId
            try project.save(db)
        case Mutations.deleteProject:
            guard let id = JSONValue.decode(op.argsJson)?["projectId"]?.string else { return }
            _ = try Project.deleteOne(db, key: id)
        default:
            break
        }
    }

    /**
     * A refusal about projects, handled here (true) or left to the task rules (false):
     *
     * - The server has no projects (0.12.x): every project leaves this Mac, with the project changes still waiting;
     *   task changes stay and go again without their project.
     * - A task change refused for its project (archived or deleted meanwhile) goes again without it, and the task
     *   leaves the project here.
     * - `addProject` refused because a project that is not archived has the name: the row stays and joins that
     *   project (`ProjectMerger`); refused for anything else, the project never existed on the server and goes, its
     *   tasks staying without a project.
     * - `updateProject` or `deleteProject` refused: the server's copy wins at the next snapshot.
     */
    static func refused(_ db: Database, _ op: OutboxOp, reason: String) throws -> Bool {
        let ofProject = Mutations.projectChanges.contains(op.mutation)
        let carriesProject = !ofProject && JSONValue.decode(op.argsJson)?["projectId"] != nil
        if (ofProject && RemoteJSON.isMissingFunction(reason)) || (carriesProject && RemoteJSON.refusesProjectField(reason)) {
            try forgetProjects(db)
            return true
        }
        if carriesProject, RemoteJSON.refusesProject(reason) {
            try withoutProject(db, op)
            if let localId = op.taskLocalId {
                try db.execute(sql: "UPDATE task SET projectLocalId = NULL WHERE localId = ?", arguments: [localId])
            }
            return true
        }
        guard ofProject else { return false }
        _ = try OutboxOp.deleteOne(db, key: op.seq)
        if op.mutation == Mutations.addProject {
            if !RemoteJSON.nameTakenByActiveProject(reason) { try drop(db, op.clientId) }
            return true
        }
        guard let id = JSONValue.decode(op.argsJson)?["projectId"]?.string, var project = try Project.fetchOne(db, key: id) else { return true }
        project.serverUpdatedAt = nil
        if project.removing {
            project.removing = false
            // Its tasks moved here with the deletion; the next snapshot puts every task back as the server has it.
            try db.execute(sql: "UPDATE task SET serverUpdatedAt = NULL")
        }
        try project.save(db)
        return true
    }

    /// The server has no projects: none stays on this Mac, and no change waiting names one.
    static func forgetProjects(_ db: Database) throws {
        try Meta.write(db, ProjectSupport.unsupported)
        for op in try OutboxOp.fetchAll(db) {
            if Mutations.projectChanges.contains(op.mutation) {
                _ = try OutboxOp.deleteOne(db, key: op.seq)
            } else {
                try withoutProject(db, op)
            }
        }
        try db.execute(sql: "UPDATE task SET projectLocalId = NULL WHERE projectLocalId IS NOT NULL")
        _ = try Project.deleteAll(db)
    }

    /// A project that never existed on the server leaves this Mac, with its own changes; changes naming it stay
    /// without it.
    static func drop(_ db: Database, _ localId: String) throws {
        for op in try OutboxOp.fetchAll(db) {
            let args = JSONValue.decode(op.argsJson)?.object ?? [:]
            if Mutations.projectChanges.contains(op.mutation), op.clientId == localId || args["projectId"]?.string == localId {
                _ = try OutboxOp.deleteOne(db, key: op.seq)
            } else if args["projectId"]?.string == localId {
                try withoutProject(db, op)
            } else if args["moveTasksTo"]?.string == localId {
                try rewrite(db, op, args.merging(["moveTasksTo": .string(ProjectRules.noProject)]) { $1 })
            }
        }
        try db.execute(sql: "UPDATE task SET projectLocalId = NULL WHERE projectLocalId = ?", arguments: [localId])
        _ = try Project.deleteOne(db, key: localId)
    }

    /// [op] without its `projectId`.
    private static func withoutProject(_ db: Database, _ op: OutboxOp) throws {
        guard var args = JSONValue.decode(op.argsJson)?.object, args["projectId"] != nil else { return }
        args.removeValue(forKey: "projectId")
        try rewrite(db, op, args)
    }

    private static func rewrite(_ db: Database, _ op: OutboxOp, _ args: [String: JSONValue]) throws {
        try db.execute(sql: "UPDATE outbox SET argsJson = ? WHERE seq = ?", arguments: [JSONValue.object(args).encoded(), op.seq])
    }

    /**
     * The projects of a snapshot: merged (`ProjectMerger`) from a server with projects; from a server without them
     * (nil) every project with no change waiting goes (the others go when their change is refused). Returns how the
     * tasks' server `projectId` reads on this Mac.
     */
    static func apply(_ db: Database, _ remote: [RemoteProject]?, pending: [OutboxOp], nowMs: Int64) throws -> ProjectMapping {
        guard let remote else {
            try Meta.write(db, ProjectSupport.unsupported)
            let waiting = DirtyProjects(pending)
            for project in try Project.fetchAll(db) where !waiting.hasChanges(project.localId) {
                _ = try Project.deleteOne(db, key: project.localId)
            }
            try db.execute(sql: """
                UPDATE task SET projectLocalId = NULL
                WHERE projectLocalId IS NOT NULL AND projectLocalId NOT IN (SELECT localId FROM project)
                """)
            return ProjectMapping()
        }
        try Meta.write(db, ProjectSupport.supported)
        let plan = ProjectMerger.merge(local: try Project.fetchAll(db), pending: pending, remote: remote, nowMs: nowMs)
        if !plan.deletes.isEmpty { _ = try Project.deleteAll(db, keys: plan.deletes) }
        for project in plan.upserts { try project.save(db) }
        return ProjectMapping(projects: try Project.fetchAll(db), pending: pending)
    }
}
