import Foundation
import GRDB
import Testing
@testable import DayhandCore

/// A repository and a sync engine against a fake server, as `TaskHistorySyncTests` makes them.
private func connected(_ server: FakeServer, _ clock: TestClock) throws -> (TaskRepository, SyncEngine, ConvexRemote) {
    let ids = TestIds()
    server.clock = { clock.now }
    let repo = TaskRepository(database: try AppDatabase.inMemory(), clock: { clock.now }, newId: { ids.next() })
    let tokens = DeviceTokens(
        serverUrl: FakeServer.site, deviceToken: FakeServer.deviceToken, api: PairingAPI(transport: server),
        onRevoked: {}, clock: { clock.now }
    )
    let remote = ConvexRemote(deploymentUrl: FakeServer.cloud, tokens: tokens, transport: server)
    return (repo, SyncEngine(repository: repo, sender: remote, source: remote, onStatus: { _ in }), remote)
}

/// The agent fields of a task, as `dayhand` or an agent through MCP sets them.
private let agentFields: [String: JSONValue] = [
    "acceptance": [["id": "a1", "text": "Tests pass", "met": true], ["id": "a2", "text": "Docs updated", "met": false]],
    "plan": "Fix the parser, then the docs",
    "proof": ["summary": "All green", "links": [["url": "https://ci.example/1", "title": "CI"]], "checks": [["name": "unit", "result": "pass"], ["name": "lint", "result": "fail", "url": "https://ci.example/2"]]],
    "blockedReason": "Waiting for the API key",
    "claimedBy": ["keyId": "k1", "name": "claude"],
    "claimExpiresAt": 1_800_000_900_000,
]

