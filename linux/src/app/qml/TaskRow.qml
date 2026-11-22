import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// A task on Today: a circle to tick it off, its title and when, and a menu of the moves Today offers
// (right click, or the ⋯ button). In the agenda it starts with its time ("Now" for the task worked on now) and a bar
// in its status's colour, as in the plan of the week.
Rectangle {
    id: root
    objectName: "taskRow"

    required property var task
    property bool nowRow: false
    /// The agenda's row: the time column and the status bar before the circle.
    property bool agenda: false
    readonly property bool isDone: task.done === true
    readonly property bool isOverdue: task.overdue === true
    readonly property bool selected: task.id !== undefined && app.selectedTask.id === task.id

    implicitHeight: content.implicitHeight + 12
    color: selected ? Qt.rgba(sys.highlight.r, sys.highlight.g, sys.highlight.b, 0.16)
                    : hover.hovered ? Qt.rgba(sys.highlight.r, sys.highlight.g, sys.highlight.b, 0.08) : "transparent"

    SystemPalette {
        id: sys
        colorGroup: SystemPalette.Active
    }

    HoverHandler { id: hover }

    MouseArea {
        anchors.fill: parent
        onClicked: app.openDetails(root.task.id)
    }

    TapHandler {
        acceptedButtons: Qt.RightButton
        onTapped: taskMenu.popup()
    }

    RowLayout {
        id: content
        anchors.fill: parent
        anchors.leftMargin: 12
        anchors.topMargin: 6
        anchors.bottomMargin: 6
        anchors.rightMargin: 8
        spacing: 10

        // The time column: right-aligned, empty for a task without a time.
        Label {
            objectName: "rowTime"
            visible: root.agenda
            Layout.preferredWidth: 44
            horizontalAlignment: Text.AlignRight
            text: root.nowRow ? qsTr("Now") : (root.task.time !== undefined ? root.task.time : "")
            font.pixelSize: 13
            font.bold: root.nowRow
            font.features: { "tnum": 1 }
            color: root.nowRow ? sys.highlight : sys.placeholderText
        }
        // A bar in the colour of the task's status, lighter on a dark window; the status is also in the details.
        Rectangle {
            objectName: "statusBar"
            readonly property bool dark: sys.window.hslLightness < 0.5
            visible: root.agenda
            Layout.fillHeight: true
            Layout.minimumHeight: 22
            implicitWidth: 4
            radius: 2
            color: root.task.status === "doing" ? (dark ? "#8e9a3f" : "#626d28")
                 : root.task.status === "done" ? (dark ? "#b8c0b8" : "#454c45")
                 : (dark ? "#cedc85" : "#4a7c00")
        }

        // The done circle.
        AbstractButton {
            id: doneBox
            objectName: "doneBox"
            Layout.alignment: Qt.AlignTop
            Layout.topMargin: 2
            implicitWidth: 20
            implicitHeight: 20
            Accessible.name: root.isDone ? qsTr("Mark as not done") : qsTr("Mark as done")
            onClicked: app.toggleDone(root.task.id)

            contentItem: Item {}
            background: Rectangle {
                radius: width / 2
                border.width: 1.5
                border.color: root.isDone ? sys.highlight : sys.placeholderText
                color: root.isDone ? sys.highlight : (doneBox.hovered ? Qt.rgba(sys.highlight.r, sys.highlight.g, sys.highlight.b, 0.2) : "transparent")

                Label {
                    anchors.centerIn: parent
                    visible: root.isDone
                    text: "✓"
                    font.pixelSize: 12
                    color: sys.highlightedText
                }
            }
        }

        AbstractButton {
            id: titleButton
            objectName: "taskDetailsTarget"
            Layout.fillWidth: true
            implicitHeight: titleColumn.implicitHeight
            Accessible.name: root.task.title || ""
            onClicked: app.openDetails(root.task.id)
            background: Rectangle {
                color: "transparent"
                border.width: titleButton.visualFocus ? 1 : 0
                border.color: sys.highlight
            }
            contentItem: ColumnLayout {
                id: titleColumn
                spacing: 1

                Label {
                    Layout.fillWidth: true
                    text: root.task.title !== undefined ? root.task.title : ""
                    wrapMode: Text.Wrap
                    maximumLineCount: 2
                    elide: Text.ElideRight
                    font.strikeout: root.isDone
                    font.bold: root.nowRow
                    color: root.isDone ? sys.placeholderText : sys.windowText
                }
                Label {
                    Layout.fillWidth: true
                    visible: text !== ""
                    text: root.nowRow
                          ? (root.task.resumeNote ? qsTr("Where I stopped: %1").arg(root.task.resumeNote) : qsTr("Working on it now"))
                          : (root.task.detail !== undefined ? root.task.detail : "")
                    font.pixelSize: 12
                    elide: Text.ElideRight
                    color: root.isOverdue ? app.overdueColor : sys.placeholderText
                }
            }
        }

        Button {
            visible: root.isOverdue
            text: qsTr("To today")
            flat: true
            onClicked: app.moveToToday(root.task.id)
        }
        Button {
            visible: root.nowRow
            text: qsTr("Not now")
            flat: true
            onClicked: app.clearNow()
        }
        ToolButton {
            text: "⋯"
            opacity: hover.hovered || taskMenu.visible ? 1 : 0
            Accessible.name: qsTr("Task menu")
            onClicked: taskMenu.popup()
        }
    }

    Menu {
        id: taskMenu

        MenuItem {
            text: root.isDone ? qsTr("Mark as Not Done") : qsTr("Mark as Done")
            onTriggered: app.toggleDone(root.task.id)
        }
        MenuItem {
            visible: !root.isDone
            height: visible ? implicitHeight : 0
            text: root.task.isNow ? qsTr("Not Now") : qsTr("Work on It Now")
            onTriggered: root.task.isNow ? app.clearNow() : app.setNow(root.task.id)
        }
        MenuSeparator {}
        MenuItem {
            visible: !root.isDone
            height: visible ? implicitHeight : 0
            text: qsTr("To Today")
            onTriggered: app.moveToToday(root.task.id)
        }
        MenuItem {
            visible: !root.isDone
            height: visible ? implicitHeight : 0
            text: qsTr("To Tomorrow")
            onTriggered: app.moveToTomorrow(root.task.id)
        }
        MenuSeparator {}
        MenuItem {
            text: qsTr("Archive")
            onTriggered: app.archive(root.task.id)
        }
        MenuItem {
            text: qsTr("Move to Trash")
            onTriggered: app.moveToTrash(root.task.id)
        }
    }
}
