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

    /// Projects need a server that has them, or none yet.
    static func requireProjects(_ db: Database) throws {
        if let requirement = try Meta.projectSupport(db).requirement {
            throw RepositoryError.invalid(requirement)
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
    static func ref(_ db: Database, _ localId: String) throws -> String? {
        guard let project = try find(db, localId) else { return nil }
        if let serverId = project.serverId { return serverId }
        return try OutboxOp.filter(Column("mutation") == Mutations.addProject && Column("clientId") == project.localId).fetchOne(db)?.clientId
    }

    static func find(_ db: Database, _ id: String) throws -> Project? {
        try Project.filter(Column("localId") == id || Column("serverId") == id || Column("clientId") == id).fetchOne(db)
    }

    /// A project made here gets its server id; a project deleted here goes once the server has the deletion.
    static func acknowledge(_ db: Database, _ op: OutboxOp, value: JSONValue) throws {
        switch op.mutation {
        case Mutations.addProject, Mutations.updateProject:
            let localId = op.mutation == Mutations.addProject ? op.clientId : JSONValue.decode(op.argsJson)?["projectId"]?.string
            let returned = op.mutation == Mutations.addProject ? value["project"] : value
            guard let localId, let serverId = returned?["id"]?.string else { return }
            try bind(db, localId, serverId: serverId)
        case Mutations.deleteProject:
            guard let args = JSONValue.decode(op.argsJson), let id = args["projectId"]?.string else { return }
            if let project = try find(db, id) { _ = try Project.deleteOne(db, key: project.localId) }
        default:
            break
        }
    }

    private static func bind(_ db: Database, _ localId: String, serverId: String) throws {
        guard var project = try find(db, localId) else { return }
        for other in try Project.filter(Column("serverId") == serverId && Column("localId") != project.localId).fetchAll(db) {
            var keepOther = Set<ProjectField>()
            for op in try OutboxOp.order(Column("seq")).fetchAll(db) {
                if op.mutation == Mutations.updateProject {
                    let dirty = DirtyProjects([op])
                    keepOther.formUnion(dirty.fields(other.localId))
                    keepOther.subtract(dirty.fields(project.localId))
                }
            }
            project = ProjectMerger.preserving(keepOther, from: other, in: project)
            project.removing = project.removing || other.removing
            project.updatedAt = max(project.updatedAt, other.updatedAt)
            try db.execute(sql: "UPDATE task SET projectLocalId = ? WHERE projectLocalId = ?", arguments: [project.localId, other.localId])
            _ = try Project.deleteOne(db, key: other.localId)
        }
        project.serverId = serverId
        project.serverUpdatedAt = nil
        try project.save(db)
    }

    /**
     * A refusal about projects, handled here (true) or left to the task rules (false):
     *
     * - A task change refused for its project (archived or deleted meanwhile) goes again without it, and the task
     *   leaves the project here.
     * - `addProject` refused: the project never existed on the server and goes, its tasks staying without a project.
     * - `updateProject` or `deleteProject` refused: the server's copy wins at the next snapshot.
     */
    static func refused(_ db: Database, _ op: OutboxOp, reason: String) throws -> Bool {
        if op.isProjectAssignment, RemoteJSON.refusesTrashedTask(reason) {
            try db.execute(sql: "UPDATE outbox SET lastError = ? WHERE seq = ?", arguments: [reason, op.seq])
            if let localId = op.taskLocalId {
                try db.execute(sql: "UPDATE task SET serverUpdatedAt = NULL WHERE localId = ?", arguments: [localId])
            }
            return true
        }
        let ofProject = Mutations.projectChanges.contains(op.mutation)
        let carriesProject = !ofProject && JSONValue.decode(op.argsJson)?["projectId"] != nil
        if (ofProject && RemoteJSON.isMissingFunction(reason)) || (carriesProject && RemoteJSON.refusesProjectField(reason)) {
            try suspend(db)
            return true
        }
        if carriesProject, RemoteJSON.refusesProject(reason) {
            try db.execute(sql: "UPDATE outbox SET lastError = ? WHERE seq = ?", arguments: [reason, op.seq])
            if let localId = op.taskLocalId, var task = try TaskItem.fetchOne(db, key: localId) {
                let later = try OutboxOp.filter(Column("taskLocalId") == localId && Column("seq") > (op.seq ?? 0)).fetchAll(db)
                let hasLaterAssignment = later.contains { JSONValue.decode($0.argsJson)?["projectId"] != nil }
                if !hasLaterAssignment, task.projectLocalId == JSONValue.decode(op.argsJson)?["projectId"]?.string {
                    task.projectLocalId = nil
                }
                task.serverUpdatedAt = nil
                try task.save(db)
            }
            return true
        }
        guard ofProject else { return false }
        _ = try OutboxOp.deleteOne(db, key: op.seq)
        if op.mutation == Mutations.addProject {
            try discardRefusedCreation(db, op.clientId)
            return true
        }
        guard let id = JSONValue.decode(op.argsJson)?["projectId"]?.string, var project = try find(db, id) else { return true }
        project.serverUpdatedAt = nil
        if op.mutation == Mutations.deleteProject {
            project.removing = try OutboxOp.filter(Column("mutation") == Mutations.deleteProject).fetchAll(db)
                .contains { JSONValue.decode($0.argsJson)?["projectId"]?.string == id }
            try db.execute(sql: "UPDATE task SET serverUpdatedAt = NULL")
        }
        try project.save(db)
        return true
    }

    static func discardRefusedCreation(_ db: Database, _ localId: String) throws {
        try db.execute(sql: "UPDATE task SET projectLocalId = NULL, serverUpdatedAt = NULL WHERE projectLocalId = ?", arguments: [localId])
        _ = try Project.deleteOne(db, key: localId)
    }

    static func suspend(_ db: Database) throws {
        try Meta.write(db, ProjectSupport.unsupported)
        for op in try OutboxOp.fetchAll(db) where op.waitsForProjects && op.lastError != nil {
            try db.execute(sql: "UPDATE outbox SET lastError = NULL WHERE seq = ?", arguments: [op.seq])
        }
    }

    /**
     * The projects of a snapshot, merged (`ProjectMerger`) from a server with projects. Returns how the tasks'
     * server `projectId` reads on this Mac.
     */
    static func apply(_ db: Database, _ remote: [RemoteProject]?, nowMs: Int64) throws -> ProjectMapping {
        guard let remote else {
            try suspend(db)
            return ProjectMapping(preservingLocalMembership: true)
        }
        try Meta.write(db, ProjectSupport.supported)
        for op in try OutboxOp.fetchAll(db) where op.mutation == Mutations.addProject {
            if remote.contains(where: { $0.clientId == op.clientId }) {
                _ = try OutboxOp.deleteOne(db, key: op.seq)
            }
        }
        let pending = try OutboxOp.order(Column("seq")).fetchAll(db)
        let plan = ProjectMerger.merge(local: try Project.fetchAll(db), pending: pending, remote: remote, nowMs: nowMs)
        if !plan.deletes.isEmpty { _ = try Project.deleteAll(db, keys: plan.deletes) }
        for project in plan.upserts { try project.save(db) }
        return ProjectMapping(projects: try Project.fetchAll(db), pending: pending)
    }
}
