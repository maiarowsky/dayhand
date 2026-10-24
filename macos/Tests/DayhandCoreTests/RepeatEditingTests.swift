import Foundation
import Testing
@testable import DayhandCore

/// The repeat editor's choices make the rules the Android app's `RepeatDialog` makes, and only valid ones.
struct RepeatDraftTests {
    @Test func noChoiceIsNoRule() {
        let draft = RepeatDraft(nil)
        #expect(draft.every == nil)
        #expect(draft.rule == nil)
        #expect(draft.isValid)
        #expect(draft.end == .never)
        #expect(draft.count == RepeatDraft.defaultCount)
    }

    @Test func everyRuleOpensAsItIsAndSavesUnchanged() {
        let rules = [
            RepeatRule(every: .day, interval: 3),
            RepeatRule(every: .week, interval: 2, weekdays: [1, 4]),
            RepeatRule(every: .month, monthDay: -1, count: 5),
            RepeatRule(every: .month, from: .completion, weekdayOfMonth: WeekdayOfMonth(nth: -1, weekday: 5)),
            RepeatRule(every: .month, monthDay: 15, until: "2027-06-30"),
            RepeatRule(every: .year),
        ]
        for rule in rules { #expect(RepeatDraft(rule).rule == rule) }
    }

    @Test func weekdaysCountOnlyForWeeksAndNoneMeansTheDueDatesWeekday() {
        var draft = RepeatDraft(nil)
        draft.every = .week
        #expect(draft.rule == RepeatRule(every: .week))
        draft.weekdays = [7, 1]
        #expect(draft.rule?.weekdays == [1, 7])
        draft.every = .day
        #expect(draft.rule == RepeatRule(every: .day))
    }

    @Test func monthChoicesFollowTheDueDate() {
        // Friday 30 October 2026: the fifth Friday, and the last one.
        let lastFriday = RepeatDraft.monthDays(due: day("2026-10-30"), current: nil)
        #expect(lastFriday == [.sameDay, .lastDay, .weekday(WeekdayOfMonth(nth: 5, weekday: 5)), .weekday(WeekdayOfMonth(nth: -1, weekday: 5))])
        // Thursday 22 October 2026: the fourth Thursday, not the last week.
        #expect(RepeatDraft.monthDays(due: day("2026-10-22"), current: nil) == [.sameDay, .lastDay, .weekday(WeekdayOfMonth(nth: 4, weekday: 4))])
        // A day set elsewhere stays a choice.
        let kept = RepeatDraft.monthDays(due: day("2026-10-22"), current: RepeatRule(every: .month, monthDay: 15))
        #expect(kept.last == .day(15))
    }

    @Test func monthChoicesMakeTheirRules() {
        var draft = RepeatDraft(nil)
        draft.every = .month
        draft.monthDay = .lastDay
        #expect(draft.rule == RepeatRule(every: .month, monthDay: -1))
        draft.monthDay = .weekday(WeekdayOfMonth(nth: 2, weekday: 2))
        #expect(draft.rule == RepeatRule(every: .month, weekdayOfMonth: WeekdayOfMonth(nth: 2, weekday: 2)))
        draft.every = .year
        #expect(draft.rule == RepeatRule(every: .year))
    }

    @Test func endsAndCounting() {
        var draft = RepeatDraft(nil)
        draft.every = .day
        draft.fromCompletion = true
        draft.end = .count
        draft.count = 4
        #expect(draft.rule == RepeatRule(every: .day, from: .completion, count: 4))
        draft.end = .until
        #expect(draft.rule == RepeatRule(every: .day, from: .completion))
        #expect(!draft.isValid, "an end day must be picked")
        draft.until = "2026-12-24"
        #expect(draft.rule == RepeatRule(every: .day, from: .completion, until: "2026-12-24"))
        #expect(draft.isValid)
        #expect(RepeatDraft.defaultUntil(due: day("2026-10-22"), today: day("2026-10-24")) == "2026-11-24")
    }

    @Test func whatTheBackendRefusesIsNotValid() {
        var draft = RepeatDraft(nil)
        draft.every = .week
        for interval in [0, -1, TaskRules.maxRepeatInterval + 1] {
            draft.interval = interval
            #expect(!draft.isValid && draft.intervalInvalid, "interval \(interval)")
        }
        draft.interval = TaskRules.maxRepeatInterval
        #expect(draft.isValid)
        draft.end = .count
        for count in [0, TaskRules.maxRepeatCount + 1] {
            draft.count = count
            #expect(!draft.isValid && draft.countInvalid, "count \(count)")
        }
        draft.weekdays = [8]
        draft.count = 3
        #expect(!draft.isValid)
    }
}

/// The reminder editor's choices make the reminders the Android app's `RemindersDialog` makes, and only valid ones.
struct ReminderDraftTests {
    @Test func theThreeModes() {
        #expect(ReminderDraft(nil, defaults: [0, 15]).mode == .defaults)
        #expect(ReminderDraft(nil, defaults: [0, 15]).reminders == nil)
        #expect(ReminderDraft([], defaults: [0]).mode == .none)
        #expect(ReminderDraft([], defaults: [0]).reminders == [])
        let own = ReminderDraft([.before(30), .at("09:00"), .at("18:00", daysBefore: 1)], defaults: [0])
        #expect(own.mode == .custom)
        #expect(own.reminders == [.before(30), .at("09:00"), .at("18:00", daysBefore: 1)])
    }

