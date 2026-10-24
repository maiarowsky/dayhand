import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// The sections of Today in one scrolling column.
ScrollView {
    id: root

    property bool showDone: false

    signal addClicked()

    contentWidth: availableWidth
    clip: true

    SystemPalette {
        id: sys
        colorGroup: SystemPalette.Active
    }

    ColumnLayout {
        width: root.availableWidth
        spacing: 2

        ColumnLayout {
            objectName: "emptyToday"
            visible: app.planEmpty && app.done.length === 0
            Layout.fillWidth: true
            Layout.topMargin: 64
            spacing: 12

            Label {
                Layout.alignment: Qt.AlignHCenter
                text: "☀"
                font.pixelSize: 36
                color: sys.placeholderText
            }
            Label {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("Nothing planned for today.")
                font.pixelSize: 16
                color: sys.windowText
            }
            Button {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("Add Task")
                onClicked: root.addClicked()
            }
        }

        SectionHeader {
            objectName: "overdueHeader"
            visible: app.overdue.length > 0
            text: qsTr("Overdue (%1)").arg(app.overdue.length)
            color: app.overdueColor
        }
        Repeater {
            model: app.overdue
            delegate: TaskRow {
                required property var modelData
                task: modelData
                Layout.fillWidth: true
            }
        }

        SectionHeader {
            visible: app.nowTask.id !== undefined
            text: qsTr("Now")
        }
        TaskRow {
            objectName: "nowRow"
            visible: app.nowTask.id !== undefined
            Layout.fillWidth: true
            task: app.nowTask
            nowRow: true
        }

        SectionHeader {
            objectName: "todayHeader"
            visible: !(app.planEmpty && app.done.length === 0)
            text: qsTr("Today")
        }
        Label {
            visible: app.today.length === 0 && !(app.planEmpty && app.done.length === 0)
            Layout.leftMargin: 16
            Layout.bottomMargin: 6
            color: sys.placeholderText
            text: app.overdue.length === 0 && app.nowTask.id === undefined
                  ? qsTr("Nothing left for today.") : qsTr("Nothing else planned for today.")
        }
        Repeater {
            model: app.today
            delegate: TaskRow {
                required property var modelData
                task: modelData
                Layout.fillWidth: true
            }
        }

        SectionHeader {
            objectName: "doneHeader"
            visible: app.done.length > 0
            text: (root.showDone ? "▾ " : "▸ ") + qsTr("Done (%1)").arg(app.done.length)
            clickable: true
            onClicked: root.showDone = !root.showDone
        }
        Repeater {
            model: root.showDone ? app.done : []
            delegate: TaskRow {
                required property var modelData
                task: modelData
                Layout.fillWidth: true
            }
        }

        Item { Layout.preferredHeight: 16 }
    }
}
