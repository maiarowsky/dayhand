import Testing
@testable import DayhandCore

/// The Android app's `SnapshotMergerTest`, case for case: last write wins per field.
struct SnapshotMergerTests {
    let now: Int64 = 1_000_000

    func remote(_ id: String, _ updatedAt: Int64, _ change: (inout RemoteTask) -> Void = { _ in }) -> RemoteTask {
        var r = RemoteTask(id: id, title: "Server \(id)", dueDate: "2026-10-22", createdAt: 1, updatedAt: updatedAt)
        change(&r)
        return r
    }

    func row(_ localId: String, _ serverId: String?, _ serverUpdatedAt: Int64?, _ change: (inout TaskItem) -> Void = { _ in }) -> TaskItem {
        var t = TaskItem(
            localId: localId, serverId: serverId, clientId: localId, title: "Local \(localId)", dueDate: "2026-10-22",
            createdAt: 1, updatedAt: now, serverUpdatedAt: serverUpdatedAt
        )
        change(&t)
        return t
    }

    func op(_ mutation: String, _ localId: String?, _ args: String = "{}", opId: String? = nil) -> OutboxOp {
        OutboxOp(opId: opId ?? "op-\(mutation)-\(localId ?? "")", mutation: mutation, argsJson: args, taskLocalId: localId, clientId: "c", createdAt: 0)
    }

    func single(_ plan: MergePlan) throws -> TaskItem {
        try #require(plan.upserts.count == 1)
        return plan.upserts[0]
    }

    @Test func aTaskCreatedElsewhereIsInsertedUnderItsServerId() throws {
        let task = try single(SnapshotMerger.merge(local: [], pending: [], remote: [remote("s1", 10)], nowMs: now))
        #expect(task.localId == "s1")
        #expect(task.serverId == "s1")
        #expect(task.serverUpdatedAt == 10)
    }

    @Test func aTaskCreatedHereIsMatchedByItsClientIdBeforeTheAddWasAcknowledged() throws {
        let local = row("local-1", nil, nil)
        let server = remote("s9", 10) { $0.clientId = "local-1"; $0.title = "Local local-1" }
        let plan = SnapshotMerger.merge(local: [local], pending: [op(Mutations.add, "local-1")], remote: [server], nowMs: now)
        let merged = try single(plan)
        #expect(merged.localId == "local-1")
        #expect(merged.serverId == "s9")
        #expect(plan.deletes.isEmpty)
    }

    @Test func fieldsWithAChangeStillWaitingKeepTheLocalValue() throws {
        let local = row("a", "s1", 10) { $0.status = .done; $0.completedAt = 500 }
        let server = remote("s1", 20) { $0.title = "Renamed by the agent"; $0.dueDate = "2026-10-24" }
        let merged = try single(SnapshotMerger.merge(local: [local], pending: [op(Mutations.complete, "a")], remote: [server], nowMs: now))
        #expect(merged.status == .done)
        #expect(merged.completedAt == 500)
        #expect(merged.title == "Renamed by the agent")
        #expect(merged.dueDate == "2026-10-24")
        #expect(merged.serverUpdatedAt == 20)
    }

    @Test func withoutWaitingChangesTheNewerServerCopyWins() throws {
        let local = row("a", "s1", 10) { $0.dueDate = "2026-10-23" }
        let merged = try single(SnapshotMerger.merge(local: [local], pending: [], remote: [remote("s1", 30)], nowMs: now))
        #expect(merged.dueDate == "2026-10-22")
        #expect(merged.title == "Server s1")
    }

    @Test func anOlderOrRepeatedSnapshotNeverUndoesANewerState() {
        let local = row("a", "s1", 30) { $0.title = "Newest" }
        let plan = SnapshotMerger.merge(local: [local], pending: [], remote: [remote("s1", 20)], nowMs: now)
        #expect(plan.upserts.isEmpty)
        #expect(plan.deletes.isEmpty)
    }

