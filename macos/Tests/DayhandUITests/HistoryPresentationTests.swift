import DayhandCore
import DayhandLocalization
import Testing
@testable import DayhandUI

@MainActor
struct HistoryPresentationTests {
    @Test func successfulSyncInvalidatesHistoryWithoutATaskChange() {
        let before = HistoryModel.RefreshKey(serverId: "s1", version: 10, syncStatus: .synced(at: 100))
        let after = HistoryModel.RefreshKey(serverId: "s1", version: 10, syncStatus: .synced(at: 200))
        let offline = HistoryModel.RefreshKey(serverId: "s1", version: 10, syncStatus: .offline("No connection"))
        #expect(before != after)
        #expect(offline != after)
        let syncing = HistoryModel.RefreshKey(serverId: "s1", version: 10, syncStatus: .connecting)
        #expect(before != syncing)
        #expect(offline != syncing)
        #expect(before == HistoryModel.RefreshKey(serverId: "s1", version: 10, syncStatus: .synced(at: 100)))
        #expect(before != HistoryModel.RefreshKey(serverId: "s1", version: 11, syncStatus: .synced(at: 100)))
        #expect(before != HistoryModel.RefreshKey(serverId: "s2", version: 10, syncStatus: .synced(at: 100)))
        #expect(before != HistoryModel.RefreshKey(serverId: nil, version: nil, syncStatus: .synced(at: 100)))
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
