import Foundation
import Testing
@testable import DayhandCore

extension ProjectSyncTests {
    @Test(arguments: [false, true], [false, true])
    func offlineDeletionPreservesRenamesOnEitherSideOfAnEarlierAssignment(renameFirst: Bool, unrelated: Bool) async throws {
        let (repo, engine) = try setUp()
        let old = server.addProjectElsewhere("C")
        let t = server.addElsewhere("T")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        if renameFirst { try await repo.updateProject(old, name: "Renamed", color: nil, icon: "", note: "") }
        let b = try await repo.addProject(name: "B")
        try await repo.setProject(t, b.localId)
        if !renameFirst { try await repo.updateProject(old, name: "Renamed", color: nil, icon: "", note: "") }
        if unrelated { try await repo.addProject(name: "Middle") }
        let c = try await repo.addProject(name: "C", note: "Replacement note")
        try await repo.addProject(name: "Later")
        let before = try await repo.pendingOps()
        try await repo.deleteProject(b.localId, moveTasksTo: c.localId)
        let pending = try await repo.pendingOps()
        #expect(Array(pending.dropLast()) == before)
        #expect(pending.last?.mutation == Mutations.deleteProject)
        #expect(JSONValue.decode(try #require(pending.last).argsJson)?["moveTasksTo"] == .string(c.localId))
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let replacement = try #require(server.project(named: "C"))
        #expect(replacement["note"] == "Replacement note")
        #expect(server.allProjects.first { $0["id"]?.string == old }?["name"] == "Renamed")
        #expect(server.project(named: "B") == nil)
        #expect(server.task(titled: "T")?["projectId"] == replacement["id"])
        #expect(replacement["position"]?.double == Double(unrelated ? 4 : 3) * ProjectRules.positionStep)
        #expect(server.project(named: "Later")?["position"]?.double == Double(unrelated ? 5 : 4) * ProjectRules.positionStep)
        if unrelated { #expect(server.project(named: "Middle")?["position"]?.double == 3 * ProjectRules.positionStep) }
        #expect(sent().compactMap { $0.1["clientId"]?.string } == pending.map(\.clientId))
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test(arguments: [false, true])
    func deletingThroughAnOfflineProjectFreesTheSourceNameBeforeItsReplacement(rename: Bool) async throws {
        let (repo, engine) = try setUp()
        let a = server.addProjectElsewhere("A")
        let other = server.addProjectElsewhere("Other")
        let t = server.addElsewhere("T")
        server.editElsewhere(t, ["projectId": .string(a)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let b = try await repo.addProject(name: "B")
        try await repo.deleteProject(a, moveTasksTo: b.localId)
        if rename { try await repo.updateProject(other, name: "A", color: nil, icon: "", note: "Saved note") }
        else { try await repo.addProject(name: "A", note: "Saved note") }
        let c = try await repo.addProject(name: "C")
        let before = try await repo.pendingOps()
        try await repo.deleteProject(b.localId, moveTasksTo: c.localId)
        let pending = try await repo.pendingOps()
        #expect(Array(pending.dropLast()) == before)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let replacement = try #require(server.project(named: "A"))
        #expect(replacement["id"]?.string != a && replacement["note"] == "Saved note")
        #expect(server.project(named: "B") == nil)
        #expect(server.task(titled: "T")?["projectId"] == server.project(named: "C")?["id"])
        #expect(try await repo.task(t)?.projectLocalId == c.localId)
        #expect(sent().compactMap { $0.1["clientId"]?.string } == pending.map(\.clientId))
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test func eachOfflineActionOnlyAppendsItsOwnOperation() async throws {
        let (repo, engine) = try setUp()
        let b = try await repo.addProject(name: "B")
        let t = try await repo.add(title: "T", dueDate: nil, dueTime: nil, projectLocalId: b.localId)
        let first = try await repo.pendingOps()
        try await repo.setNote(t.localId, "Task note")
        let c = try await repo.addProject(name: "C")
        #expect(Array(try await repo.pendingOps().prefix(first.count)) == first)
        try await repo.updateProject(c.localId, name: "Destination", color: nil, icon: "", note: "Destination note")
        let beforeDeletion = try await repo.pendingOps()
        try await repo.deleteProject(b.localId, moveTasksTo: c.localId)
        #expect(Array(try await repo.pendingOps().dropLast()) == beforeDeletion)
        let beforeReplacement = try await repo.pendingOps()
        try await repo.addProject(name: "B", note: "New B note")
        let pending = try await repo.pendingOps()
        #expect(Array(pending.dropLast()) == beforeReplacement)
        #expect(pending.map(\.mutation) == [Mutations.addProject, Mutations.add, Mutations.update, Mutations.addProject, Mutations.updateProject, Mutations.deleteProject, Mutations.addProject])
        #expect(JSONValue.decode(pending[1].argsJson)?["projectId"] == .string(b.localId))
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(sent().compactMap { $0.1["clientId"]?.string } == pending.map(\.clientId))
        #expect(server.project(named: "B")?["note"] == "New B note")
        #expect(server.task(titled: "T")?["projectId"] == server.project(named: "Destination")?["id"])
        #expect(server.task(titled: "T")?["note"] == "Task note")
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test func aRealCreationRefusalLeavesEveryOtherQueuedIntentUntouched() async throws {
        let (repo, engine) = try setUp()
        let b = try await repo.addProject(name: "B")
        let t = try await repo.add(title: "T", dueDate: nil, dueTime: nil, note: "Keep note", projectLocalId: b.localId)
        let c = try await repo.addProject(name: "C")
        try await repo.deleteProject(b.localId, moveTasksTo: c.localId)
        let before = try await repo.pendingOps()
        let theirs = server.addProjectElsewhere("B")
        #expect(try await OutboxProcessor(store: repo, sender: remote(), maxOps: 1).drain() == .moreLeft)
        #expect(try await repo.pendingOps() == Array(before.dropFirst()))
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.project(named: "B")?["id"] == .string(theirs))
        #expect(server.task(titled: "T")?["note"] == "Keep note")
        #expect(server.task(titled: "T")?["projectId"] == nil)
        #expect(try await repo.task(t.localId)?.projectLocalId == nil)
        #expect(try await repo.pendingOps().isEmpty)
    }

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

    @Test func aSupportedSnapshotAcknowledgesCreationWithoutReplayingItsOldMembership() async throws {
        let (repo, engine) = try setUp()
        let a = server.addProjectElsewhere("A")
        let b = server.addProjectElsewhere("B")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let t = try await repo.add(title: "T", dueDate: nil, dueTime: nil, projectLocalId: a)
        server.loseNextAnswer = true
        #expect(try await OutboxProcessor(store: repo, sender: remote()).drain() == .retryLater)
        let id = try #require(server.task(titled: "T")?["id"]?.string)
        server.editElsewhere(id, ["projectId": .string(b)])
        try await repo.apply(try await remote().snapshot().get())
        #expect(try await repo.pendingOps().isEmpty)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.task(titled: "T")?["projectId"] == .string(b))
        #expect(try await repo.task(t.localId)?.projectLocalId == b)
    }

    @Test(arguments: ["1️⃣", "#\u{20E3}", "👩🏽‍💻", "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}"])
    func backendEmojiIconsAllowCreationAndNoteEditsButRejectCombiningSuffixes(icon: String) async throws {
        let (repo, engine) = try setUp()
        let p = server.addProjectElsewhere("Imported")
        server.editProjectElsewhere(p, ["icon": .string(icon)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        try await repo.updateProject(p, name: "Imported", color: nil, icon: icon, note: "Edited note")
        let created = try await repo.addProject(name: "Created", icon: icon)
        let pending = try await repo.pendingOps()
        await #expect(throws: RepositoryError.self) {
            try await repo.addProject(name: "Invalid", icon: "🥐\u{301}")
        }
        await #expect(throws: RepositoryError.self) {
            try await repo.updateProject(p, name: "Imported", color: nil, icon: "🥐\u{301}", note: "Refused note")
        }
        #expect(try await repo.pendingOps() == pending)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.project(named: "Imported")?["note"] == "Edited note")
        #expect(server.project(named: "Created")?["icon"] == .string(icon))
        #expect(try await repo.projects().first { $0.localId == created.localId }?.icon == icon)
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
