import Foundation
import Testing
@testable import DayhandCore

extension ProjectSyncTests {
    @Test(arguments: [Mutations.deleteProject, Mutations.add, Mutations.update])
    func retargetingDoesNotPromoteCreationAheadOfEarlierRenamesAndAdditions(mutation: String) async throws {
        let (repo, engine) = try setUp()
        let old = server.addProjectElsewhere("C")
        let a = server.addProjectElsewhere("A")
        let t = server.addElsewhere("T")
        server.editElsewhere(t, ["projectId": .string(a)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        try await repo.updateProject(old, name: "Renamed", color: nil, icon: "", note: "")
        let earlier = try await repo.addProject(name: "Earlier")
        let b = try await repo.addProject(name: "B")
        let taskId: String
        switch mutation {
        case Mutations.deleteProject:
            taskId = t
            try await repo.deleteProject(a, moveTasksTo: b.localId)
        case Mutations.add:
            taskId = try await repo.add(title: "New", dueDate: nil, dueTime: nil, projectLocalId: b.localId).localId
            try await repo.setNote(taskId, "After creation")
        default:
            taskId = t
            try await repo.setProject(t, b.localId)
        }
        let c = try await repo.addProject(name: "C")
        try await repo.deleteProject(b.localId, moveTasksTo: c.localId)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let replacement = try #require(server.project(named: "C"))
        #expect(server.allProjects.first { $0["id"]?.string == old }?["name"] == "Renamed")
        #expect(try #require(server.project(named: "Earlier")?["position"]?.double) < #require(replacement["position"]?.double))
        #expect(try await repo.projects().contains { $0.localId == earlier.localId })
        #expect(try await repo.task(taskId)?.projectLocalId == c.localId)
        #expect(server.task(titled: mutation == Mutations.add ? "New" : "T")?["projectId"] == replacement["id"])
        #expect(try await repo.pendingOps().isEmpty)
        let mutations = sent()
        let renamed = try #require(mutations.firstIndex { $0.0 == Mutations.updateProject && $0.1["name"] == "Renamed" })
        let created = try #require(mutations.firstIndex { $0.0 == Mutations.addProject && $0.1["name"] == "C" })
        let referenced = try #require(mutations.firstIndex { $0.1["projectId"] == replacement["id"] || $0.1["moveTasksTo"] == replacement["id"] })
        #expect(renamed < created && created < referenced)
    }

    @Test(arguments: [(Mutations.update, false), (Mutations.update, true), (Mutations.deleteProject, false), (Mutations.deleteProject, true)], [false, true])
    func retargetingDefersReferencesPastInterveningRenamesAndAdditions(scenario: (String, Bool), unrelated: Bool) async throws {
        let (mutation, refused) = scenario
        let (repo, engine) = try setUp()
        let old = server.addProjectElsewhere("C")
        let a = server.addProjectElsewhere("A")
        let t = server.addElsewhere("T")
        server.editElsewhere(t, ["projectId": .string(a)])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let b = try await repo.addProject(name: "B")
        if refused {
            _ = try await repo.next(markSending: true)
            server.addProjectElsewhere("B")
        }
        if mutation == Mutations.deleteProject { try await repo.deleteProject(a, moveTasksTo: b.localId) }
        else { try await repo.setProject(t, b.localId) }
        try await repo.updateProject(old, name: "Renamed", color: nil, icon: "", note: "")
        if unrelated { try await repo.addProject(name: "Middle") }
        let c = try await repo.addProject(name: "C")
        let fixed = try await repo.pendingOps().filter {
            ($0.mutation == Mutations.addProject && $0.clientId != b.localId) || $0.mutation == Mutations.updateProject
        }
        try await repo.deleteProject(b.localId, moveTasksTo: c.localId)
        if refused {
            #expect(try await OutboxProcessor(store: repo, sender: remote(), maxOps: 1).drain() == .moreLeft)
        }
        let pending = try await repo.pendingOps()
        #expect(pending.filter { $0.mutation == Mutations.addProject || $0.mutation == Mutations.updateProject } == fixed)
        let creation = try #require(pending.firstIndex { $0.mutation == Mutations.addProject && $0.clientId == c.localId })
        #expect(pending[creation + 1].mutation == mutation)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let replacement = try #require(server.project(named: "C"))
        #expect(server.allProjects.first { $0["id"]?.string == old }?["name"] == "Renamed")
        #expect(server.task(titled: "T")?["projectId"] == replacement["id"])
        #expect(try await repo.task(t)?.projectLocalId == c.localId)
        #expect(try await repo.pendingOps().isEmpty)
        let sentProjects = sent().filter {
            (Mutations.projectChanges.contains($0.0) && $0.0 != Mutations.deleteProject) && $0.1["clientId"] != .string(b.localId)
        }
        #expect(sentProjects.map { $0.1["clientId"]?.string } == fixed.map { Optional($0.clientId) })
        if unrelated {
            #expect(try #require(server.project(named: "Middle")?["position"]?.double) < #require(replacement["position"]?.double))
        }
    }

    @Test func retargetingPreservesServerPositionsOfUnrelatedAdditionsBeforeAndAfterTheDestination() async throws {
        let (repo, engine) = try setUp()
        let old = server.addProjectElsewhere("C")
        let t = server.addElsewhere("T")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        try await repo.addProject(name: "Earlier")
        let b = try await repo.addProject(name: "B")
        try await repo.setProject(t, b.localId)
        try await repo.addProject(name: "Middle")
        try await repo.updateProject(old, name: "Renamed", color: nil, icon: "", note: "")
        let c = try await repo.addProject(name: "C")
        try await repo.addProject(name: "Later")
        let before = try await repo.pendingOps()
        let projectOrder = before.filter { Mutations.projectChanges.contains($0.mutation) && $0.clientId != b.localId }.map(\.opId)
        try await repo.deleteProject(b.localId, moveTasksTo: c.localId)
        let pending = try await repo.pendingOps()
        #expect(pending.filter { Mutations.projectChanges.contains($0.mutation) }.map(\.opId) == projectOrder)
        #expect(pending.first { $0.clientId == c.localId } == before.first { $0.clientId == c.localId })
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.allProjects.compactMap { $0["name"]?.string } == ["Renamed", "Earlier", "Middle", "C", "Later"])
        #expect(server.allProjects.compactMap { $0["position"]?.double } == (1...5).map { Double($0) * ProjectRules.positionStep })
        #expect(server.task(titled: "T")?["projectId"] == server.project(named: "C")?["id"])
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test(arguments: [false, true])
    func deferredTaskCreationKeepsEditsTrashRestoreCompletionAndNowChangesOrdered(refused: Bool) async throws {
        let (repo, engine) = try setUp()
        let old = server.addProjectElsewhere("C")
        let other = server.addElsewhere("Unrelated")
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let b = try await repo.addProject(name: "B")
        if refused {
            _ = try await repo.next(markSending: true)
            server.addProjectElsewhere("B")
        }
        let t = try await repo.add(title: "T", dueDate: "2026-10-22", dueTime: nil, projectLocalId: b.localId)
        try await repo.setNote(t.localId, "Before destination")
        try await repo.setNote(other, "Independent edit")
        try await repo.moveToTrash(t.localId)
        try await repo.restore(t.localId)
        try await repo.setNow(t.localId)
        try await repo.setNow(other)
        try await repo.setRepeat(t.localId, RepeatRule(every: .day))
        try await repo.complete(t.localId)
        try await repo.updateProject(old, name: "Renamed", color: nil, icon: "", note: "")
        let c = try await repo.addProject(name: "C")
        let before = try await repo.pendingOps()
        let taskOrder = before.filter { $0.taskLocalId == t.localId }.map(\.opId)
        let independent = try #require(before.first { JSONValue.decode($0.argsJson)?["note"] == "Independent edit" })
        try await repo.deleteProject(b.localId, moveTasksTo: c.localId)
        if refused {
            #expect(try await OutboxProcessor(store: repo, sender: remote(), maxOps: 1).drain() == .moreLeft)
        }
        let pending = try await repo.pendingOps()
        #expect(Array(pending.filter { $0.taskLocalId == t.localId }.prefix(taskOrder.count)).map(\.opId) == taskOrder)
        #expect(pending.first { $0.opId == independent.opId } == independent)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let projectId = try #require(server.project(named: "C")?["id"])
        let occurrences = server.allTasks.filter { $0["title"] == "T" }
        #expect(occurrences.count == 2 && occurrences.allSatisfy { $0["projectId"] == projectId })
        #expect(try await repo.task(t.localId)?.status == .done)
        #expect(try await repo.task(t.localId)?.inTrash == false)
        #expect(try await repo.task(t.localId)?.note == "Before destination")
        #expect(server.task(titled: "Unrelated")?["note"] == "Independent edit")
        #expect(server.task(titled: "Unrelated")?["isNow"] == true)
        #expect(try await repo.pendingOps().isEmpty)
        let mutations = sent()
        let edited = try #require(mutations.firstIndex { $0.1["note"] == "Independent edit" })
        let created = try #require(mutations.firstIndex { $0.0 == Mutations.addProject && $0.1["name"] == "C" })
        #expect(edited < created)
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