    @Test func customStartsFromTheDefaults() {
        var draft = ReminderDraft(nil, defaults: [15, 0])
        draft.mode = .custom
        #expect(draft.reminders == [.before(0), .before(15)])
    }

    @Test func choicesAddAndRemove() {
        var draft = ReminderDraft([], defaults: [0])
        draft.mode = .custom
        draft.minutes = []
        draft.toggle(minutes: 10)
        draft.addTime("09:00", daysBefore: 0)
        draft.addTime("09:00", daysBefore: 0)
        draft.addTime("18:00", daysBefore: 1)
        #expect(draft.reminders == [.before(10), .at("09:00"), .at("18:00", daysBefore: 1)])
        draft.toggle(minutes: 10)
        draft.removeTime(.at("09:00"))
        #expect(draft.reminders == [.at("18:00", daysBefore: 1)])
    }

    @Test func aMinutesChoiceSetElsewhereIsOffered() {
        let draft = ReminderDraft([.before(45), .at("07:00", daysBefore: 3)], defaults: [0])
        #expect(draft.beforeChoices == [0, 5, 10, 15, 30, 45, 60, 120, 1440])
        #expect(draft.times == [.at("07:00", daysBefore: 3)])
    }

    @Test func moreThanFiveIsNotValid() {
        var draft = ReminderDraft([], defaults: [0])
        draft.mode = .custom
        draft.minutes = [0, 5, 10, 15, 30]
        #expect(draft.isValid)
        draft.addTime("09:00", daysBefore: 0)
        #expect(!draft.isValid)
    }
}

/// A rule or reminders the backend would refuse never reach the outbox.
struct InvalidEditTests {
    let clock = TestClock(utc("2026-10-22T09:00"))

    @Test func refusedRepeatRulesAndRemindersQueueNothing() async throws {
        let clock = clock, ids = TestIds()
        let repo = TaskRepository(database: try AppDatabase.inMemory(), clock: { clock.now }, newId: { ids.next() })
        let t = try await repo.add(title: "T", dueDate: "2026-10-22", dueTime: "14:00")
        let refused = [
            RepeatRule(every: .day, interval: 0),
            RepeatRule(every: .day, interval: TaskRules.maxRepeatInterval + 1),
            RepeatRule(every: .month, weekdays: [1]),
            RepeatRule(every: .week, weekdays: []),
            RepeatRule(every: .week, weekdays: [2, 2]),
            RepeatRule(every: .week, monthDay: 3),
            RepeatRule(every: .month, monthDay: 32),
            RepeatRule(every: .month, monthDay: 1, weekdayOfMonth: WeekdayOfMonth(nth: 1, weekday: 1)),
            RepeatRule(every: .month, weekdayOfMonth: WeekdayOfMonth(nth: 0, weekday: 1)),
            RepeatRule(every: .day, until: "2026-12-01", count: 3),
            RepeatRule(every: .day, until: "soon"),
            RepeatRule(every: .day, count: 0),
        ]
        for rule in refused {
            #expect(!TaskRules.isValid(rule), "\(rule)")
            await #expect(throws: RepositoryError.self) { try await repo.setRepeat(t.localId, rule) }
        }
        let tooMany: [TaskReminder] = [.before(0), .before(5), .before(10), .before(15), .before(30), .at("09:00")]
        await #expect(throws: RepositoryError.self) { try await repo.setReminders(t.localId, tooMany) }
        await #expect(throws: RepositoryError.self) { try await repo.setReminders(t.localId, [.at("25:00")]) }
        await #expect(throws: RepositoryError.self) { try await repo.setReminders(t.localId, [.before(TaskRules.maxReminderMinutes + 1)]) }
        #expect(try await repo.pendingOps().map(\.mutation) == [Mutations.add])
        let row = try #require(try await repo.task(t.localId))
        #expect(row.repeat == nil && row.reminders == nil)
    }