struct AgentFieldTests {
    @Test func theSnapshotsAgentFieldsAreRead() throws {
        let json = try #require(JSONValue.decode(#"""
        {"id":"s2","ref":12.0,"title":"Ship","status":"doing","isNow":false,"createdAt":1.0,"updatedAt":2.0,"links":[],
         "acceptance":[{"id":"a1","text":"Tests pass","met":true},{"id":"a2","text":"Docs","met":false}],
         "plan":"Step by step","proof":{"summary":"Done","checks":[{"name":"unit","result":"pass"}]},
         "dependsOn":["s1"],"blockedReason":"No key","claimedBy":{"keyId":"k1","name":"claude"},"claimExpiresAt":1800000900000.0}
        """#))
        let task = try #require(RemoteJSON.task(json))
        #expect(task.ref == 12)
        #expect(task.acceptance == [AcceptanceItem(id: "a1", text: "Tests pass", met: true), AcceptanceItem(id: "a2", text: "Docs")])
        #expect(task.plan == "Step by step")
        #expect(task.proof == TaskProof(summary: "Done", checks: [ProofCheck(name: "unit", result: "pass")]))
        #expect(task.dependsOn == ["s1"])
        #expect(task.blockedReason == "No key")
        #expect(task.claimedBy == "claude")
        #expect(task.claimExpiresAt == 1_800_000_900_000)
    }

    @Test func aTaskWithoutAgentWorkHasNone() throws {
        let task = try #require(RemoteJSON.task(["id": "s1", "title": "Milk", "createdAt": 1, "updatedAt": 1]))
        let item = SnapshotMerger.merge(local: [], pending: [], remote: [task], nowMs: 0).upserts[0]
        #expect(!item.hasAgentWork)
        #expect(item.acceptance.isEmpty && item.dependsOn.isEmpty && item.proof == nil && item.claimedBy == nil)
    }

    @Test func agentFieldsAlwaysTakeTheServersCopyEvenWithALocalChangeWaiting() throws {
        let local = task("t", updated: 5) {
            $0.serverId = "s1"
            $0.serverUpdatedAt = 5
            $0.plan = "old plan"
        }
        let pending = OutboxOp(opId: "o1", mutation: Mutations.update, argsJson: #"{"title":"Mine","clientId":"o1"}"#, taskLocalId: "t", clientId: "o1", createdAt: 6)
        let remote = RemoteTask(id: "s1", title: "Theirs", createdAt: 0, updatedAt: 9, plan: "new plan", blockedReason: "No key", claimedBy: "claude")
        let merged = SnapshotMerger.merge(local: [local], pending: [pending], remote: [remote], nowMs: 10).upserts[0]
        #expect(merged.title == "t")
        #expect(merged.plan == "new plan")
        #expect(merged.blockedReason == "No key")
        #expect(merged.claimedBy == "claude")
    }

    /// The database of 0.3.0 before this change (migrations v1 and v2) moves on without losing a task.
    @Test func theMigrationKeepsOlderTasksAndStoresTheAgentFields() async throws {
        let queue = try DatabaseQueue()
        let fresh = try AppDatabase.inMemory()
        try fresh.migrator.migrate(queue, upTo: "v2")
        try await queue.write { db in
            try db.execute(sql: """
                INSERT INTO task (localId, serverId, title, status, createdAt, updatedAt, serverUpdatedAt, labels, links, checklist)
                VALUES ('old', 's1', 'From 0.2', 'todo', 1, 2, 2, '["home"]', '[]', '[]')
                """)
        }
        let database = try AppDatabase(queue)
        let repo = TaskRepository(database: database)
        let old = try #require(try await repo.task("old"))
        #expect(old.title == "From 0.2")
        #expect(old.serverUpdatedAt == nil)
        #expect(old.ref == nil && old.acceptance.isEmpty && old.dependsOn.isEmpty && old.plan == nil && old.claimedBy == nil)

        try await repo.apply(Snapshot(tasks: [RemoteTask(
            id: "s1", title: "From 0.2", createdAt: 1, updatedAt: 2, ref: 7,
            acceptance: [AcceptanceItem(id: "a1", text: "Tests pass", met: true)], plan: "Plan",
            proof: TaskProof(summary: "Green", links: [TaskLink(url: "https://ci.example")], checks: [ProofCheck(name: "unit", result: "fail")]),
            dependsOn: ["s0"], blockedReason: "No key", claimedBy: "claude", claimExpiresAt: 99
        )]))
        let stored = try #require(try await repo.task("old"))
        #expect(stored.serverUpdatedAt == 2)
        #expect(stored.ref == 7)
        #expect(stored.acceptance == [AcceptanceItem(id: "a1", text: "Tests pass", met: true)])
        #expect(stored.plan == "Plan")
        #expect(stored.proof?.checks == [ProofCheck(name: "unit", result: "fail")])
        #expect(stored.proof?.links == [TaskLink(url: "https://ci.example")])
        #expect(stored.dependsOn == ["s0"])
        #expect(stored.blockedReason == "No key")
        #expect(stored.claimedBy == "claude" && stored.claimExpiresAt == 99)
        let columns = try await queue.read { db in try db.columns(in: "task").map(\.name) }
        #expect(Set(["ref", "acceptance", "plan", "proof", "dependsOn", "blockedReason", "claimedBy", "claimExpiresAt"]).isSubset(of: Set(columns)))
    }

    @Test func agentWorkSetElsewhereReachesTheMacAndStaysOffline() async throws {
        let clock = TestClock(utc("2026-10-22T09:00"))
        let server = FakeServer()
        let (repo, engine, _) = try connected(server, clock)
        let first = server.addElsewhere("Send the invoice")
        let id = server.addElsewhere("Ship the release")
        var fields = agentFields
        fields["dependsOn"] = [.string(first)]
        server.editElsewhere(id, fields)
        await engine.round()

        server.offline = true
        #expect(await engine.round() != .synced(at: clock.now))
        let shipped = try #require(try await repo.allTasks().first { $0.serverId == id })
        #expect(shipped.ref == 2)
        #expect(shipped.acceptance.map(\.met) == [true, false])
        #expect(shipped.plan == "Fix the parser, then the docs")
        #expect(shipped.proof?.summary == "All green")
        #expect(shipped.proof?.checks.map(\.passed) == [true, false])
        #expect(shipped.dependsOn == [first])
        #expect(shipped.blockedReason == "Waiting for the API key")
        #expect(shipped.claimedBy == "claude")
        #expect(shipped.claimExpiresAt == 1_800_000_900_000)
        #expect(shipped.hasAgentWork)
    }
}

struct PlanHealthTests {
    static let report: JSONValue = [
        "at": 1_800_000_000_000, "date": "2026-10-22", "timezone": "Europe/London", "agentsPaused": false,
        "overdue": ["count": 2, "tasks": []], "dueToday": ["count": 3, "tasks": []], "inProgress": ["count": 1, "tasks": []],
        "expiredClaims": ["count": 0, "tasks": []], "blocked": ["count": 1, "tasks": []],
        "awaitingApproval": ["count": 1, "tasks": [], "pendingApprovals": 2], "proposals": ["count": 4],
        "completedToday": ["count": 5, "tasks": [], "withProof": 4, "withoutProof": 1],
        "oldestOpen": ["id": "s1", "title": "Old", "createdAt": 1, "ageDays": 20],
    ]

    @Test func theReportIsReadWithNumbersAsDoubles() throws {
        let health = try #require(PlanHealth.parse(Self.report))
        #expect(health == PlanHealth(
            at: 1_800_000_000_000, overdue: 2, dueToday: 3, inProgress: 1, blocked: 1, pendingApprovals: 2, proposals: 4,
            completedToday: 5, withoutProof: 1, oldestOpenDays: 20
        ))
        #expect(PlanHealth.parse(["approvals": []]) == nil)
        #expect(PlanHealth.parse(["at": 1, "oldestOpen": .null])?.oldestOpenDays == nil)
    }

    @Test func theCardSaysOnlyWhatIsThereMostPressingFirst() throws {
        let health = try #require(PlanHealth.parse(Self.report))
        let items = HealthSummary.items(health)
        #expect(items.map(\.kind) == [.overdue, .approvals, .blocked, .proposals, .withoutProof, .dueToday, .inProgress, .doneToday, .oldestOpen])
        #expect(items.first == HealthItem(kind: .overdue, count: 2))
        #expect(HealthSummary.tone(items) == .act)
        #expect(HealthSummary.needsOwner(items))
    }

    @Test func theToneAndReviewFollowTheAndroidApp() {
        #expect(HealthSummary.items(PlanHealth()).isEmpty)
        #expect(HealthSummary.tone([]) == .calm)
        let paused = HealthSummary.items(PlanHealth(agentsPaused: true))
        #expect(paused == [HealthItem(kind: .paused, count: 1)])
        #expect(HealthSummary.tone(paused) == .act && HealthSummary.needsOwner(paused))
        let blocked = HealthSummary.items(PlanHealth(blocked: 1, oldestOpenDays: 13))
        #expect(blocked.map(\.kind) == [.blocked])
        #expect(HealthSummary.tone(blocked) == .look && !HealthSummary.needsOwner(blocked))
        let calm = HealthSummary.items(PlanHealth(dueToday: 2, completedToday: 1))
        #expect(HealthSummary.tone(calm) == .calm && !HealthSummary.needsOwner(calm))
    }

    @Test func theLastReportIsKeptOfflineAndGoesWithDisconnect() async throws {
        let clock = TestClock(utc("2026-10-22T09:00"))
        let server = FakeServer()
        server.planHealth = Self.report
        let (repo, _, remote) = try connected(server, clock)
        let sync = PlanHealthSync(repository: repo, runner: { remote })
        #expect(try await repo.planHealth() == nil)

        #expect(await sync.refresh() == .fresh)
        #expect(try await repo.planHealth()?.overdue == 2)
        #expect(server.requests.contains { $0.body["path"] == "app:planHealth" })

        server.offline = true
        #expect(await sync.refresh() == .kept)
        #expect(try await repo.planHealth()?.proposals == 4)

        server.offline = false
        server.planHealth = ["status": "not a report"]
        #expect(await sync.refresh() == .kept)
        #expect(try await repo.planHealth()?.proposals == 4)

        #expect(await PlanHealthSync(repository: repo, runner: { nil }).refresh() == .noServer)
        try await repo.forgetPlanHealth()
        #expect(try await repo.planHealth() == nil)
    }

    @Test func reviewListsTheWaitingRequestsAndProposals() async throws {
        let clock = TestClock(utc("2026-10-22T09:00"))
        let server = FakeServer()
        server.approvals = [[
            "id": "ap1", "taskId": "s3", "ref": 3, "taskTitle": "Deploy", "action": "Deploy to production",
            "detail": "Version 1.2", "options": [["id": "o1", "label": "Allow", "consequence": .null], ["id": "o2", "label": "Deny"]],
            "status": "pending", "expiresAt": 1_800_000_600_000, "requestedBy": ["type": "agent", "name": "claude"],
        ]]
        server.proposals = [[
            "id": "s9", "ref": 9, "title": "Renew the domain", "status": "todo", "isNow": false, "links": [],
            "createdAt": 1, "updatedAt": 1, "proposedAt": 1, "requestedBy": "sentry", "dueDate": "2026-10-30",
        ]]
        let (_, _, remote) = try connected(server, clock)
        let inbox = try await AgentInbox.load(remote).get()
        #expect(inbox.approvals == [ApprovalRequest(
            id: "ap1", action: "Deploy to production", detail: "Version 1.2", taskRef: 3, taskTitle: "Deploy",
            requestedBy: "claude", options: ["Allow", "Deny"], expiresAt: 1_800_000_600_000
        )])
        #expect(inbox.proposals == [Proposal(id: "s9", ref: 9, title: "Renew the domain", dueDate: "2026-10-30", requestedBy: "sentry")])
        let asked = server.requests.first { $0.body["path"] == "app:listApprovals" }
        #expect(asked?.body["args"]?.array?.first?["status"] == "pending")
        #expect(server.mutationsSent().isEmpty)

        server.offline = true
        guard case .failure(.failed) = await AgentInbox.load(remote) else { Issue.record("expected a failure offline"); return }
        guard case .failure(.noServer) = await AgentInbox.load(nil) else { Issue.record("expected no server"); return }
    }
}
