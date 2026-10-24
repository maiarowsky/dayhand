import Foundation

/// What quick add makes of one line: the title, and the day and time from a date phrase at its end.
public struct QuickAddInput: Hashable, Sendable {
    public let title: String
    public let when: When?
    /// The words read as the date ("fri 2pm"), so the field can show what was understood.
    public let phrase: String?

    public init(title: String, when: When?, phrase: String?) {
        self.title = title
        self.when = when
        self.phrase = phrase
    }
}

/**
 * Quick add reads a date phrase at the end of the line, with the same grammar as `dayhand add --due` (`WhenParser`):
 * "Call the accountant fri 2pm" is "Call the accountant" on Friday at 14:00. The longest ending that is a whole
 * phrase wins and at least one word stays as the title, so "Plan next week" is "Plan" next Monday but a line that is
 * only a date ("tomorrow") stays a title. Without a phrase the line is the title and the day is the caller's default.
 */
public enum QuickAdd {
    /// The longest phrase in the grammar has six words ("the 23rd of october 2027 9am").
    static let maxPhraseWords = 7

    public static func parse(_ line: String, now: Int64, timezone: String) -> QuickAddInput {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        let words = wordRanges(trimmed)
        if words.count >= 2 {
            for length in stride(from: min(maxPhraseWords, words.count - 1), through: 1, by: -1) {
                let phraseStart = words[words.count - length].lowerBound
                let phrase = String(trimmed[phraseStart...])
                guard let when = try? WhenParser.parse(phrase, now: now, timezone: timezone) else { continue }
                let title = String(trimmed[..<phraseStart]).trimmingCharacters(in: .whitespacesAndNewlines)
                return QuickAddInput(title: title, when: when, phrase: phrase)
            }
        }
        return QuickAddInput(title: trimmed, when: nil, phrase: nil)
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
