import Foundation

/**
 * The language of Dayhand's own texts, and the locale its dates and times are formatted in.
 *
 * The texts live in the string catalog `Localizable.xcstrings` next to this file, English first. SwiftPM copies a
 * catalog into the bundle without compiling it, so `scripts/compile-strings.sh` compiles it into `Resources/`
 * (`<language>.lproj/Localizable.strings` and `.stringsdict`, the plural forms) and the package ships those;
 * `LocalizationTests` fails while they are out of date.
 *
 * Until the app chooses (`use(_:)`), everything speaks English, so the tests and tools read the same texts on every
 * Mac. The app follows the Mac's languages or the one picked in Settings, and changes at once: views call `tr` while
 * they draw, so drawing them again is enough.
 */
public struct Localization: @unchecked Sendable, Equatable {
    /// The languages Dayhand speaks, English (the source) first.
    public static let supported = ["en", "pl", "de", "es", "fr", "pt-BR", "ja", "zh-Hans"]
    public static let source = "en"

    /// One of `supported`.
    public let language: String
    /// Dates and times: the chosen language with the Mac's region, so "14:00" or "2:00 PM" follows the region.
    public let locale: Locale
    let bundle: Bundle

    /// `language` must be one of `supported` (anything else is English); `region` is the Mac's, e.g. "GB".
    public init(language: String, region: String? = nil) {
        let language = Self.supported.contains(language) ? language : Self.source
        self.init(checked: language, locale: Self.locale(language: language, region: region))
    }

    /// The Mac's own languages: the texts in `language`, dates in the Mac's `locale` with its 12/24-hour setting.
    public init(language: String, locale: Locale) {
        self.init(checked: Self.supported.contains(language) ? language : Self.source, locale: locale)
    }

    private init(checked language: String, locale: Locale) {
        self.language = language
        self.locale = locale
        bundle = Self.bundle(for: language)
    }

    public static func == (lhs: Localization, rhs: Localization) -> Bool {
        lhs.language == rhs.language && lhs.locale.identifier == rhs.locale.identifier
    }

    /// The text for `value` in this language; plural forms follow the language's rules.
    public func string(_ value: String.LocalizationValue) -> String {
        #if DEBUG
        Self.check(value, in: bundle)
        #endif
        return String(localized: value, bundle: bundle, locale: locale)
    }

    #if DEBUG
    /// Keys asked for that the catalog does not have, in debug builds; the snapshot tool fails on them.
    public static var missingKeys: Set<String> { lock.withLock { missing } }
    nonisolated(unsafe) private static var missing = Set<String>()

    private static func check(_ value: String.LocalizationValue, in bundle: Bundle) {
        // The key ("Every %lld days") is not public; reflection reads it in debug builds only.
        guard let key = Mirror(reflecting: value).children.first(where: { $0.label == "key" })?.value as? String else { return }
        let absent = "\u{1}absent"
        if bundle.localizedString(forKey: key, value: absent, table: nil) == absent {
            _ = lock.withLock { missing.insert(key) }
        }
    }
    #endif

    /// The language's own name, as the language picker lists it: "Polski", "日本語".
    public var nativeName: String {
        Locale(identifier: language).localizedString(forIdentifier: language).map(Self.capitalized) ?? language
    }

    // MARK: The current language

    /// For tests: a language for one task and what it calls, without changing the app's.
    @TaskLocal public static var override: Localization?

    private static let lock = NSLock()
    /// British English until the app chooses: 24-hour times and "Fri 23 Oct", as the screens read before they were
    /// translated.
    nonisolated(unsafe) private static var chosen = Localization(language: source, region: "GB")

    /// The language texts are made in now.
    public static var current: Localization {
        override ?? lock.withLock { chosen }
    }

    /// Makes `localization` the app's language from now on.
    public static func use(_ localization: Localization) {
        lock.withLock { chosen = localization }
    }

    // MARK: Choosing

    /**
     * The language for a choice: one of `supported` as it is, otherwise ("system", nil, unknown) the first of the
     * Mac's `preferredLanguages` Dayhand speaks, else English. Regional forms match their language ("pl-GB" is
     * Polish, "pt-PT" Brazilian Portuguese, "zh-CN" Simplified Chinese); Traditional Chinese is not Simplified.
     */
    public static func resolve(choice: String?, preferredLanguages: [String]) -> String {
        if let choice, supported.contains(choice) { return choice }
        for preferred in preferredLanguages {
            if let match = match(preferred) { return match }
        }
        return source
    }

    /// The supported language for one preferred language ("de-AT" → "de"), or nil.
    public static func match(_ preferred: String) -> String? {
        let parts = preferred.replacingOccurrences(of: "_", with: "-").split(separator: "-").map(String.init)
        guard let code = parts.first?.lowercased() else { return nil }
        switch code {
        case "pt": return "pt-BR"
        case "zh":
            let rest = parts.dropFirst().map { $0.lowercased() }
            let traditional = rest.contains("hant") || (!rest.contains("hans") && rest.contains { ["tw", "hk", "mo"].contains($0) })
            return traditional ? nil : "zh-Hans"
        default:
            return supported.first { $0 == code }
        }
    }

    // MARK: Helpers

    /// The compiled texts of one language: its `.lproj` folder in the package's resources (SwiftPM writes the folder
    /// names in lower case, e.g. `zh-hans.lproj`).
    private static func bundle(for language: String) -> Bundle {
        let resources = Bundle.module
        let folder = resources.localizations.first { $0.caseInsensitiveCompare(language) == .orderedSame } ?? language
        guard let path = resources.path(forResource: folder, ofType: "lproj"), let bundle = Bundle(path: path) else { return resources }
        return bundle
    }

    private static func locale(language: String, region: String?) -> Locale {
        guard let region, !region.isEmpty else { return Locale(identifier: language) }
        let parts = language.split(separator: "-")
        // "zh-Hans" keeps its script; "pt-BR" gives its language and takes the Mac's region.
        let base = parts.count > 1 && parts[1].count == 4 ? "\(parts[0])-\(parts[1])" : String(parts[0])
        return Locale(identifier: "\(base)_\(region)")
    }

    private static func capitalized(_ name: String) -> String {
        name.prefix(1).uppercased() + name.dropFirst()
    }
}

/// Dayhand's text for `value` in the current language. The key is the English text, with `%lld` for a whole number
/// and `%@` for text in place of each interpolation; the translations are in `Localizable.xcstrings`.
public func tr(_ value: String.LocalizationValue) -> String {
    Localization.current.string(value)
}
