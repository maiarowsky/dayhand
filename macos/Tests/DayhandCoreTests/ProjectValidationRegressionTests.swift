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
