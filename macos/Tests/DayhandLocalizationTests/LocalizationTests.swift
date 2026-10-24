@testable import DayhandCore
@testable import DayhandLocalization
import DayhandUpdates
import Foundation
import Testing

/// The string catalog as JSON, read from the source tree.
private enum Catalog {
    static let packageRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    static let url = packageRoot.appendingPathComponent("Sources/DayhandLocalization/Localizable.xcstrings")

    /// key → language → a value, or plural category → value.
    static let entries: [String: [String: Value]] = {
        let data = try! Data(contentsOf: url)
        let json = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
        let strings = json["strings"] as! [String: [String: Any]]
        return strings.mapValues { entry in
            let localizations = entry["localizations"] as? [String: [String: Any]] ?? [:]
            return localizations.mapValues { localization in
                if let unit = localization["stringUnit"] as? [String: String] {
                    return .single(unit["value"] ?? "", state: unit["state"] ?? "")
                }
                let plural = (localization["variations"] as? [String: Any])?["plural"] as? [String: [String: [String: String]]] ?? [:]
                return .plural(plural.mapValues { $0["stringUnit"]?["value"] ?? "" }, states: Set(plural.values.compactMap { $0["stringUnit"]?["state"] }))
            }
        }
    }()

    enum Value {
        case single(String, state: String)
        case plural([String: String], states: Set<String>)
    }

    /// The plural forms each language must have (CLDR); others may be added.
    static let requiredPlurals: [String: Set<String>] = [
        "en": ["one", "other"], "pl": ["one", "few", "many", "other"], "de": ["one", "other"], "es": ["one", "other"],
        "fr": ["one", "other"], "pt-BR": ["one", "other"], "ja": ["other"], "zh-Hans": ["other"],
    ]

    /// Format specifiers as (position, type): "%1$@ of %2$@" and "%@ of %@" are the same.
    static func specifiers(_ text: String) -> [String] {
        let regex = try! NSRegularExpression(pattern: "%(?:(\\d+)\\$)?(lld|ld|d|@|lf|f|%)")
        var position = 0
        var found: [(Int, String)] = []
        for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            let type = String(text[Range(match.range(at: 2), in: text)!])
            if type == "%" { continue }
            position += 1
            let explicit = Range(match.range(at: 1), in: text).flatMap { Int(text[$0]) }
            found.append((explicit ?? position, type))
        }
        return found.sorted { $0.0 < $1.0 }.map { "\($0.0):\($0.1)" }
    }

    static func literalPercents(_ text: String) -> Int { text.components(separatedBy: "%%").count - 1 }
}

@Suite("String catalog")
struct CatalogTests {
    @Test func everyKeyIsTranslatedIntoEveryLanguageAndNoOther() {
        #expect(Catalog.entries.count > 200)
        for (key, languages) in Catalog.entries {
            #expect(Set(languages.keys) == Set(Localization.supported), "\(key): \(languages.keys.sorted())")
            for (language, value) in languages {
                switch value {
                case .single(let text, let state):
                    #expect(!text.isEmpty && state == "translated", "\(key) [\(language)]")
                case .plural(let forms, let states):
                    #expect(!forms.values.contains("") && states == ["translated"], "\(key) [\(language)]")
                }
            }
        }
    }

    @Test func formatSpecifiersMatchTheSourceInEveryTranslation() {
        for (key, languages) in Catalog.entries {
            let expected = Catalog.specifiers(key)
            for (language, value) in languages {
                let texts: [String]
                switch value {
                case .single(let text, _): texts = [text]
                case .plural(let forms, _): texts = Array(forms.values)
                }
                for text in texts {
                    #expect(Catalog.specifiers(text) == expected, "\(key) [\(language)]: \(text)")
                    #expect(Catalog.literalPercents(text) == Catalog.literalPercents(key), "\(key) [\(language)]: \(text)")
                }
            }
        }
    }

    @Test func pluralTextsHaveEveryFormTheirLanguageNeeds() {
        var plurals = 0
        for (key, languages) in Catalog.entries {
            guard case .plural = languages[Localization.source] else {
                for (language, value) in languages {
                    if case .plural = value { Issue.record("\(key) [\(language)] varies by plural, English does not") }
                }
                continue
            }
            plurals += 1
            for (language, value) in languages {
                guard case .plural(let forms, _) = value else {
                    Issue.record("\(key) [\(language)] has no plural forms")
                    continue
                }
                #expect(Catalog.requiredPlurals[language]!.isSubset(of: Set(forms.keys)), "\(key) [\(language)]: \(forms.keys.sorted())")
            }
        }
        #expect(plurals >= 10)
    }

