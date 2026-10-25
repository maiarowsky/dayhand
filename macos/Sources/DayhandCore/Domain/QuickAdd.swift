import Foundation

/// What quick add makes of one line: the title, the day and time from a date phrase at its end, and the project of a
/// `+project` word.
public struct QuickAddInput: Hashable, Sendable {
    public let title: String
    public let when: When?
    /// The words read as the date ("fri 2pm"), so the field can show what was understood.
    public let phrase: String?
    /// The `localId` of the project a `+word` names.
    public let projectLocalId: String?
    /// A `+word` that names no project: it stays in the title, and the field says so.
    public let unknownProject: String?

    public init(title: String, when: When?, phrase: String?, projectLocalId: String? = nil, unknownProject: String? = nil) {
        self.title = title
        self.when = when
        self.phrase = phrase
        self.projectLocalId = projectLocalId
        self.unknownProject = unknownProject
    }
}

/**
 * Quick add reads a date phrase at the end of the line, with the same grammar as `dayhand add --due` (`WhenParser`):
 * "Call the accountant fri 2pm" is "Call the accountant" on Friday at 14:00. The longest ending that is a whole
 * phrase wins and at least one word stays as the title, so "Plan next week" is "Plan" next Monday but a line that is
 * only a date ("tomorrow") stays a title. Without a phrase the line is the title and the day is the caller's default.
 *
 * A `+word` anywhere in the line names a project the server has that is not archived, in any case, a hyphen standing
 * for a space: "+strona-piekarni" is the project "Strona piekarni". The first such word sets the project and leaves
 * the title; a `+word` that names no project (and is not a date like "+3d") stays in the title, and quick add never
 * makes a project from a typo.
 */
public enum QuickAdd {
    /// The longest phrase in the grammar has six words ("the 23rd of october 2027 9am").
    static let maxPhraseWords = 7

    /// Without [readDate] the date words stay in the title ("Keep in title"); a `+project` word is still read.
    public static func parse(
        _ line: String, now: Int64, timezone: String, projects: [Project] = [], readDate: Bool = true
    ) -> QuickAddInput {
        let found = takeProject(line.trimmingCharacters(in: .whitespacesAndNewlines), projects: projects, now: now, timezone: timezone)
        let trimmed = found.rest
        let words = wordRanges(trimmed)
        if readDate, words.count >= 2 {
            for length in stride(from: min(maxPhraseWords, words.count - 1), through: 1, by: -1) {
                let phraseStart = words[words.count - length].lowerBound
                let phrase = String(trimmed[phraseStart...])
                guard let when = try? WhenParser.parse(phrase, now: now, timezone: timezone) else { continue }
                let title = String(trimmed[..<phraseStart]).trimmingCharacters(in: .whitespacesAndNewlines)
                return QuickAddInput(title: title, when: when, phrase: phrase, projectLocalId: found.project, unknownProject: found.unknown)
            }
        }
        return QuickAddInput(title: trimmed, when: nil, phrase: nil, projectLocalId: found.project, unknownProject: found.unknown)
    }

    /// How a `+word` and a project's name compare: as names do (`ProjectRules.nameKey`), a hyphen being a space.
    static func projectKey(_ name: String) -> String {
        ProjectRules.nameKey(name).replacingOccurrences(of: "-", with: " ")
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// The line without the first `+word` that names one of the active [projects], that project, and the first
    /// `+word` naming none.
    static func takeProject(_ line: String, projects: [Project], now: Int64, timezone: String) -> (rest: String, project: String?, unknown: String?) {
        let active = projects.filter { !$0.isArchived && $0.serverId != nil }
        var unknown: String?
        for range in wordRanges(line) {
            let word = String(line[range])
            guard word.count > 1, word.hasPrefix("+") else { continue }
            let name = String(word.dropFirst())
            let exact = active.first { ProjectRules.nameKey($0.name) == ProjectRules.nameKey(name) }
            if let project = exact ?? active.first(where: { projectKey($0.name) == projectKey(name) }) {
                let before = String(line[..<range.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
                let after = String(line[range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
                let rest = [before, after].filter { !$0.isEmpty }.joined(separator: " ")
                return (rest, project.localId, unknown)
            }
            if unknown == nil, (try? WhenParser.parse(word, now: now, timezone: timezone)) == nil { unknown = String(word.dropFirst()) }
        }
        return (line, nil, unknown)
    }

    private static func wordRanges(_ text: String) -> [Range<String.Index>] {
        var ranges: [Range<String.Index>] = []
        var start: String.Index?
        for index in text.indices {
            if text[index].isWhitespace {
                if let s = start { ranges.append(s..<index) }
                start = nil
            } else if start == nil {
                start = index
            }
        }
        if let s = start { ranges.append(s..<text.endIndex) }
        return ranges
    }
}
