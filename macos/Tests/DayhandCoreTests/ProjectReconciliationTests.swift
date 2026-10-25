import Foundation
import Testing
@testable import DayhandCore

extension ProjectSyncTests {
    @Test(arguments: ["add", "move", "edit", "source", "destination"], [false, true])
    func acknowledgedIdentityRetargetsCachedReferencesWithoutNameMatching(action: String, acknowledge: Bool) async throws {
        let (repo, engine) = try setUp()
        let mine = try await repo.addProject(name: "Dom")
        let q = server.addProjectElsewhere("Q")
        server.loseNextAnswer = true
        #expect(try await OutboxProcessor(store: repo, sender: remote()).drain() == .retryLater)
        let cached = try #require(server.project(named: "Dom")?["id"]?.string)
        server.editProjectElsewhere(cached, ["clientId": .null])
        let outside = server.addElsewhere("Outside")
        let inside = server.addElsewhere("Inside")
        server.editElsewhere(outside, ["projectId": .string(q)])
        server.editElsewhere(inside, ["projectId": .string(cached)])
        try await repo.apply(try await remote().snapshot().get())
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
        if acknowledge {
            #expect(try await OutboxProcessor(store: repo, sender: remote(), maxOps: 1).drain() == .moreLeft)
        } else {
            let add = try #require(try await repo.next())
            let project = try #require(server.project(named: "Dom"))
            try await repo.acknowledge(add, value: ["project": project])
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

    @Test(arguments: ["delete", "archive", "complete"], [false, true])
    func ordinaryAssignmentsKeepTheirOrderBeforeTrashAndProjectTransitions(action: String, restoreBeforeSending: Bool) async throws {
        let (repo, engine) = try setUp()
        let a = server.addProjectElsewhere("A")
        let b = server.addProjectElsewhere("B")
        let c = server.addProjectElsewhere("C")
        let t = server.addElsewhere("T", dueDate: "2026-10-22")
        server.editElsewhere(t, ["projectId": .string(a)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        if action == "complete" {
            try await repo.setRepeat(t, RepeatRule(every: .day))
            guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        }
        try await repo.setProject(t, b)
        if action == "complete" { try await repo.complete(t) }
        try await repo.moveToTrash(t)
        if action == "delete" { try await repo.deleteProject(b, moveTasksTo: c) }
        if action == "archive" { try await repo.setArchived(b, true) }
        if restoreBeforeSending { try await repo.restore(t) }
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        if !restoreBeforeSending {
            #expect(try await repo.task(t)?.inTrash == true)
            try await repo.restore(t)
            guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        }
        let expected = action == "delete" ? c : b
        #expect(server.task(titled: "T")?["projectId"] == .string(expected))
        #expect(try await repo.task(t)?.projectLocalId == expected)
        #expect(try await repo.task(t)?.inTrash == false)
        #expect(try await repo.pendingOps().isEmpty)
        let mutations = sent()
        let assigned = try #require(mutations.firstIndex { $0.0 == Mutations.update && $0.1["projectId"] == .string(b) })
        let trashed = try #require(mutations.firstIndex { $0.0 == Mutations.softDelete })
        #expect(assigned < trashed)
        if action == "complete" {
            let next = try #require(server.allTasks.first { $0["id"]?.string != t })
            #expect(next["projectId"] == .string(b))
        }
    }

    @Test(arguments: [("refused", false), ("refused", true), ("old-add", false), ("old-add", true), ("upgrade", false)])
    func purgedTasksRetireOnlyDeferredMembershipsAndKeepUnsentCreations(scenario: (String, Bool)) async throws {
        let (source, clear) = scenario
        let (repo, engine) = try setUp()
        let t: String
        if source == "old-add" {
            let p = try await repo.addProject(name: "P")
            t = try await repo.add(title: "T", dueDate: nil, dueTime: nil, note: "Note", projectLocalId: p.localId).localId
            if clear { try await repo.setProject(t, nil) }
            try await repo.moveToTrash(t)
            server.hasProjects = false
            guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        } else {
            let p = server.addProjectElsewhere("P")
            t = server.addElsewhere("T")
            if clear || source == "upgrade" { server.editElsewhere(t, ["projectId": .string(p)]) }
            guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
            if source == "refused" { try await repo.setProject(t, clear ? nil : p) }
            server.editElsewhere(t, ["deletedAt": .of(clock.now)])
            if source == "upgrade" { server.hasProjects = false }
            guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
            if source == "upgrade" {
                server.hasProjects = true
                for _ in 0..<2 {
                    guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
                }
            }
        }
        let serverId = try #require(try await repo.task(t)?.serverId)
        try await repo.saveHistory(serverId, [TaskEvent(taskServerId: serverId, at: clock.now, actor: "app", action: "create")])
        #expect(try await repo.pendingOps().contains { $0.taskLocalId == t && $0.isProjectAssignment })
        #expect(try await repo.history(serverId).count == 1)
        clock.advance(Int64(TaskItem.trashRetentionDays) * HelmDates.dayMs)
        server.purge(serverId)
        server.hasProjects = true
        let unsent = try await repo.add(title: "Unsent", dueDate: nil, dueTime: nil, note: "Keep offline note")
        try await repo.apply(try await remote().snapshot().get())
        #expect(try await repo.task(t) == nil)
        #expect(try await repo.history(serverId).isEmpty)
        #expect(try await repo.pendingOps().allSatisfy { $0.taskLocalId != t })
        #expect(try await repo.task(unsent.localId)?.note == "Keep offline note")
        #expect(try await repo.pendingOps().contains { $0.taskLocalId == unsent.localId && $0.mutation == Mutations.add })
    }

    @Test func missingTasksWithOtherPendingEditsAreNotTreatedAsDeferredOnly() async throws {
        let (repo, engine) = try setUp()
        let p = server.addProjectElsewhere("P")
        let t = server.addElsewhere("T")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        try await repo.setProject(t, p)
        try await repo.setNote(t, "Other pending edit")
        let assignment = try #require(try await repo.next())
        try await repo.reject(assignment, reason: "Task is in the trash")
        clock.advance(Int64(TaskItem.trashRetentionDays) * HelmDates.dayMs)
        server.purge(t)
        let pending = try await repo.pendingOps()
        try await repo.apply(try await remote().snapshot().get())
        #expect(try await repo.task(t)?.note == "Other pending edit")
        #expect(try await repo.pendingOps() == pending)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(try await repo.task(t) == nil)
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test func projectCapabilityObservationTracksUpgradeWithoutDiscardingLocalData() async throws {
        let (repo, engine) = try setUp()
        var support = repo.observeProjectSupport().makeAsyncIterator()
        #expect(try await support.next() == .unknown)
        let p = try await repo.addProject(name: "Offline")
        server.hasProjects = false
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(try await support.next() == .unsupported)
        #expect(try await repo.projectSupport().requirement == "Needs backend 0.13.0 or later")
        #expect(try await repo.projects().map(\.localId) == [p.localId])
        server.hasProjects = true
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        var resumed = try await support.next()
        while resumed != nil && resumed != .supported { resumed = try await support.next() }
        #expect(resumed == .supported)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.project(named: "Offline") != nil)
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test func aRetainedMembershipFollowsItsProjectsDeletionDestinationAfterRestore() async throws {
        let (repo, engine) = try setUp()
        let a = server.addProjectElsewhere("A")
        let b = server.addProjectElsewhere("B")
        let c = server.addProjectElsewhere("C")
        let t = server.addElsewhere("T")
        server.editElsewhere(t, ["projectId": .string(a)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        try await repo.setProject(t, b)
        server.editElsewhere(t, ["deletedAt": .of(clock.now)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        try await repo.deleteProject(b, moveTasksTo: c)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(try await repo.next() == nil)
        let retained = try #require(try await repo.pendingOps().first)
        #expect(JSONValue.decode(retained.argsJson)?["projectId"] == .string(c))
        try await repo.restore(t)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.task(titled: "T")?["projectId"] == .string(c))
        #expect(try await repo.task(t)?.projectLocalId == c)
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
