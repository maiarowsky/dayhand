import Foundation
import Testing
@testable import DayhandCore

/**
 * Projects against a real local backend (never production). With a backend that has projects (0.13.0 or later) a
 * project is made, edited, archived and deleted online, project calls fail offline without queuing anything, and tasks
 * put in the project offline reach the server with its id once the Mac is back. With an older one (0.12.x) project
 * calls report the requirement and tasks still sync. Off unless these are set:
 *
 *     DAYHAND_LIVE_SITE=http://127.0.0.1:3211      # the HTTP actions URL
 *     DAYHAND_LIVE_PROJECTS_CODE=XXXX-XXXX-XXXX    # from dayhand pair, used once
 *     DAYHAND_LIVE_PROJECTS=yes                    # yes: the backend has projects; no: it does not
 */
@Suite(.enabled(if: LiveBackend.site != nil && LiveProjects.code != nil), .serialized)
struct LiveProjectsTests {
    @Test func projectsAreManagedOnlineAndTasksGoIntoThemOffline() async throws {
        let site = try #require(LiveBackend.site), code = try #require(LiveProjects.code)
        let credential = try await DevicePairing(api: PairingAPI(), store: MemoryCredentialStore())
            .connect(address: site, code: code, deviceName: "Dayhand E2E projects").get()
        let transport = SwitchableTransport()
        let tokens = DeviceTokens(
            serverUrl: credential.serverUrl, deviceToken: credential.deviceToken, api: PairingAPI(transport: transport), onRevoked: {}
        )
        let remote = ConvexRemote(deploymentUrl: credential.convexUrl, tokens: tokens, transport: transport)
        let check = ConvexRemote(deploymentUrl: credential.convexUrl, tokens: tokens)
        let repo = TaskRepository(database: try AppDatabase.inMemory())
        let engine = SyncEngine(repository: repo, sender: remote, source: remote, onStatus: { _ in })
        let run = String(Clock.nowMs() % 100_000)

        guard LiveProjects.serverHasProjects else {
            await #expect(throws: RepositoryError.invalid("Needs backend 0.13.0 or later")) {
                try await engine.addProject(name: "E2E \(run) Dom")
            }
            #expect(try await repo.projectSupport() == .unsupported)
            transport.offline = true
            let t = try await repo.add(title: "E2E \(run) on an old server", dueDate: nil, dueTime: nil)
            guard case .offline = await engine.round() else { Issue.record("expected offline"); return }
            transport.offline = false
            guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
            let snapshot = try await check.snapshot().get()
            #expect(snapshot.projects == nil)
            #expect(snapshot.tasks.first { $0.title == "E2E \(run) on an old server" }?.id == (try await repo.task(t.localId)?.serverId))
            #expect(try await repo.projects().isEmpty)
            #expect(try await repo.pendingOps().isEmpty)
            return
        }

        // Online: the project is on the server as soon as the call returns.
        let bakery = try await engine.addProject(name: "E2E \(run) Strona piekarni", color: .amber, icon: "🥐", note: "Menu")
        let projectId = try #require(bakery.serverId)
        let made = try #require(try await check.snapshot().get().projects?.first { $0.id == projectId })
        #expect(made.name == "E2E \(run) Strona piekarni" && made.color == .amber && made.icon == "🥐" && made.note == "Menu")
        #expect(made.clientId == bakery.localId)

        // Offline: project calls fail and queue nothing; tasks go into the project and wait in the outbox.
        transport.offline = true
        await #expect(throws: RepositoryError.needsConnection) {
            try await engine.updateProject(bakery.localId, name: "E2E \(run) offline", color: nil, icon: "", note: "")
        }
        let inIt = try await repo.add(title: "E2E \(run) photos", dueDate: nil, dueTime: nil, projectLocalId: bakery.localId)
        let line = QuickAdd.parse("E2E \(run) invoice fri +e2e-\(run)-strona-piekarni", now: Clock.nowMs(), timezone: "Europe/Warsaw", projects: try await repo.projects())
        #expect(line.projectLocalId == bakery.localId)
        let typed = try await repo.add(title: line.title, dueDate: line.when?.date, dueTime: nil, projectLocalId: line.projectLocalId)
        #expect(try await repo.pendingOps().map(\.mutation) == [Mutations.add, Mutations.add])
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }

        transport.offline = false
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let snapshot = try await check.snapshot().get()
        let photos = try #require(snapshot.tasks.first { $0.title == "E2E \(run) photos" })
        let invoice = try #require(snapshot.tasks.first { $0.title == line.title })
        #expect(photos.projectId == projectId && invoice.projectId == projectId)
        #expect(try await repo.projectSupport() == .supported)
        #expect(try await repo.pendingOps().isEmpty)

        // Edits, archive and the deletion online, the tasks moved out of any project.
        try await engine.updateProject(bakery.localId, name: "E2E \(run) Bakery", color: .teal, icon: "", note: "")
        try await engine.setArchived(bakery.localId, true)
        let edited = try #require(try await check.snapshot().get().projects?.first { $0.id == projectId })
        #expect(edited.name == "E2E \(run) Bakery" && edited.color == .teal && edited.icon == nil && edited.archivedAt != nil)
        let row = try #require(try await repo.projects().first { $0.localId == bakery.localId })
        #expect(row.name == edited.name && row.isArchived)

        try await engine.deleteProject(bakery.localId, moveTasksTo: nil)
        let after = try await check.snapshot().get()
        #expect(after.projects?.contains { $0.id == projectId } == false)
        #expect(after.tasks.first { $0.id == photos.id }?.projectId == nil)
        #expect(try await repo.projects().contains { $0.localId == bakery.localId } == false)
        #expect(try await repo.task(inIt.localId)?.projectLocalId == nil)
        #expect(try await repo.task(typed.localId)?.projectLocalId == nil)
        guard case .synced = await engine.round() else { Issue.record("expected synced after the deletion"); return }
        #expect(try await repo.task(inIt.localId)?.projectLocalId == nil)
        #expect(try await repo.pendingOps().isEmpty)
    }
}

enum LiveProjects {
    static let code = ProcessInfo.processInfo.environment["DAYHAND_LIVE_PROJECTS_CODE"]
    static let serverHasProjects = ProcessInfo.processInfo.environment["DAYHAND_LIVE_PROJECTS"] != "no"
}
