import QtQuick
import QtQuick.Controls

// One sentence about the day: a greeting, how many tasks are on today's plan, then how many of today's have a time
// (◷) or repeat (↻) and how many are overdue (!), each in its colour. Wraps onto a second line in a narrow window.
Flow {
    id: root
    objectName: "daySummary"

    readonly property var summary: app.daySummary

    // Flow has one spacing for both directions: a small one between lines, the gap between parts is their padding.
    spacing: 4

    SystemPalette {
        id: sys
        colorGroup: SystemPalette.Active
    }

    Label {
        objectName: "daySentence"
        width: Math.min(implicitWidth, root.width)
        wrapMode: Text.Wrap
        text: root.summary.sentence
        font.pixelSize: 14
        color: sys.windowText
    }

    Repeater {
        model: [
            { name: "summaryTimed", icon: "◷", text: root.summary.timed, tint: sys.highlight },
            { name: "summaryRepeating", icon: "↻", text: root.summary.repeating, tint: sys.window.hslLightness < 0.5 ? "#8e9a3f" : "#626d28" },
            { name: "summaryOverdue", icon: "!", text: root.summary.overdue, tint: app.overdueColor }
        ]

        delegate: Row {
            required property var modelData

            objectName: modelData.name
            visible: modelData.text !== ""
            leftPadding: 10
            spacing: 4
            Accessible.role: Accessible.StaticText
            Accessible.name: modelData.text

            Label {
                text: parent.modelData.icon
                font.pixelSize: 14
                font.bold: true
                color: parent.modelData.tint
            }
            Label {
                text: parent.modelData.text
                font.pixelSize: 14
                color: sys.windowText
            }
        }
    }
}