    @Test func savedRulesAndRemindersAreQueuedAsTheBackendTakesThem() async throws {
        let clock = clock, ids = TestIds()
        let repo = TaskRepository(database: try AppDatabase.inMemory(), clock: { clock.now }, newId: { ids.next() })
        let t = try await repo.add(title: "T", dueDate: "2026-10-22", dueTime: "14:00")
        try await repo.setRepeat(t.localId, RepeatRule(every: .month, from: .completion, weekdayOfMonth: WeekdayOfMonth(nth: -1, weekday: 5), count: 3))
        try await repo.setReminders(t.localId, [.before(30), .at("18:00", daysBefore: 1)])
        try await repo.setReminders(t.localId, nil)
        let ops = try await repo.pendingOps()
        #expect(ops.map(\.mutation) == [Mutations.add, Mutations.update, Mutations.update, Mutations.update])
        #expect(JSONValue.decode(ops[1].argsJson)?["repeat"] == [
            "every": "month", "interval": 1, "from": "completion", "weekdayOfMonth": ["nth": -1, "weekday": 5], "count": 3,
        ])
        #expect(JSONValue.decode(ops[2].argsJson)?["reminders"] == [["minutesBefore": 30], ["time": "18:00", "daysBefore": 1]])
        #expect(JSONValue.decode(ops[3].argsJson)?["reminders"] == .null)
    }
}

struct OfflineRepeatTests {
    let clock = TestClock(utc("2026-10-22T09:00"))
    let server = FakeServer()

    func setUp() throws -> (TaskRepository, SyncEngine, ConvexRemote) {
        let clock = clock, ids = TestIds()
        server.clock = { clock.now }
        let repo = TaskRepository(
            database: try AppDatabase.inMemory(), clock: { clock.now }, newId: { ids.next() },
            localTimezone: { "Europe/London" }
        )
        let tokens = DeviceTokens(
            serverUrl: FakeServer.site, deviceToken: FakeServer.deviceToken, api: PairingAPI(transport: server),
            onRevoked: {}, clock: { clock.now }
        )
        let remote = ConvexRemote(deploymentUrl: FakeServer.cloud, tokens: tokens, transport: server)
        return (repo, SyncEngine(repository: repo, sender: remote, source: remote, onStatus: { _ in }), remote)
    }

    /// Thursday 22 October 2026, repeating on Thursdays and Sundays, with a label, a ticked item and its reminders.
    func plants(_ repo: TaskRepository) async throws -> TaskItem {
        let t = try await repo.add(title: "Water the plants", dueDate: "2026-10-22", dueTime: "08:00")
        try await repo.setRepeat(t.localId, RepeatRule(every: .week, weekdays: [4, 7]))
        try await repo.setLabels(t.localId, ["home"])
        try await repo.setReminders(t.localId, [.before(15)])
        try await repo.addItem(t.localId, "Balcony")
        let item = try #require(try await repo.task(t.localId)?.checklist.first)
        try await repo.toggleItem(t.localId, item.id)
        return try #require(try await repo.task(t.localId))
    }

    @Test func withoutAServerTheNextOccurrenceIsMadeOnTheMacAndTheServerAddsNoSecond() async throws {
        let (repo, engine, _) = try setUp()
        let t = try await plants(repo)
        try await repo.complete(t.localId)

        let done = try #require(try await repo.task(t.localId))
        #expect(done.status == .done)
        #expect(done.repeat == nil, "the done task loses its rule, so the server does not repeat it again")
        let next = try #require(try await repo.allTasks().first { $0.localId != t.localId })
        #expect(next.dueDate == "2026-10-25")
        #expect(next.dueTime == "08:00")
        #expect(next.status == .todo)
        #expect(next.repeat == RepeatRule(every: .week, weekdays: [4, 7]))
        #expect(next.labels == ["home"])
        #expect(next.reminders == [.before(15)])
        #expect(next.checklist.map(\.done) == [false])
        #expect(next.clientId == next.localId)
        #expect(try await repo.pendingOps().suffix(3).map(\.mutation) == [Mutations.update, Mutations.complete, Mutations.add])

        // A server is connected later: everything waiting goes out in order.
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(try await repo.pendingOps().isEmpty)
        let onServer = server.allTasks.filter { $0["title"] == "Water the plants" }
        #expect(onServer.count == 2)
        #expect(onServer.filter { $0["status"] == "done" }.count == 1)
        let serverNext = try #require(onServer.first { $0["status"] == "todo" })
        #expect(serverNext["dueDate"] == "2026-10-25")
        #expect(serverNext["clientId"] == .string(next.localId))
        #expect(RepeatRule.parse(serverNext["repeat"]) == RepeatRule(every: .week, weekdays: [4, 7]))
        let local = try await repo.allTasks()
        #expect(local.count == 2)
        #expect(local.allSatisfy { $0.serverId != nil })

        // The next round changes nothing.
        await engine.round()
        #expect(server.allTasks.count == 2)
        #expect(try await repo.allTasks().count == 2)
    }

