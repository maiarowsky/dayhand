import Foundation
import Testing
@testable import DayhandCore

/**
 * A task change refused because the task was in the trash on another device is dropped as any refused change, and the
 * changes behind it go in their order: no assignment waits, none is sent again after the task comes back.
 */
extension ProjectSyncTests {
    @Test(arguments: ["assign", "clear", "complete", "now"])
    func remoteRestorationDoesNotReplayARefusedMembershipAfterLaterTaskChanges(action: String) async throws {
        let transport = RestoreAfterMembershipRefusalTransport(server)
        let (repo, engine) = try setUp(transport: transport)
        let a = server.addProjectElsewhere("A")
        let b = server.addProjectElsewhere("B")
        let c = server.addProjectElsewhere("C")
        let t = server.addElsewhere("T", dueDate: "2026-10-22")
        server.editElsewhere(t, ["projectId": .string(a), "repeat": RepeatRule(every: .day).wire])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        try await repo.setProject(t, b)
        if action == "complete" { try await repo.complete(t) }
        else if action == "now" { try await repo.setNow(t) }
        else { try await repo.setProject(t, action == "clear" ? nil : c) }
        let original = try await repo.pendingOps()
        let unrelated = try await repo.add(title: "Unrelated", dueDate: nil, dueTime: nil)
        server.editElsewhere(t, ["deletedAt": .of(clock.now)])
        await transport.restoreAfterRefusal(t)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(try await repo.task(unrelated.localId)?.serverId != nil)
        #expect(try await repo.pendingOps().isEmpty)
        #expect(sent().filter { $0.1["taskId"] == .string(t) }.compactMap { $0.1["clientId"]?.string } == original.map(\.clientId))
        for _ in 0..<2 {
            guard case .synced = await engine.round() else { Issue.record("expected synced after restore"); return }
        }
        let expected = action == "clear" ? nil : (action == "assign" ? c : a)
        #expect(server.task(titled: "T")?["projectId"]?.string == expected)
        #expect(try await repo.task(t)?.projectLocalId == expected)
        if action == "complete" {
            #expect(server.allTasks.filter { $0["title"] == "T" }.allSatisfy { $0["projectId"] == .string(a) })
            #expect(server.allTasks.filter { $0["title"] == "T" }.count == 2)
        }
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test func aTrashRequestStillRunsAfterAnotherDeviceTrashesAndRestoresTheTask() async throws {
        let transport = RestoreAfterMembershipRefusalTransport(server)
        let (repo, engine) = try setUp(transport: transport)
        let b = server.addProjectElsewhere("B")
        let t = server.addElsewhere("T")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        try await repo.setProject(t, b)
        try await repo.moveToTrash(t)
        let original = try await repo.pendingOps()
        server.editElsewhere(t, ["deletedAt": .of(clock.now)])
        await transport.restoreAfterRefusal(t)
        for _ in 0..<2 {
            guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        }
        #expect(sent().map(\.0) == [Mutations.update, Mutations.softDelete])
        #expect(sent().compactMap { $0.1["clientId"]?.string } == original.map(\.clientId))
        #expect(server.task(titled: "T")?["deletedAt"] != nil)
        #expect(try await repo.task(t)?.inTrash == true)
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test(arguments: [Mutations.softDelete, Mutations.archive])
    func aLaterLifecycleChangeClearsNowDespiteAnEarlierMembershipRefusal(lifecycle: String) async throws {
        let transport = RestoreAfterMembershipRefusalTransport(server)
        let (repo, engine) = try setUp(transport: transport)
        let b = server.addProjectElsewhere("B")
        let t = server.addElsewhere("T")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        try await repo.setProject(t, b)
        try await repo.setNow(t)
        if lifecycle == Mutations.softDelete { try await repo.moveToTrash(t) }
        else { try await repo.archive(t) }
        try await repo.restore(t)
        let original = try await repo.pendingOps()
        server.editElsewhere(t, ["deletedAt": .of(clock.now)])
        await transport.restoreAfterRefusal(t)
        for _ in 0..<2 {
            guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        }
        #expect(sent().map(\.0) == [Mutations.update, Mutations.setNow, lifecycle, Mutations.restore])
        #expect(sent().compactMap { $0.1["clientId"]?.string } == original.map(\.clientId))
        #expect(server.task(titled: "T")?["isNow"] == false)
        #expect(server.task(titled: "T")?["deletedAt"] == nil)
        #expect(server.task(titled: "T")?["archivedAt"] == nil)
        #expect(try await repo.task(t)?.isNow == false)
        #expect(try await repo.task(t)?.inTrash == false)
        #expect(try await repo.task(t)?.archivedAt == nil)
        #expect(try await repo.pendingOps().isEmpty)
    }
}

private actor RestoreAfterMembershipRefusalTransport: HTTPTransport {
    let server: FakeServer
    private var taskId: String?

    init(_ server: FakeServer) { self.server = server }

    func restoreAfterRefusal(_ id: String) { taskId = id }

    func post(_ url: URL, json: Data, bearer: String?) async throws -> HTTPReply {
        let reply = try await server.post(url, json: json, bearer: bearer)
        if let id = taskId, JSONValue.decode(json)?["args"]?.array?.first?["taskId"] == .string(id),
           JSONValue.decode(reply.body)?["errorMessage"]?.string?.contains("Task is in the trash") == true {
            taskId = nil
            server.editElsewhere(id, ["deletedAt": .null])
        }
        return reply
    }
}
