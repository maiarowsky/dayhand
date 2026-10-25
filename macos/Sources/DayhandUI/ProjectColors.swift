import AppKit
import DayhandCore
import DayhandLocalization
import SwiftUI

/**
 * The shades of the project color tokens, one for the light and one for the dark appearance, each with a contrast of
 * at least 3:1 against the window (WCAG 1.4.11 for graphics; `ProjectColorTests` checks it).
 */
enum ProjectColors {
    struct Shade {
        let light: UInt32
        let dark: UInt32
    }

    static func shade(_ color: ProjectColor) -> Shade {
        switch color {
        case .red: return Shade(light: 0xD93B30, dark: 0xFF6B5E)
        case .orange: return Shade(light: 0xC96400, dark: 0xFF9F43)
        case .amber: return Shade(light: 0xA07800, dark: 0xFFCC33)
        case .green: return Shade(light: 0x2E9A48, dark: 0x4CD07A)
        case .teal: return Shade(light: 0x0F9488, dark: 0x3CC8B4)
        case .cyan: return Shade(light: 0x0890B0, dark: 0x4CC4E6)
        case .blue: return Shade(light: 0x2A6FDB, dark: 0x5A9CFF)
        case .indigo: return Shade(light: 0x5856D6, dark: 0x8E8CFF)
        case .purple: return Shade(light: 0x9B4DCA, dark: 0xC58AF2)
        case .pink: return Shade(light: 0xD6336C, dark: 0xFF6FA0)
        case .brown: return Shade(light: 0x8D6E4F, dark: 0xC49A6C)
        case .gray: return Shade(light: 0x7A7A80, dark: 0xA0A0A8)
        }
    }

    static func nsColor(_ color: ProjectColor) -> NSColor {
        let shade = shade(color)
        return NSColor(name: nil) { appearance in
            rgb(appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? shade.dark : shade.light)
        }
    }

    static func color(_ color: ProjectColor) -> Color { Color(nsColor: nsColor(color)) }

    static func rgb(_ hex: UInt32) -> NSColor {
        NSColor(
            srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: 1
        )
    }

    /// The token's name in the editor and for VoiceOver.
    static func name(_ color: ProjectColor) -> String {
        switch color {
        case .red: return tr("Red")
        case .orange: return tr("Orange")
        case .amber: return tr("Amber")
        case .green: return tr("Green")
        case .teal: return tr("Teal")
        case .cyan: return tr("Cyan")
        case .blue: return tr("Blue")
        case .indigo: return tr("Indigo")
        case .purple: return tr("Purple")
        case .pink: return tr("Pink")
        case .brown: return tr("Brown")
        case .gray: return tr("Gray")
        }
    }
}

/// A project's mark: its emoji when it has one, otherwise a dot of its color (an outline without a color).
struct ProjectMark: View {
    let project: Project
    var size: CGFloat = 9

    var body: some View {
        if let icon = project.icon {
            Text(icon).font(.system(size: size + 3))
                .frame(width: size + 6, height: size + 6)
                .accessibilityHidden(true)
        } else {
            ColorDot(color: project.color, size: size)
                .frame(width: size + 6, height: size + 6)
        }
    }
}

/// A round swatch of a project color; without one, a gray outline.
struct ColorDot: View {
    let color: ProjectColor?
    var size: CGFloat = 9

    var body: some View {
        Group {
            if let color {
                Circle().fill(ProjectColors.color(color))
            } else {
                Circle().strokeBorder(Color.secondary, lineWidth: 1.2)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
