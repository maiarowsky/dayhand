import Foundation
import GRDB
import Testing
@testable import DayhandCore

extension ProjectSyncTests {
    @Test(arguments: [Mutations.add, Mutations.update], [false, true])
    func onlyAnExplicitProjectReferenceWaitsForCreationAcknowledgementOrRefusal(mutation: String, refused: Bool) async throws {
        let (repo, engine) = try setUp()
        let existing = server.addElsewhere("T")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let now = clock.now
        let project = Project(localId: "pending-project", clientId: "pending-project", name: "Pending", position: ProjectRules.positionStep, createdAt: now, updatedAt: now)
        let taskId = mutation == Mutations.add ? "new-task" : existing
        var args: [String: JSONValue] = ["projectId": .string(project.localId), "clientId": "dependent-client"]
        if mutation == Mutations.add { args["title"] = "Created" }
        let dependent = OutboxOp(opId: "dependent", mutation: mutation, argsJson: JSONValue.object(args).encoded(), taskLocalId: taskId, clientId: "dependent-client", createdAt: now)
        let creation = OutboxOp(opId: "creation", mutation: Mutations.addProject, argsJson: JSONValue.object(["name": "Pending", "clientId": .string(project.localId)]).encoded(), taskLocalId: nil, clientId: project.localId, createdAt: now)
        try await repo.database.writer.write { db in
            try project.save(db)
            if mutation == Mutations.add {
                try TaskItem(localId: taskId, clientId: "dependent-client", title: "Created", createdAt: now, updatedAt: now, projectLocalId: project.localId).save(db)
            } else {
                try db.execute(sql: "UPDATE task SET projectLocalId = ? WHERE localId = ?", arguments: [project.localId, taskId])
            }
            var dependent = dependent, creation = creation
            try dependent.insert(db)
            try creation.insert(db)
        }
        let original = try await repo.pendingOps()
        #expect(try await repo.projectRef(project.localId) == nil)
        #expect(try await repo.next()?.opId == creation.opId)
        #expect(try await repo.pendingOps() == original)
        if refused { server.addProjectElsewhere("Pending") }
        #expect(try await OutboxProcessor(store: repo, sender: remote(), maxOps: 1).drain() == .moreLeft)
        #expect(try await repo.pendingOps() == [original[0]])
        #expect(try await repo.next()?.opId == dependent.opId)
        #expect(try await OutboxProcessor(store: repo, sender: remote()).drain() == .done)
        let title = mutation == Mutations.add ? "Created" : "T"
        let expected = refused ? nil : server.project(named: "Pending")?["id"]?.string
        #expect(server.task(titled: title)?["projectId"]?.string == expected)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(try await repo.task(taskId)?.projectLocalId == (refused ? nil : project.localId))
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test(arguments: [Mutations.softDelete, Mutations.archive, Mutations.restore, Mutations.setNow, Mutations.complete, Mutations.setStatus, Mutations.reschedule, Mutations.update, "clear"])
    func anOperationWithoutAnUnconfirmedProjectReferenceNeverWaitsForTaskState(action: String) async throws {
        let (repo, engine) = try setUp()
        let b = server.addProjectElsewhere("B")
        let t = server.addElsewhere("T")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        try await repo.setProject(t, b)
        switch action {
        case Mutations.softDelete: try await repo.moveToTrash(t)
        case Mutations.archive: try await repo.archive(t)
        case Mutations.restore: try await repo.restore(t)
        case Mutations.setNow: try await repo.setNow(t)
        case Mutations.complete: try await repo.complete(t)
        case Mutations.setStatus: try await repo.move(t, to: .doing)
        case Mutations.reschedule: try await repo.reschedule(t, to: "2026-10-23")
        case "clear": try await repo.setProject(t, nil)
        default: try await repo.rename(t, to: "Renamed")
        }
        let original = try await repo.pendingOps()
        server.editElsewhere(t, ["deletedAt": .of(clock.now)])
        _ = try await OutboxProcessor(store: repo, sender: remote(), maxOps: 1).drain()
        server.editElsewhere(t, ["deletedAt": .null])
        #expect(try await repo.pendingOps() == Array(original.dropFirst()))
        let next = try #require(try await repo.next())
        #expect(next.opId == original[1].opId)
        #expect(JSONValue.decode(next.argsJson)?["projectId"]?.string == nil)
        #expect(try await OutboxProcessor(store: repo, sender: remote()).drain() == .done)
        #expect(sent().map(\.0) == [Mutations.update, action == "clear" ? Mutations.update : action])
        #expect(try await repo.pendingOps().isEmpty)
    }
}
