import Foundation

/**
 * The release notes of an appcast item as a few lines of plain text for the update window. Appcasts carry them as
 * HTML (Sparkle's default), Markdown or plain text; the window shows text only, so no web view and no remote content.
 */
public enum ReleaseNotes {
    /// Longer notes are cut at a line break with "…"; the window is small.
    public static let maxLength = 600

    public static func plainText(_ description: String?, format: String? = nil) -> String? {
        guard let description else { return nil }
        let text: String
        switch format?.lowercased() {
        case "plain-text": text = description
        case "markdown": text = fromMarkdown(description)
        default: text = fromHTML(description)
        }
        // One line per paragraph or list item, no blank lines: the window is small.
        let tidy = text
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
        return tidy.isEmpty ? nil : shorten(tidy)
    }

    static func fromHTML(_ html: String) -> String {
        var text = html
        let replacements: [(String, String)] = [
            ("(?is)<(script|style)[^>]*>.*?</\\1>", ""),
            ("(?i)<br\\s*/?>", "\n"),
            ("(?i)<li[^>]*>", "\n• "),
            ("(?i)</(p|div|h[1-6]|li|ul|ol|tr)>", "\n"),
            ("(?i)<(p|div|h[1-6]|ul|ol|tr)[^>]*>", "\n"),
            ("<[^>]+>", ""),
        ]
        for (pattern, replacement) in replacements {
            text = text.replacingOccurrences(of: pattern, with: replacement, options: .regularExpression)
        }
        return decodeEntities(text)
    }

    static func fromMarkdown(_ markdown: String) -> String {
        markdown
            .components(separatedBy: .newlines)
            .map { line in
                var line = line.replacingOccurrences(of: "^\\s*#+\\s*", with: "", options: .regularExpression)
                line = line.replacingOccurrences(of: "^\\s*[-*+]\\s+", with: "• ", options: .regularExpression)
                line = line.replacingOccurrences(of: "\\[([^\\]]*)\\]\\([^)]*\\)", with: "$1", options: .regularExpression)
                return line.replacingOccurrences(of: "[*_`]{1,3}", with: "", options: .regularExpression)
            }
            .joined(separator: "\n")
    }

    static func decodeEntities(_ text: String) -> String {
        var result = text
        for (entity, character) in [("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&apos;", "'"), ("&ndash;", "–"), ("&mdash;", "—"), ("&hellip;", "…")] {
            result = result.replacingOccurrences(of: entity, with: character)
        }
        while let range = result.range(of: "&#(x[0-9a-fA-F]+|[0-9]+);", options: .regularExpression) {
            let body = result[range].dropFirst(2).dropLast()
            let value = body.hasPrefix("x") ? UInt32(body.dropFirst(), radix: 16) : UInt32(body)
            result.replaceSubrange(range, with: value.flatMap(Unicode.Scalar.init).map { String(Character($0)) } ?? "")
        }
        // Last, so "&amp;lt;" stays "&lt;" as written.
        return result.replacingOccurrences(of: "&amp;", with: "&")
    }

    private static func shorten(_ text: String) -> String {
        guard text.count > maxLength else { return text }
        let head = String(text.prefix(maxLength))
        let cut = head.range(of: "\n", options: .backwards).map { String(head[..<$0.lowerBound]) } ?? head
        return cut.trimmingCharacters(in: .whitespacesAndNewlines) + "\n…"
    }
}