    @Test(arguments: [RepeatFrom.due, .completion])
    func pairedOfflineCompletionUsesTheCompletionDayAndResendsOneOccurrence(_ anchor: RepeatFrom) async throws {
        let (repo, engine, remote) = try setUp()
        let t = try await plants(repo)
        try await repo.setRepeat(t.localId, RepeatRule(every: .day, interval: 2, from: anchor))
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        server.offline = true
        clock.set(utc("2026-10-25T14:00"))
        try await repo.move(t.localId, to: .done)
        #expect(try await repo.task(t.localId)?.completedAt == clock.now)
        let next = try #require(try await repo.allTasks().first { $0.status == .todo })
        let expectedDate = anchor == .completion ? "2026-10-27" : "2026-10-26"
        #expect(next.dueDate == expectedDate)
        #expect(next.clientId == next.localId)
        guard case .offline = await engine.round() else { Issue.record("expected offline"); return }
        #expect(server.allTasks.count == 1)
        #expect(try await repo.pendingOps().map(\.mutation) == [Mutations.update, Mutations.complete, Mutations.add])

        clock.advance(4 * HelmDates.dayMs)
        server.offline = false
        #expect(try await OutboxProcessor(store: repo, sender: remote, maxOps: 2).drain() == .moreLeft)
        server.loseNextAnswer = true
        guard case .offline = await engine.round() else { Issue.record("expected lost add answer"); return }
        #expect(server.allTasks.count == 2)
        #expect(try await repo.pendingOps().map(\.clientId) == [next.localId])
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(try await repo.pendingOps().isEmpty)
        #expect(server.allTasks.count == 2)
        #expect(server.allTasks.filter { $0["status"] == "todo" }.map { $0["clientId"] } == [.string(next.localId)])
        let saved = try #require(try await repo.task(next.localId))
        #expect(saved.dueDate == expectedDate)
        #expect(saved.serverId != nil)
        #expect(try await repo.allTasks().count == 2)
    }

    @Test func aConnectedCompletionAlsoKeepsOneNextOccurrence() async throws {
        let (repo, engine, _) = try setUp()
        let t = try await plants(repo)
        await engine.round()
        try await repo.complete(t.localId)
        let next = try #require(try await repo.allTasks().first { $0.status == .todo })
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        #expect(server.allTasks.count == 2)
        #expect(try await repo.task(next.localId)?.serverId != nil)
        #expect(try await repo.pendingOps().isEmpty)
    }

    @Test(arguments: ["acceptance", "plan", "both"])
    func agentDetailsKeepRecurrenceOnTheServerAcrossRepositoryReloads(_ fields: String) async throws {
        let (repo, engine, _) = try setUp()
        let id = server.addElsewhere("Agent task", dueDate: "2026-10-22")
        let acceptance: JSONValue = [["id": "criterion", "text": "Tests pass", "met": true]]
        let plan: JSONValue = "Implement and verify"
        var metadata: [String: JSONValue] = ["repeat": RepeatRule(every: .day).wire]
        if fields != "plan" { metadata["acceptance"] = acceptance }
        if fields != "acceptance" { metadata["plan"] = plan }
        await engine.round()
        server.editElsewhere(id, metadata)
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        server.offline = true
        let clock = clock
        let reloaded = TaskRepository(database: repo.database, clock: { clock.now })
        try await reloaded.complete(id)
        #expect(try await reloaded.allTasks().count == 1)
        #expect(try await reloaded.task(id)?.repeat == RepeatRule(every: .day))
        #expect(try await reloaded.pendingOps().map(\.mutation) == [Mutations.complete])
        server.offline = false
        guard case .synced = await engine.round() else { Issue.record("expected synced"); return }
        let next = try #require(server.allTasks.first { $0["status"] == "todo" })
        #expect(server.allTasks.count == 2)
        #expect(next["dueDate"] == "2026-10-23")
        #expect(next["plan"] == metadata["plan"])
        let resetAcceptance: JSONValue? = fields == "plan" ? nil : [["id": "criterion", "text": "Tests pass", "met": false]]
        #expect(next["acceptance"] == resetAcceptance)
        #expect(try await reloaded.allTasks().count == 2)
    }

