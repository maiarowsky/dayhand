import Foundation
import Testing
@testable import DayhandCore

extension ProjectSyncTests {
    @Test(arguments: ["add", "move", "edit", "source", "destination"], [false, true])
    func bindingRetargetsEveryQueuedReferenceAndPreservesOptimisticState(action: String, acknowledge: Bool) async throws {
        let (repo, engine) = try setUp()
        let mine = try await repo.addProject(name: "Dom")
        let cached = server.addProjectElsewhere("Dom")
        let q = server.addProjectElsewhere("Q")
        let outside = server.addElsewhere("Outside")
        let inside = server.addElsewhere("Inside")
        server.editElsewhere(outside, ["projectId": .string(q)])
        server.editElsewhere(inside, ["projectId": .string(cached)])
        server.failNextMutation = true
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }
        try await repo.moveProject(mine.localId, to: 999)
        var taskId = outside
        switch action {
        case "add": taskId = try await repo.add(title: "Added", dueDate: nil, dueTime: nil, projectLocalId: cached).localId
        case "move": try await repo.setProject(outside, cached)
        case "edit":
            taskId = inside
            try await repo.updateProject(cached, name: "Cached name", color: .indigo, icon: "🧭", note: "Cached note")
            try await repo.moveProject(cached, to: 17)
            try await repo.setArchived(cached, true)
            try await repo.updateProject(mine.localId, name: "Dom", color: nil, icon: "", note: "Later own note")
        case "source":
            taskId = inside
            try await repo.deleteProject(cached, moveTasksTo: q)
        default: try await repo.deleteProject(q, moveTasksTo: cached)
        }
        server.editElsewhere(inside, ["note": "New server copy"])
        server.editElsewhere(outside, ["note": "New server copy"])
        let add = try #require(try await repo.next())
        try await repo.reject(add, reason: "A project named \"Dom\" already exists")
        if acknowledge {
            #expect(try await OutboxProcessor(store: repo, sender: remote(), maxOps: 1).drain() == .moreLeft)
        }
        server.failNextMutation = true
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }
        let pending = try await repo.pendingOps()
        #expect(pending.allSatisfy {
            let args = JSONValue.decode($0.argsJson)
            return args?["projectId"]?.string != cached && args?["moveTasksTo"]?.string != cached
        })
        let expected = action == "source" ? q : mine.localId
        #expect(try await repo.task(taskId)?.projectLocalId == expected)
        if action == "source" {
            #expect(try await repo.projects().allSatisfy { $0.localId != mine.localId })
        } else if action == "edit" {
            let row = try #require(try await repo.projects().first { $0.localId == mine.localId })
            #expect(row.name == "Cached name" && row.note == "Later own note")
            #expect(row.color == .indigo && row.icon == "🧭" && row.position == 17 && row.isArchived)
        }
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let serverTask = try #require(try await repo.task(taskId)?.serverId)
        #expect(server.allTasks.first { $0["id"]?.string == serverTask }?["projectId"] == .string(action == "source" ? q : cached))
        #expect(try await repo.pendingOps().isEmpty)
        if action == "source" { #expect(server.project(named: "Dom") == nil) }
        if action == "destination" { #expect(server.project(named: "Q") == nil) }
        if action == "edit" { #expect(server.project(named: "Cached name")?["note"] == "Later own note") }
    }

    @Test(arguments: [false, true]) func recoveredCreationsTakeServerFieldsWhileKeepingLaterEdits(laterEdit: Bool) async throws {
        let (repo, engine) = try setUp()
        server.addProjectElsewhere("Unseen one")
        server.addProjectElsewhere("Unseen two")
        let mine = try await repo.addProject(name: "Local", color: .red, icon: "🚀", note: "Local note")
        #expect(mine.position == 1024)
        server.loseNextAnswer = true
        #expect(try await OutboxProcessor(store: repo, sender: remote()).drain() == .retryLater)
        let id = try #require(server.project(named: "Local")?["id"]?.string)
        server.editProjectElsewhere(id, ["name": "Remote", "color": "teal", "icon": "🧭", "note": "Remote note", "archived": true, "archivedAt": .of(clock.now)])
        if laterEdit {
            try await repo.updateProject(mine.localId, name: "Later name", color: .red, icon: "🚀", note: "Local note")
        }
        let snapshot = try await remote().snapshot().get()
        for _ in 0..<2 {
            try await repo.apply(snapshot)
            let row = try #require(try await repo.projects().first { $0.localId == mine.localId })
            #expect(row.name == (laterEdit ? "Later name" : "Remote"))
            #expect(row.position == 3072 && row.color == .teal && row.icon == "🧭")
            #expect(row.note == "Remote note" && row.archivedAt == clock.now)
            #expect(try await repo.pendingOps().map(\.mutation) == (laterEdit ? [Mutations.updateProject] : []))
        }
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.project(named: laterEdit ? "Later name" : "Remote")?["note"] == "Remote note")
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test(arguments: [(false, false), (false, true), (true, false), (true, true)], [false, true])
    func suspendedMembershipSurvivesTrashAndReplaysAfterRestore(membership: (Bool, Bool), restoreElsewhere: Bool) async throws {
        let (newTask, clear) = membership
        let (repo, engine) = try setUp()
        let home: String
        let taskId: String
        if newTask {
            home = try await repo.addProject(name: "P").localId
            taskId = try await repo.add(title: "T", dueDate: nil, dueTime: nil, note: "Keep note", projectLocalId: home).localId
            if clear { try await repo.setProject(taskId, nil) }
        } else {
            home = server.addProjectElsewhere("P")
            let q = server.addProjectElsewhere("Q")
            taskId = server.addElsewhere("T")
            server.editElsewhere(taskId, ["projectId": .string(clear ? home : q), "note": "Keep note"])
            guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
            try await repo.setProject(taskId, clear ? nil : home)
        }
        try await repo.moveToTrash(taskId)
        server.hasProjects = false
        guard case .synced = await engine.round() else { Issue.record("expected synced on old server"); return }
        #expect(try await repo.task(taskId)?.projectLocalId == (clear ? nil : home))
        let other = try await repo.add(title: "Unrelated", dueDate: nil, dueTime: nil)
        server.hasProjects = true
        for _ in 0..<2 {
            guard case .synced = await engine.round() else { Issue.record("expected synced after upgrade"); return }
        }
        #expect(try await repo.task(other.localId)?.serverId != nil)
        #expect(try await repo.task(taskId)?.inTrash == true)
        #expect(try await repo.task(taskId)?.projectLocalId == (clear ? nil : home))
        let waiting = try await repo.pendingOps()
        #expect(!waiting.isEmpty && waiting.allSatisfy(\.isProjectAssignment))
        let sentBefore = server.mutationsSent()
        guard case .synced = await engine.round() else { Issue.record("expected synced while trashed"); return }
        #expect(server.mutationsSent() == sentBefore)
        #expect(try await repo.pendingOps() == waiting)
        let serverId = try #require(try await repo.task(taskId)?.serverId)
        if restoreElsewhere { server.editElsewhere(serverId, ["deletedAt": .null]) }
        else { try await repo.restore(taskId) }
        for _ in 0..<2 {
            guard case .synced = await engine.round() else { Issue.record("expected synced after restore"); return }
        }
        let projectId = try #require(server.project(named: "P")?["id"]?.string)
        #expect(server.task(titled: "T")?["projectId"]?.string == (clear ? nil : projectId))
        #expect(server.task(titled: "T")?["note"] == "Keep note")
        #expect(try await repo.task(taskId)?.projectLocalId == (clear ? nil : home))
        #expect(try await repo.task(taskId)?.inTrash == false)
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test func aMembershipRefusedForRemoteTrashWaitsWithoutBlockingOtherTasks() async throws {
        let (repo, engine) = try setUp()
        let home = server.addProjectElsewhere("P")
        let t = server.addElsewhere("T")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        try await repo.setProject(t, home)
        let other = try await repo.add(title: "Unrelated", dueDate: nil, dueTime: nil)
        server.editElsewhere(t, ["deletedAt": .of(clock.now)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(try await repo.task(t)?.projectLocalId == home)
        #expect(try await repo.task(other.localId)?.serverId != nil)
        let waiting = try await repo.pendingOps()
        #expect(waiting.count == 1 && waiting.allSatisfy(\.isProjectAssignment))
        let sentBefore = server.mutationsSent()
        guard case .synced = await engine.round() else { Issue.record("expected synced while trashed"); return }
        #expect(server.mutationsSent() == sentBefore)
        #expect(try await repo.pendingOps() == waiting)
        server.editElsewhere(t, ["deletedAt": .null])
        for _ in 0..<2 {
            guard case .synced = await engine.round() else { Issue.record("expected synced after restore"); return }
        }
        #expect(server.task(titled: "T")?["projectId"] == .string(home))
        #expect(try await repo.task(t)?.projectLocalId == home)
        #expect(try await repo.pendingOps().isEmpty)
    }
}
