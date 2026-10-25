import DayhandCore
import DayhandLocalization
import Testing
@testable import DayhandUI

@MainActor
struct ProjectSupportTextTests {
    @Test func backendRequirementIsLocalizedInEverySupportedLanguage() {
        let translations = [
            "de": "Benötigt Backend 0.13.0 oder neuer",
            "en": "Needs backend 0.13.0 or later",
            "es": "Requiere el backend 0.13.0 o posterior",
            "fr": "Nécessite le backend 0.13.0 ou ultérieur",
            "ja": "バックエンド 0.13.0 以降が必要です",
            "pl": "Wymaga backendu 0.13.0 lub nowszego",
            "pt-BR": "Requer backend 0.13.0 ou posterior",
            "zh-Hans": "需要后端 0.13.0 或更高版本",
        ]
        #expect(Set(translations.keys) == Set(Localization.supported))
        for (language, expected) in translations {
            Localization.$override.withValue(Localization(language: language)) {
                #expect(ProjectSupport.unsupported.requirement == expected)
                #expect(Formatting.status(.synced(at: 0), pending: 3, useOffline: false, projectSupport: .unsupported) == expected)
                #expect(Formatting.status(.synced(at: 0), pending: 0, useOffline: false, projectSupport: .supported) == nil)
                #expect(ProjectSupport.unknown.requirement == nil)
            }
        }
    }

    @Test func capabilityStatusDoesNotHideConnectionFailures() {
        Localization.$override.withValue(Localization(language: "en")) {
            #expect(Formatting.status(.offline("HTTP 503"), pending: 1, useOffline: false, projectSupport: .unsupported)
                == "Offline: 1 change waits for the server. The server has a problem.")
            #expect(Formatting.status(.connecting, pending: 1, useOffline: false, projectSupport: .unsupported) == "Connecting…")
            #expect(Formatting.status(.synced(at: 0), pending: 1, useOffline: false, projectSupport: .supported) == "Sending 1 change…")
        }
    }
}
