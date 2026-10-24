import DayhandCore
import DayhandLocalization
import Testing
@testable import DayhandUI

@MainActor
struct HistoryPresentationTests {
    @Test func ordinaryPollsKeepAnInFlightHistoryRequest() {
        let opened = HistoryModel.RefreshKey(serverId: "s1", revision: 0)
        var previous: SyncStatus = .synced(at: 100)
        var revision = 0
        for at in [Int64(15_100), 30_100, 45_100] {
            let next = SyncStatus.synced(at: at)
            if AppModel.historyRecovered(from: previous, to: next) { revision += 1 }
            #expect(HistoryModel.RefreshKey(serverId: "s1", revision: revision) == opened)
            previous = next
        }
        #expect(opened != HistoryModel.RefreshKey(serverId: "s1", revision: 1))
        #expect(opened != HistoryModel.RefreshKey(serverId: "s2", revision: 0))
        #expect(opened != HistoryModel.RefreshKey(serverId: nil, revision: 0))
    }

    @Test func onlyConnectionRecoveryInvalidatesHistory() {
        let synced = SyncStatus.synced(at: 100)
        let recoverable: [SyncStatus] = [.offline("No connection"), .signedOut, .connecting]
        for previous in recoverable {
            #expect(AppModel.historyRecovered(from: previous, to: synced))
            #expect(!AppModel.historyRecovered(from: synced, to: previous))
            for next in recoverable {
                #expect(!AppModel.historyRecovered(from: previous, to: next))
            }
        }
        #expect(!AppModel.historyRecovered(from: .notConnected, to: synced))
        #expect(!AppModel.historyRecovered(from: synced, to: .notConnected))
        #expect(!AppModel.historyRecovered(from: .offline("one"), to: .offline("two")))
    }

    @Test func onlyASuccessfulFetchCanAssertEmptyHistory() {
        Localization.$override.withValue(Localization(language: "en")) {
            #expect(HistoryText.placeholder(.cached, isEmpty: true) == "History is unavailable offline.")
            #expect(HistoryText.placeholder(.cached, isEmpty: false) == "Offline: this is the history from the last connection.")
            #expect(HistoryText.placeholder(.fresh, isEmpty: true) == "No changes recorded yet.")
            #expect(HistoryText.placeholder(.fresh, isEmpty: false) == nil)
            for empty in [false, true] {
                #expect(HistoryText.placeholder(.loading, isEmpty: empty) == nil)
                #expect(HistoryText.placeholder(.notOnServerYet, isEmpty: empty) == "The history starts once this task reaches the server.")
            }
        }
    }

    @Test func unavailableHistoryAndNeutralClaimsAreTranslated() {
        let texts: [(String, String, String)] = [
            ("en", "History is unavailable offline.", "Claimed"),
            ("pl", "Historia jest niedostępna offline.", "Przejęte"),
            ("de", "Der Verlauf ist offline nicht verfügbar.", "Übernommen"),
            ("es", "El historial no está disponible sin conexión.", "Asignada"),
            ("fr", "L’historique n’est pas disponible hors ligne.", "Prise en charge"),
            ("pt-BR", "O histórico não está disponível offline.", "Assumida"),
            ("ja", "オフラインでは履歴を表示できません。", "担当を取得"),
            ("zh-Hans", "离线时无法查看历史记录。", "已认领"),
        ]
        for (language, unavailable, claimed) in texts {
            Localization.$override.withValue(Localization(language: language)) {
                #expect(HistoryText.placeholder(.cached, isEmpty: true) == unavailable)
                #expect(HistoryText.action("claim") == claimed)
                #expect(HistoryText.actor(.cli) != HistoryText.actor(.agent(name: nil)))
            }
        }
    }
}