    /// The .lproj folders the package ships are the catalog compiled (scripts/compile-strings.sh).
    @Test func compiledResourcesAreUpToDate() {
        // A number of each plural form per language, and the form it takes.
        let samples: [String: [(Int, String)]] = [
            "pl": [(1, "one"), (3, "few"), (7, "many")], "ja": [(1, "other"), (7, "other")], "zh-Hans": [(1, "other"), (7, "other")],
        ]
        for language in Localization.supported {
            let localization = Localization(language: language)
            for (key, languages) in Catalog.entries {
                let format = localization.bundle.localizedString(forKey: key, value: "\u{1}absent", table: nil)
                switch languages[language] {
                case .single(let text, _):
                    #expect(format == text, "\(key) [\(language)] is \(format) in Resources; run scripts/compile-strings.sh")
                case .plural(let forms, _):
                    for (count, form) in samples[language] ?? [(1, "one"), (7, "other")] {
                        let shown = String(format: format, locale: localization.locale, count)
                        #expect(shown == String(format: forms[form] ?? "", count), "\(key) [\(language)] \(count): \(shown); run scripts/compile-strings.sh")
                    }
                case nil:
                    Issue.record("\(key) [\(language)] missing")
                }
            }
        }
    }

    /// Every `tr("…")` in the sources has its key in the catalog, and every key in the catalog is used.
    @Test func catalogHoldsExactlyTheTextsTheSourcesUse() throws {
        let sources = Catalog.packageRoot.appendingPathComponent("Sources")
        var patterns: [(String, NSRegularExpression)] = []
        for case let file as URL in FileManager.default.enumerator(at: sources, includingPropertiesForKeys: nil)! where file.pathExtension == "swift" {
            let text = try String(contentsOf: file, encoding: .utf8)
            for literal in SourceScan.trLiterals(text) {
                patterns.append(("\(file.lastPathComponent): \(literal)", try SourceScan.pattern(literal)))
            }
        }
        #expect(patterns.count > 250)
        let keys = Array(Catalog.entries.keys)
        var used = Set<String>()
        for (name, regex) in patterns {
            let matching = keys.filter { regex.firstMatch(in: $0, range: NSRange($0.startIndex..., in: $0)) != nil }
            #expect(!matching.isEmpty, "no key in the catalog for \(name)")
            used.formUnion(matching)
        }
        #expect(Set(keys).subtracting(used).isEmpty, "keys no tr() uses: \(Set(keys).subtracting(used).sorted())")
    }
}

/// Reads the `tr("…")` literals of Swift source; an interpolation stands for any format specifier.
enum SourceScan {
    static func trLiterals(_ text: String) -> [String] {
        let chars = Array(text)
        var result: [String] = []
        var i = 0
        let marker = Array("tr(\"")
        while i < chars.count - marker.count {
            if Array(chars[i..<i + marker.count]) == marker, i == 0 || !(chars[i - 1].isLetter || chars[i - 1].isNumber) {
                let start = i + marker.count - 1
                let end = closingQuote(chars, start)
                result.append(String(chars[start + 1..<end]))
                // Scanning on inside the literal finds a tr("…") in one of its interpolations.
                i = start
            }
            i += 1
        }
        return result
    }

    /// The index of the quote that closes the literal opened at `start`, past interpolations and strings in them.
    static func closingQuote(_ chars: [Character], _ start: Int) -> Int {
        var j = start + 1
        while j < chars.count {
            if chars[j] == "\\" {
                if chars[j + 1] == "(" {
                    j = interpolationEnd(chars, j + 2)
                    continue
                }
                j += 2
                continue
            }
            if chars[j] == "\"" { return j }
            j += 1
        }
        return chars.count
    }

    /// The index after the parenthesis that closes an interpolation whose content starts at `from`.
    static func interpolationEnd(_ chars: [Character], _ from: Int) -> Int {
        var depth = 1
        var k = from
        while depth > 0 && k < chars.count {
            if chars[k] == "\"" {
                k = closingQuote(chars, k) + 1
                continue
            }
            if chars[k] == "(" { depth += 1 }
            if chars[k] == ")" { depth -= 1 }
            k += 1
        }
        return k
    }

    static func pattern(_ literal: String) throws -> NSRegularExpression {
        let chars = Array(literal)
        var pattern = "^"
        var j = 0
        while j < chars.count {
            if chars[j] == "\\" && chars[j + 1] == "(" {
                pattern += "%(?:lld|@)"
                j = interpolationEnd(chars, j + 2)
                continue
            }
            if chars[j] == "\\" {
                pattern += NSRegularExpression.escapedPattern(for: String(chars[j + 1]))
                j += 2
                continue
            }
            pattern += chars[j] == "%" ? "%%" : NSRegularExpression.escapedPattern(for: String(chars[j]))
            j += 1
        }
        return try NSRegularExpression(pattern: pattern + "$")
    }
}

@Suite("Choosing and switching the language")
struct SwitchingTests {
    @Test func theLanguageChangesTheTexts() {
        let english = Localization.$override.withValue(Localization(language: "en")) { tr("Today") }
        let polish = Localization.$override.withValue(Localization(language: "pl")) { tr("Today") }
        let japanese = Localization.$override.withValue(Localization(language: "ja")) { tr("Today") }
        #expect(english == "Today")
        #expect(polish == "Dzisiaj")
        #expect(japanese == "今日")
    }