    @Test func aWaitingSetNowKeepsTheNowFlagOfEveryTask() throws {
        let target = row("a", "s1", 10) { $0.isNow = true; $0.status = .doing }
        let previous = row("b", "s2", 10)
        let server = [remote("s1", 10), remote("s2", 20) { $0.isNow = true; $0.title = "Agent edit" }]
        let plan = SnapshotMerger.merge(local: [target, previous], pending: [op(Mutations.setNow, "a")], remote: server, nowMs: now)
        let b = try #require(plan.upserts.first { $0.localId == "b" })
        #expect(b.isNow == false)
        #expect(b.title == "Agent edit")
    }

    @Test func anUpdateOfTheResumeNoteKeepsOnlyThatFieldLocal() throws {
        let local = row("a", "s1", 10) { $0.resumeNote = "page 4" }
        let server = remote("s1", 20) { $0.resumeNote = "page 3"; $0.title = "New title" }
        let pending = op(Mutations.update, "a", #"{"resumeNote":"page 4","clientId":"c"}"#)
        let merged = try single(SnapshotMerger.merge(local: [local], pending: [pending], remote: [server], nowMs: now))
        #expect(merged.resumeNote == "page 4")
        #expect(merged.title == "New title")
    }

    @Test func aTaskGoneFromTheServerIsDeletedUnlessItHasWaitingChangesOrIsTooFresh() {
        let gone = row("gone", "s1", 10)
        let waiting = row("waiting", "s2", 10)
        let justAcked = row("fresh", "s3", nil) { $0.updatedAt = now - 1_000 }
        let orphan = row("orphan", nil, nil) { $0.updatedAt = now - SnapshotMerger.unseenGraceMs - 1 }
        let plan = SnapshotMerger.merge(
            local: [gone, waiting, justAcked, orphan], pending: [op(Mutations.archive, "waiting")], remote: [], nowMs: now
        )
        #expect(Set(plan.deletes) == ["gone", "orphan"])
    }

    @Test func repeatLinksAndTheTrashComeFromTheServer() throws {
        let server = remote("s1", 10) {
            $0.repeat = RepeatRule(every: .week, weekdays: [1, 4])
            $0.links = [TaskLink(url: "https://example.com", title: "Spec")]
            $0.deletedAt = 7
        }
        let task = try single(SnapshotMerger.merge(local: [], pending: [], remote: [server], nowMs: now))
        #expect(task.repeat == RepeatRule(every: .week, weekdays: [1, 4]))
        #expect(task.links == [TaskLink(url: "https://example.com", title: "Spec")])
        #expect(task.deletedAt == 7)
    }

    @Test func aWaitingLinksChangeKeepsTheLinksLocalAndOnlyThem() throws {
        let local = row("a", "s1", 10) { $0.links = [TaskLink(url: "https://mine.example")]; $0.title = "Old" }
        let server = remote("s1", 20) { $0.links = [TaskLink(url: "https://agent.example")]; $0.title = "Renamed"; $0.note = "agent note" }
        let pending = op(Mutations.update, "a", #"{"links":[{"url":"https://mine.example"}],"clientId":"c"}"#)
        let merged = try single(SnapshotMerger.merge(local: [local], pending: [pending], remote: [server], nowMs: now))
        #expect(merged.links == [TaskLink(url: "https://mine.example")])
        #expect(merged.title == "Renamed")
        #expect(merged.note == "agent note")
    }

    @Test func aLabelsChangeQueuedBeforeLabelsWentHoldsBackNoField() throws {
        let local = row("a", "s1", 10) { $0.title = "Old" }
        let server = remote("s1", 20) { $0.title = "Renamed" }
        let pending = op(Mutations.update, "a", #"{"labels":["mine"],"clientId":"c"}"#)
        let merged = try single(SnapshotMerger.merge(local: [local], pending: [pending], remote: [server], nowMs: now))
        #expect(merged.title == "Renamed")
    }

    @Test func aWaitingTitleChangeDoesNotHoldBackTheAgentsNote() throws {
        let local = row("a", "s1", 10) { $0.title = "Mine"; $0.note = "old note" }
        let server = remote("s1", 20) { $0.title = "Agent title"; $0.note = "agent note" }
        let pending = op(Mutations.update, "a", #"{"title":"Mine","clientId":"c"}"#)
        let merged = try single(SnapshotMerger.merge(local: [local], pending: [pending], remote: [server], nowMs: now))
        #expect(merged.title == "Mine")
        #expect(merged.note == "agent note")
    }

    @Test func waitingRepeatAndLinkChangesStayLocal() throws {
        let local = row("a", "s1", 10) { $0.repeat = RepeatRule(every: .day); $0.links = [TaskLink(url: "https://mine.pl")] }
        let pending = [
            op(Mutations.update, "a", #"{"repeat":{"every":"day","interval":1},"clientId":"c"}"#),
            op(Mutations.update, "a", #"{"links":[{"url":"https://mine.pl"}],"clientId":"d"}"#, opId: "op2"),
        ]
        let merged = try single(SnapshotMerger.merge(local: [local], pending: pending, remote: [remote("s1", 20)], nowMs: now))
        #expect(merged.repeat == RepeatRule(every: .day))
        #expect(merged.links == [TaskLink(url: "https://mine.pl")])
    }

    @Test func theChecklistAndRemindersComeFromTheServerUnlessAChangeOfThemIsWaiting() throws {
        let local = row("a", "s1", 10) {
            $0.checklist = [ChecklistItem(id: "c1", title: "Milk", done: true)]
            $0.reminders = [.before(5)]
        }
        let server = remote("s1", 20) {
            $0.title = "Agent title"
            $0.checklist = [ChecklistItem(id: "c1", title: "Milk"), ChecklistItem(id: "c2", title: "Bread")]
            $0.reminders = nil
        }
        let taken = try single(SnapshotMerger.merge(local: [local], pending: [], remote: [server], nowMs: now))
        #expect(taken.checklist == server.checklist)
        #expect(taken.reminders == nil)

        let pending = [
            op(Mutations.update, "a", #"{"checklist":[{"id":"c1","title":"Milk","done":true}],"clientId":"c"}"#),
            op(Mutations.update, "a", #"{"reminders":[{"minutesBefore":5}],"clientId":"d"}"#, opId: "op2"),
        ]
        let kept = try single(SnapshotMerger.merge(local: [local], pending: pending, remote: [server], nowMs: now))
        #expect(kept.checklist == local.checklist)
        #expect(kept.reminders == local.reminders)
        #expect(kept.title == "Agent title")
    }

    @Test func aTaskMovedToTheTrashOfflineStaysThereUntilTheServerAgrees() throws {
        let local = row("a", "s1", 10) { $0.deletedAt = 500 }
        let merged = try single(SnapshotMerger.merge(local: [local], pending: [op(Mutations.softDelete, "a")], remote: [remote("s1", 20)], nowMs: now))
        #expect(merged.deletedAt == 500)
    }

    @Test func aTaskRestoredOfflineIsNotPutBackInTheTrashByAnOlderServerCopy() throws {
        let local = row("a", "s1", 10)
        let server = remote("s1", 20) { $0.deletedAt = 400; $0.title = "Agent edit" }
        let merged = try single(SnapshotMerger.merge(local: [local], pending: [op(Mutations.restore, "a")], remote: [server], nowMs: now))
        #expect(merged.deletedAt == nil)
        #expect(merged.title == "Agent edit")
    }

    @Test func aTaskTrashedByTheAgentStaysInTheTrash() throws {
        let plan = SnapshotMerger.merge(local: [row("a", "s1", 10)], pending: [], remote: [remote("s1", 20) { $0.deletedAt = 15 }], nowMs: now)
        #expect(try single(plan).deletedAt == 15)
        #expect(plan.deletes.isEmpty)
    }
}
