import DayhandLocalization
import Foundation

extension RepositoryError {
    /// A project change without a server, or with one that cannot be reached: nothing is queued.
    public static var needsConnection: RepositoryError { .invalid(tr("Requires a connection to the server.")) }
}

/**
 * Project management, online only: each change is checked on the Mac as the server checks it (`ProjectRules`), sent
 * to the server at once and, once the server has it, written into the local database, so the screens show it without
 * waiting for the next snapshot. Nothing is queued. Without a connection a change fails with
 * `RepositoryError.needsConnection` (and without a pairing there is no engine to call: the screens say the same); a
 * server without projects fails it with `ProjectSupport.requirement`, and any other refusal with the server's words,
 * the Mac left as it was. A call waits for a running round and the next round waits for it.
 */
extension SyncEngine {
    /// A new project at the end of the sidebar. [icon] and [note] may be blank (none).
    @discardableResult
    public func addProject(name: String, color: ProjectColor? = nil, icon: String = "", note: String = "") async throws -> Project {
        let fields = try ProjectInput(name: name, color: color, icon: icon, note: note)
        await takeTurn()
        defer { passTurn() }
        var args = try await repository.newProjectArgs(fields)
        args["clientId"] = .string(repository.newId())
        let value = try await projectCall(Mutations.addProject, args)
        // An answer without the project counts as none; the next snapshot shows what the server did.
        guard let project = value["project"].flatMap(RemoteJSON.project) else { throw RepositoryError.needsConnection }
        return try await repository.saveServerProject(project)
    }

    /// Saves the editor: the name, color, icon and note; only the fields that changed are sent.
    public func updateProject(_ localId: String, name: String, color: ProjectColor?, icon: String, note: String) async throws {
        let fields = try ProjectInput(name: name, color: color, icon: icon, note: note)
        try await changeProject(localId) { project, projects in try fields.changes(to: project, among: projects) }
    }

    /// Moves a project in the sidebar (`ProjectRules.position`).
    public func moveProject(_ localId: String, to position: Double) async throws {
        guard position.isFinite, abs(position) <= ProjectRules.maxPosition else { return }
        try await changeProject(localId) { project, _ in project.position == position ? [:] : ["position": .number(position)] }
    }

    /// Archives a project (it leaves the sidebar and the pickers; its tasks stay where they are) or restores it.
    public func setArchived(_ localId: String, _ archived: Bool) async throws {
        try await changeProject(localId) { project, _ in project.isArchived == archived ? [:] : ["archived": .bool(archived)] }
    }

    /// Deletes a project; its tasks (in every state, the trash included) move to [target] (a project's `localId`) or
    /// out of any project (nil), on the server and then here.
    public func deleteProject(_ localId: String, moveTasksTo target: String?) async throws {
        await takeTurn()
        defer { passTurn() }
        guard var args = try await repository.projectDeletionArgs(localId, moveTasksTo: target) else { return }
        args["clientId"] = .string(repository.newId())
        _ = try await projectCall(Mutations.deleteProject, args)
        try await repository.removeServerProject(localId, movingTasksTo: target)
    }

    private func changeProject(
        _ localId: String, _ change: @escaping @Sendable (Project, [Project]) throws -> [String: JSONValue]
    ) async throws {
        await takeTurn()
        defer { passTurn() }
        guard var args = try await repository.projectChangeArgs(localId, change) else { return }
        args["clientId"] = .string(repository.newId())
        let value = try await projectCall(Mutations.updateProject, args)
        guard let project = RemoteJSON.project(value) else { throw RepositoryError.needsConnection }
        try await repository.saveServerProject(project)
    }

    /// Sends one project change and returns the server's answer, or throws what the user is told instead.
    private func projectCall(_ mutation: String, _ args: [String: JSONValue]) async throws -> JSONValue {
        defer { requestSync() }
        switch await sender.send(mutation: mutation, args: .object(args)) {
        case .applied(let value):
            return value
        case .rejected(let message) where RemoteJSON.isMissingFunction(message):
            try await repository.markProjectsUnsupported()
            throw RepositoryError.invalid(ProjectSupport.unsupported.requirement ?? message)
        case .rejected(let message):
            throw RepositoryError.invalid(message)
        case .unauthorized, .failed:
            throw RepositoryError.needsConnection
        }
    }
}
