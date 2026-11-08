import AppKit
import DayhandCore
import SwiftUI

/// Shared by the plan, board and task status controls. Project colours remain separate markers.
enum PlannerStyle {
    static let blue = adaptive(0x1766D2, 0x8BB8FF)
    static let onBlue = adaptive(0xFFFFFF, 0x112B50)
    static let line = adaptive(0xDEE1DC, 0x3A3E39)
    static let lime = adaptive(0xCEDC85, 0xB8CB69)
    static let olive = adaptive(0x626D28, 0x626D28)
    static let graphite = adaptive(0x292D29, 0x414741)
    static let ink = Color(nsColor: NSColor(srgbRed: 0.13, green: 0.16, blue: 0.10, alpha: 1))

    static func fill(_ status: TaskStatus) -> Color {
        switch status {
        case .todo: return lime
        case .doing: return olive
        case .done: return graphite
        }
    }

    static func text(_ status: TaskStatus) -> Color { status == .todo ? ink : .white }

    static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let hex = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
            return NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255,
                           green: CGFloat((hex >> 8) & 255) / 255,
                           blue: CGFloat(hex & 255) / 255, alpha: 1)
        })
    }
}
