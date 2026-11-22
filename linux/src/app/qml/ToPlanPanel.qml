import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Beside Today in a wide window while no task is open: the open tasks that still need a day (overdue, with To today,
// and those without one) and the next three days'. A task opens its details in this place.
Rectangle {
    id: root
    objectName: "toPlanPanel"

    readonly property bool empty: app.overdue.length === 0 && app.noDay.length === 0 && app.comingUp.length === 0

    color: Qt.darker(sys.window, 1.03)

    SystemPalette {
        id: sys
        colorGroup: SystemPalette.Active
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        Label {
            Layout.fillWidth: true
            Layout.leftMargin: 16
            Layout.topMargin: 16
            text: qsTr("To plan")
            font.pixelSize: 16
            font.bold: true
            color: sys.windowText
            Accessible.role: Accessible.Heading
        }
        Label {
            objectName: "toPlanEmpty"
            visible: root.empty
            Layout.fillWidth: true
            Layout.margins: 16
            wrapMode: Text.WordWrap
            text: qsTr("Every open task has a day, and the next days are free.")
            color: sys.placeholderText
        }

        ScrollView {
            id: scroll
            visible: !root.empty
            Layout.fillWidth: true
            Layout.fillHeight: true
            contentWidth: availableWidth
            clip: true

            ColumnLayout {
                width: scroll.availableWidth
                spacing: 0

                ToPlanGroup {
                    objectName: "toPlanOverdue"
                    Layout.fillWidth: true
                    title: qsTr("Overdue")
                    tasks: app.overdue
                    tint: app.overdueColor
                }
                ToPlanGroup {
                    objectName: "toPlanNoDay"
                    Layout.fillWidth: true
                    title: qsTr("No day")
                    tasks: app.noDay
                }
                ToPlanGroup {
                    objectName: "toPlanComingUp"
                    Layout.fillWidth: true
                    title: qsTr("Coming up")
                    tasks: app.comingUp
                }
                Item { Layout.preferredHeight: 16 }
            }
        }
        Item {
            visible: root.empty
            Layout.fillHeight: true
        }
    }
}
