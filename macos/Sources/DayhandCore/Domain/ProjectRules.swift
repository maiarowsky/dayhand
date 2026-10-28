import DayhandLocalization
import Foundation

/**
 * The backend's checks of a project (`backend/convex/lib/projectOps.ts`), applied on the Mac before a project change
 * is sent to the server (project changes are never queued): a name, icon or note the server would refuse is not sent.
 */
public enum ProjectRules {
    public static let maxName = 50
    public static let maxNote = 2_000
    public static let maxIcon = 16
    public static let maxProjects = 200
    /// Distance from the neighbour of a project moved to either end of the sidebar.
    public static let positionStep: Double = 1024
    public static let maxPosition: Double = 1e15
    /// In filters and as a target: no project. Reserved, so no project has this name.
    public static let noProject = "none"

    public enum NameProblem: Error, Hashable, Sendable {
        case empty, tooLong, multiline, reserved
        /// Another project (archived ones included) has the name in some case.
        case taken(String)

        public var message: String {
            switch self {
            case .empty: return tr("The name must not be empty.")
            case .tooLong: return tr("The name must be at most \(ProjectRules.maxName) characters.")
            case .multiline: return tr("The name must be one line.")
            case .reserved: return tr("“none” is reserved: it means tasks without a project.")
            case .taken(let name): return tr("There is already a project named “\(name)”.")
            }
        }
    }

    /// The key that keeps names unique: trimmed, NFC, lower case (`nameKeyOf`).
    public static func nameKey(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping.lowercased()
    }

    /**
     * The name as the backend stores it (trimmed, NFC, 1 to 50 characters, one line, not "none"), unique among
     * [projects] except [exceptLocalId] (renaming a project to its own name in another case is allowed).
     */
    public static func name(_ input: String, among projects: [Project], except exceptLocalId: String? = nil) -> Result<String, NameProblem> {
        let clean = input.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping
        if clean.isEmpty { return .failure(.empty) }
        if clean.jsLength > maxName { return .failure(.tooLong) }
        if clean.unicodeScalars.contains(where: { $0.properties.generalCategory == .control }) { return .failure(.multiline) }
        let key = nameKey(clean)
        if key == noProject { return .failure(.reserved) }
        if let other = projects.first(where: { $0.localId != exceptLocalId && nameKey($0.name) == key }) {
            return .failure(.taken(other.name))
        }
        return .success(clean)
    }

    /// One emoji, a flag included, with its modifiers and joiners (`PICTOGRAPH`).
    private static let emojiComponent = #"(?:\p{Emoji_Modifier_Base}\x{FE0F}?\p{Emoji_Modifier}|\p{Extended_Pictographic}\x{FE0F}?)"#
    private static let pictograph = try! NSRegularExpression(
        pattern: #"\A(?:[\x{1F1E6}-\x{1F1FF}]{2}|[#*0-9]\x{FE0F}?\x{20E3}|\x{1F3F4}[\x{E0061}-\x{E007A}]+\x{E007F}|\#(emojiComponent)(?:\x{200D}\#(emojiComponent))*)\z"#
    )

    /**
     * The icon as stored: one emoji (one character on screen, up to 16 UTF-16 code units, no spaces); blank is no icon
     * (`.success(nil)`); anything else nil. The backend checks the same but does not count characters.
     */
    public static func icon(_ input: String) -> String?? {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return .some(nil) }
        guard value.jsLength <= maxIcon,
              pictograph.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil else { return nil }
        return .some(value)
    }

    /// The note as stored: up to 2000 characters, blank is no note; nil when too long.
    public static func note(_ input: String) -> String?? {
        if input.jsLength > maxNote { return nil }
        return .some(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : input)
    }

    /// The position of a project moved between two neighbours in the sidebar (nil: no neighbour on that side).
    public static func position(after before: Double?, before after: Double?) -> Double {
        switch (before, after) {
        case let (b?, a?): return (b + a) / 2
        case let (b?, nil): return min(b + positionStep, maxPosition)
        case let (nil, a?): return max(a - positionStep, -maxPosition)
        case (nil, nil): return positionStep
        }
    }

    /**
     * The position that puts [localId] at [index] of the active projects in [ordered] (the sidebar's order),
     * between its new neighbours; nil when it would not move.
     */
    public static func position(moving localId: String, to index: Int, in ordered: [Project]) -> Double? {
        guard let from = ordered.firstIndex(where: { $0.localId == localId }) else { return nil }
        var rest = ordered
        rest.remove(at: from)
        let target = min(max(index, 0), rest.count)
        guard target != from else { return nil }
        let before = target > 0 ? rest[target - 1].position : nil
        let after = target < rest.count ? rest[target].position : nil
        return position(after: before, before: after)
    }
}