    @Test func pluralsFollowTheLanguagesRules() {
        func tasks(_ language: String, _ count: Int) -> String {
            Localization.$override.withValue(Localization(language: language)) { tr("\(count) tasks today") }
        }
        #expect(tasks("en", 1) == "1 task today")
        #expect(tasks("en", 5) == "5 tasks today")
        #expect(tasks("pl", 1) == "1 zadanie na dziś")
        #expect(tasks("pl", 3) == "3 zadania na dziś")
        #expect(tasks("pl", 5) == "5 zadań na dziś")
        #expect(tasks("pl", 22) == "22 zadania na dziś")
        #expect(tasks("de", 1) == "1 Aufgabe heute")
        #expect(tasks("ja", 2) == "今日のタスク 2件")
    }

    @Test func argumentsMayChangePlaces() {
        let text = Localization.$override.withValue(Localization(language: "ja")) { tr("\("4 MB") of \("12 MB")") }
        #expect(text == "4 MB / 12 MB")
        let french = Localization.$override.withValue(Localization(language: "fr")) { tr("\("Demain") at \("14:00")") }
        #expect(french == "Demain à 14:00")
    }

    @Test func theCoreAndTheUpdatesSpeakTheCurrentLanguage() {
        let summary = MorningSummary(today: 5, overdue: 2, startWith: "Buy milk")
        let english = Localization.$override.withValue(Localization(language: "en")) { ReminderPlanner.summaryTitle(summary) }
        let polish = Localization.$override.withValue(Localization(language: "pl")) { ReminderPlanner.summaryTitle(summary) }
        #expect(english == "5 tasks today, 2 overdue")
        #expect(polish == "5 zadań na dziś, 2 zaległe")
        let failure = Localization.$override.withValue(Localization(language: "de")) { UpdateFailure.offline.message }
        #expect(failure.hasPrefix("Dayhand konnte den Update-Server nicht erreichen"))
    }

    @Test func withoutAChoiceEverythingIsEnglish() {
        #expect(Localization.current.language == "en" || Localization.override != nil)
        #expect(Localization(language: "xx").language == "en")
    }

    @Test func theMacsLanguagesPickTheClosestOne() {
        #expect(Localization.resolve(choice: nil, preferredLanguages: ["pl-GB", "en-GB"]) == "pl")
        #expect(Localization.resolve(choice: nil, preferredLanguages: ["ko-KR", "de-AT"]) == "de")
        #expect(Localization.resolve(choice: nil, preferredLanguages: ["pt-PT"]) == "pt-BR")
        #expect(Localization.resolve(choice: nil, preferredLanguages: ["zh-Hans-CN"]) == "zh-Hans")
        #expect(Localization.resolve(choice: nil, preferredLanguages: ["zh-CN"]) == "zh-Hans")
        #expect(Localization.resolve(choice: nil, preferredLanguages: ["zh-Hant-TW", "ja-JP"]) == "ja")
        #expect(Localization.resolve(choice: nil, preferredLanguages: ["zh-TW"]) == "en")
        #expect(Localization.resolve(choice: nil, preferredLanguages: ["ko"]) == "en")
        #expect(Localization.resolve(choice: "fr", preferredLanguages: ["pl-PL"]) == "fr")
        #expect(Localization.resolve(choice: "system", preferredLanguages: ["es-419"]) == "es")
    }

    @Test func languagesNameThemselves() {
        let names = Localization.supported.map { Localization(language: $0).nativeName }
        #expect(names == ["English", "Polski", "Deutsch", "Español", "Français", "Português (Brasil)", "日本語", "简体中文"])
    }
}

@Suite("Dates and times")
struct DateTextTests {
    @Test func daysAndTimesFollowTheLanguageAndTheRegion() {
        func run(_ language: String, _ region: String, _ body: () -> String?) -> String? {
            Localization.$override.withValue(Localization(language: language, region: region), operation: body)
        }
        #expect(run("en", "GB") { DateText.day("2026-10-23", withYear: false) } == "Fri 23 Oct")
        #expect(run("en", "US") { DateText.day("2026-10-23", withYear: false) } == "Fri, Oct 23")
        #expect(run("en", "GB") { DateText.time("14:05") } == "14:05")
        #expect(run("en", "US") { DateText.time("14:05") }?.replacingOccurrences(of: "\u{202F}", with: " ") == "2:05 PM")
        #expect(run("pl", "PL") { DateText.time("09:30") } == "09:30")
        #expect(run("de", "DE") { DateText.shortWeekday(1) } == "Mo")
        #expect(run("ja", "JP") { DateText.shortWeekday(7) } == "日")
        #expect(run("en", "GB") { DateText.time("later") } == "later")
    }
}
