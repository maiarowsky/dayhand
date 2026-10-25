import Foundation
import Testing
@testable import DayhandCore

/**
 * Projects against a real local backend (never production): a project and tasks in it written offline, then synced.
 * With a backend that has projects (0.13.0 or later) they arrive in order with the server's ids, and changes and the
 * deletion follow; with an older one (0.12.x) the tasks arrive without their project, the projects go from the Mac
 * and nothing waits or loops. Off unless these are set:
 *
 *     DAYHAND_LIVE_SITE=http://127.0.0.1:3211      # the HTTP actions URL
 *     DAYHAND_LIVE_PROJECTS_CODE=XXXX-XXXX-XXXX    # from dayhand pair, used once
 *     DAYHAND_LIVE_PROJECTS=yes                    # yes: the backend has projects; no: it does not
 */
@Suite(.enabled(if: LiveBackend.site != nil && LiveProjects.code != nil), .serialized)
struct LiveProjectsTests {
    @Test func projectsWrittenOfflineSyncWithTheServerOrStayOutOfAnOldOne() async throws {
        let site = try #require(LiveBackend.site), code = try #require(LiveProjects.code)
        let credential = try await DevicePairing(api: PairingAPI(), store: MemoryCredentialStore())
            .connect(address: site, code: code, deviceName: "Dayhand E2E projects").get()
        let transport = SwitchableTransport()
        let tokens = DeviceTokens(
            serverUrl: credential.serverUrl, deviceToken: credential.deviceToken, api: PairingAPI(transport: transport), onRevoked: {}
        )
        let remote = ConvexRemote(deploymentUrl: credential.convexUrl, tokens: tokens, transport: transport)
        let repo = TaskRepository(database: try AppDatabase.inMemory())
        let engine = SyncEngine(repository: repo, sender: remote, source: remote, onStatus: { _ in })
        let run = String(Clock.nowMs() % 100_000)

        transport.offline = true
        let bakery = try await repo.addProject(name: "E2E \(run) Strona piekarni", color: .amber, icon: "🥐", note: "Menu")
        let inIt = try await repo.add(title: "E2E \(run) photos", dueDate: nil, dueTime: nil, projectLocalId: bakery.localId)
        let line = QuickAdd.parse("E2E \(run) invoice fri +e2e-\(run)-strona-piekarni", now: Clock.nowMs(), timezone: "Europe/Warsaw", projects: try await repo.projects())
        #expect(line.projectLocalId == bakery.localId)
        let typed = try await repo.add(title: line.title, dueDate: line.when?.date, dueTime: nil, projectLocalId: line.projectLocalId)
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }

        transport.offline = false
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(try await repo.pendingOps().isEmpty)
        let check = ConvexRemote(deploymentUrl: credential.convexUrl, tokens: tokens)
        let snapshot = try await check.snapshot().get()
        let onServer = { (title: String) in snapshot.tasks.first { $0.title == title } }
        let photos = try #require(onServer("E2E \(run) photos"))
        let invoice = try #require(onServer(line.title))

        guard LiveProjects.serverHasProjects else {
            #expect(snapshot.projects == nil)
            #expect(try await repo.projectSupport() == .unsupported)
            #expect(photos.projectId == nil && invoice.projectId == nil)
            #expect(try await repo.projects().isEmpty)
            #expect(try await repo.task(inIt.localId)?.serverId == photos.id)
            guard case .synced = await engine.round() else { Issue.record("expected synced again"); return }
            #expect(try await repo.pendingOps().isEmpty)
            return
        }
        #expect(try await repo.projectSupport() == .supported)
        let project = try #require(snapshot.projects?.first { $0.name == "E2E \(run) Strona piekarni" })
        #expect(project.color == .amber && project.icon == "🥐" && project.note == "Menu" && project.clientId == bakery.localId)
        #expect(photos.projectId == project.id && invoice.projectId == project.id)
        #expect(try await repo.projects().first { $0.localId == bakery.localId }?.serverId == project.id)
        #expect(try await repo.task(typed.localId)?.projectLocalId == bakery.localId)

        // Changes from the Mac, then the deletion with the tasks moved out of any project.
        try await repo.updateProject(bakery.localId, name: "E2E \(run) Bakery", color: .teal, icon: "", note: "")
        try await repo.setArchived(bakery.localId, true)
        guard case .synced = await engine.round() else { Issue.record("expected synced after the edit"); return }
        let edited = try #require(try await check.snapshot().get().projects?.first { $0.id == project.id })
        #expect(edited.name == "E2E \(run) Bakery" && edited.color == .teal && edited.icon == nil && edited.archivedAt != nil)

        try await repo.deleteProject(bakery.localId, moveTasksTo: nil)
        guard case .synced = await engine.round() else { Issue.record("expected synced after the deletion"); return }
        let after = try await check.snapshot().get()
        #expect(after.projects?.contains { $0.id == project.id } == false)
        #expect(after.tasks.first { $0.id == photos.id }?.projectId == nil)
        #expect(try await repo.projects().contains { $0.localId == bakery.localId } == false)
        #expect(try await repo.task(inIt.localId)?.projectLocalId == nil)
        #expect(try await repo.pendingOps().isEmpty)
    }
}

enum LiveProjects {
    static let code = ProcessInfo.processInfo.environment["DAYHAND_LIVE_PROJECTS_CODE"]
    static let serverHasProjects = ProcessInfo.processInfo.environment["DAYHAND_LIVE_PROJECTS"] != "no"
}
