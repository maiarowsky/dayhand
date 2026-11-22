import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// A group of To plan: its name and count, then its tasks (Overdue, No day, Coming up). Nothing when it is empty.
ColumnLayout {
    id: root

    required property string title
    required property var tasks
    property color tint: sys.placeholderText

    visible: tasks.length > 0
    spacing: 0

    SystemPalette {
        id: sys
        colorGroup: SystemPalette.Active
    }

    RowLayout {
        Layout.fillWidth: true
        Layout.leftMargin: 16
        Layout.rightMargin: 16
        Layout.topMargin: 12
        Layout.bottomMargin: 2

        Label {
            objectName: "toPlanGroupTitle"
            Layout.fillWidth: true
            text: root.title
            font.pixelSize: 12
            font.bold: true
            color: root.tint
        }
        Label {
            text: root.tasks.length
            font.pixelSize: 12
            font.bold: true
            color: sys.placeholderText
        }
    }

    Repeater {
        model: root.tasks
        delegate: TaskRow {
            required property var modelData
            task: modelData
            Layout.fillWidth: true
        }
    }
}