    @Test func removingAgentDetailsAllowsLocalRecurrenceAgain() async throws {
        let (repo, engine, _) = try setUp()
        let id = server.addElsewhere("Agent task", dueDate: "2026-10-22")
        server.editElsewhere(id, ["repeat": RepeatRule(every: .day).wire, "plan": "Work"])
        await engine.round()
        server.editElsewhere(id, ["plan": .null])
        await engine.round()
        server.offline = true
        try await repo.complete(id)
        #expect(try await repo.allTasks().count == 2)
        #expect(try await repo.task(id)?.repeat == nil)
    }

    @Test func staleSnapshotsCannotReenableLocalRecurrenceForAnAgentTask() async throws {
        let (repo, engine, remote) = try setUp()
        let id = server.addElsewhere("Agent task", dueDate: "2026-10-22")
        server.editElsewhere(id, ["repeat": RepeatRule(every: .day).wire])
        await engine.round()
        let older = try await remote.snapshot().get()
        server.editElsewhere(id, ["plan": "Preserve this plan"])
        await engine.round()
        try await repo.apply(older)
        server.offline = true
        try await repo.complete(id)
        #expect(try await repo.allTasks().count == 1)
        #expect(try await repo.pendingOps().map(\.mutation) == [Mutations.complete])
    }

    @Test func recompletingWithARuleDoesNotOverwriteTheExistingNextOccurrence() async throws {
        let (repo, _, _) = try setUp()
        let task = try await plants(repo)
        try await repo.complete(task.localId)
        let next = try #require(try await repo.allTasks().first { $0.status == .todo })
        try await repo.rename(next.localId, to: "Keep my edit")
        try await repo.reopen(task.localId)
        try await repo.setRepeat(task.localId, task.repeat)
        try await repo.complete(task.localId)
        #expect(try await repo.allTasks().count == 2)
        #expect(try await repo.task(next.localId)?.title == "Keep my edit")
        #expect(try await repo.pendingOps().filter { $0.mutation == Mutations.add && $0.taskLocalId == next.localId }.count == 1)
    }

    @Test(arguments: [false, true])
    func occurrenceIdentityIsStableAndBounded(_ hasClientId: Bool) async throws {
        let clientId = String(repeating: "a", count: 128)
        let remote = RemoteTask(
            id: "server-task", clientId: hasClientId ? clientId : nil, title: "Daily", dueDate: "2026-10-22",
            createdAt: clock.now, updatedAt: clock.now, repeat: RepeatRule(every: .day)
        )
        var nextIds: [String] = []
        for _ in 0..<2 {
            let clock = clock
            let repo = TaskRepository(database: try AppDatabase.inMemory(), clock: { clock.now })
            try await repo.apply(Snapshot(tasks: [remote]))
            var id = hasClientId ? clientId : remote.id
            for _ in 0..<20 {
                try await repo.complete(id)
                let next = try #require(try await repo.allTasks().first { $0.status == .todo })
                #expect(next.localId == next.clientId)
                #expect(next.localId.count <= 128)
                id = next.localId
            }
            nextIds.append(id)
        }
        #expect(nextIds[0] == nextIds[1])
    }

    @Test func theLastOfACountedSeriesAddsNothing() async throws {
        let (repo, engine, _) = try setUp()
        let t = try await repo.add(title: "Last time", dueDate: "2026-10-22", dueTime: nil)
        try await repo.setRepeat(t.localId, RepeatRule(every: .day, count: 1))
        try await repo.complete(t.localId)
        #expect(try await repo.allTasks().count == 1)
        #expect(try await repo.task(t.localId)?.repeat == nil)
        await engine.round()
        #expect(server.allTasks.count == 1)
    }

    @Test func aLateCompletionSkipsTheMissedDatesAndCompletingTwiceAddsOne() async throws {
        let (repo, _, _) = try setUp()
        let t = try await repo.add(title: "Daily", dueDate: "2026-10-19", dueTime: nil)
        try await repo.setRepeat(t.localId, RepeatRule(every: .day, count: 10))
        try await repo.complete(t.localId)
        try await repo.complete(t.localId)
        let next = try await repo.allTasks().filter { $0.localId != t.localId }
        #expect(next.count == 1)
        // Due Monday the 19th, done on Thursday the 22nd: the 20th to the 22nd are skipped and count against it.
        #expect(next.first?.dueDate == "2026-10-23")
        #expect(next.first?.repeat?.count == 6)
    }
}
