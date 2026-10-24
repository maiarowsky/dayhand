import DayhandCore
import DayhandLocalization
import Foundation
import Testing
@testable import DayhandUI

/// How the plan health card, the Agent section and the reminder settings read and decide, in English and Polish.
@MainActor
struct AgentTextTests {
    private func run<T>(_ language: String, _ body: () -> T) -> T {
        Localization.$override.withValue(Localization(language: language, region: "GB"), operation: body)
    }

    @Test func theHealthCardIsOneSentenceInTheLanguage() {
        let items = HealthSummary.items(PlanHealth(overdue: 2, pendingApprovals: 1, proposals: 5, oldestOpenDays: 20))
        #expect(run("en") { AgentText.healthLine(items) } == "Plan: 2 overdue · 1 approval request · 5 proposals · oldest open task 20 days old")
        #expect(run("pl") { AgentText.healthLine(items) } == "Plan: 2 zaległe · 1 prośba o zgodę · 5 propozycji · najstarsze otwarte zadanie ma 20 dni")
        #expect(run("en") { AgentText.healthLine([]) } == "Plan: nothing needs a look.")
        #expect(run("pl") { AgentText.item(HealthItem(kind: .paused, count: 1)) } == "agenci wstrzymani")
        #expect(run("pl") { AgentText.item(HealthItem(kind: .expiredClaims, count: 3)) } == "3 wygasłe przejęcia")
    }

    @Test func theCardsColourFollowsItsTone() {
        #expect(AgentText.color(.act, clear: false) == .red)
        #expect(AgentText.color(.look, clear: false) == .orange)
        #expect(AgentText.color(.calm, clear: true) == .green)
        #expect(AgentText.color(.calm, clear: false) == .accentColor)
    }

    @Test func theClaimSaysUntilWhenOrThatItRanOut() {
        let zone = "Europe/Warsaw"
        let now = Int64(1_800_000_000_000)
        let today = HelmDates.localDate(now, zone)
        let time = DateText.time(HelmDates.localAt(now + 3_600_000, zone).time.description)
        var task = TaskItem(localId: "t", title: "Ship", createdAt: 0, updatedAt: 0, claimedBy: "claude", claimExpiresAt: now + 3_600_000)
        #expect(run("en") { AgentSectionText.claim(task, now: now, today: today, timezone: zone) } == "Agent claude works on it until Today, \(time)")
        #expect(run("pl") { AgentSectionText.claim(task, now: now, today: today, timezone: zone) } == "Przejęte przez agenta claude do: Dzisiaj, \(time)")
        #expect(run("en") { AgentSectionText.claim(task, now: now + 7_200_000, today: today, timezone: zone) } == "The claim of claude ran out: Today, \(time)")
        task.claimExpiresAt = nil
        #expect(run("en") { AgentSectionText.claim(task, now: now, today: today, timezone: zone) } == "Agent claude works on it")
        task.claimedBy = nil
        #expect(AgentSectionText.claim(task, now: now, today: today, timezone: zone) == nil)
    }

    @Test func aDependencyShowsItsNumberAndWhetherItIsDone() {
        let done = TaskItem(localId: "d", serverId: "s1", title: "Send the invoice", status: .done, createdAt: 0, updatedAt: 0, ref: 12)
        let trashed = TaskItem(localId: "x", title: "Old", createdAt: 0, updatedAt: 0, deletedAt: 5)
        let open = TaskItem(localId: "o", title: "Call", createdAt: 0, updatedAt: 0, ref: 14)
        #expect(run("en") { AgentSectionText.dependency(done) } == "#12 Send the invoice (done)")
        #expect(run("pl") { AgentSectionText.dependency(done) } == "#12 Send the invoice (zrobione)")
        #expect(run("en") { AgentSectionText.dependency(trashed) } == "Old (in the trash)")
        #expect(run("en") { AgentSectionText.dependency(open) } == "#14 Call")
        #expect(run("pl") { AgentSectionText.dependency(nil) } == "Zadanie, którego nie ma na tym Macu")
    }

    @Test func anApprovalRequestSaysWhoAsksAndUntilWhen() {
        let zone = "Europe/London"
        let now = Int64(1_800_000_000_000)
        let today = HelmDates.localDate(now, zone)
        let request = ApprovalRequest(id: "a", action: "Deploy", requestedBy: "claude", expiresAt: now)
        let time = DateText.time(HelmDates.localAt(now, zone).time.description)
        #expect(run("en") { AgentText.asked(request, today: today, timezone: zone) } == "Asked by claude · expires Today, \(time)")
        #expect(run("en") { AgentText.taskName(ref: 3, title: "Deploy") } == "#3 Deploy")
        #expect(AgentText.taskName(ref: nil, title: nil) == nil)
        #expect(run("pl") { AgentText.inboxError(.noServer) } == "Połącz się z serwerem, aby zobaczyć prośby i propozycje.")
    }

    @Test func approvalHeadingsDiscloseTheNewestSubsetInEveryLanguage() {
        let headings = [
            "de": "Genehmigungsanfragen (neueste 50)",
            "en": "Approval requests (newest 50)",
            "es": "Solicitudes de aprobación (50 más recientes)",
            "fr": "Demandes d’approbation (50 plus récentes)",
            "ja": "承認リクエスト（最新50件）",
            "pl": "Prośby o zgodę (najnowsze 50)",
            "pt-BR": "Solicitações de aprovação (50 mais recentes)",
            "zh-Hans": "审批请求（最新50条）",
        ]
        for (language, heading) in headings {
            #expect(run(language) { AgentText.approvalsHeading(shown: 50, pending: 51) } == heading)
        }
        #expect(run("en") { AgentText.approvalsHeading(shown: 50, pending: 50) } == "Approval requests (50)")
        #expect(run("en") { AgentText.approvalsHeading(shown: 50, pending: 49) } == "Approval requests (50)")
        #expect(run("en") { AgentText.approvalsHeading(shown: 0, pending: 0) } == "Approval requests (0)")
    }

    @Test func theDefaultReminderChoicesKeepOnesSetElsewhere() {
        #expect(ReminderSettingsEditor.choices([0, 45]) == [0, 5, 10, 15, 30, 45, 60, 120, 1440])
        #expect(ReminderSettingsEditor.toggled([0, 30], 15, on: true) == [0, 15, 30])
        #expect(ReminderSettingsEditor.toggled([0, 30], 0, on: false) == [30])
        #expect(ReminderSettingsEditor.toggled([0], 0, on: false) == [])
    }

    @Test func aSyncedPollReadsTheHealthOnceItIsAMinuteOld() {
        #expect(AppModel.healthDue(.synced(at: 0), lastRead: 0, now: 60_000))
        #expect(!AppModel.healthDue(.synced(at: 0), lastRead: 30_000, now: 60_000))
        #expect(!AppModel.healthDue(.offline("x"), lastRead: 0, now: 600_000))
        #expect(!AppModel.healthDue(.connecting, lastRead: 0, now: 600_000))
    }
}
