import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Today and the days after it, as many as fit (a week at least): each with its weekday, its number (today's in a
// circle in the accent colour) and a dot for each open task, up to three. Linux has no plan of the week to open, so a
// day only says what it holds, in its tooltip and to a screen reader.
Item {
    id: root
    objectName: "dayStrip"

    readonly property real dayWidth: 46
    readonly property int count: Math.min(app.days.length, Math.max(7, Math.floor(width / dayWidth)))

    implicitHeight: 66

    SystemPalette {
        id: sys
        colorGroup: SystemPalette.Active
    }

    Row {
        anchors.fill: parent

        Repeater {
            model: app.days.slice(0, root.count)

            delegate: Item {
                id: cell
                objectName: "dayCell"

                required property var modelData
                required property int index
                readonly property bool isToday: modelData.today === true

                width: root.width / Math.max(root.count, 1)
                height: root.height
                Accessible.role: Accessible.StaticText
                Accessible.name: modelData.label

                HoverHandler { id: dayHover }
                ToolTip.visible: dayHover.hovered
                ToolTip.delay: 600
                ToolTip.text: modelData.label

                Column {
                    anchors.horizontalCenter: parent.horizontalCenter
                    spacing: 4

                    Label {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: cell.modelData.weekday
                        font.pixelSize: 11
                        color: sys.placeholderText
                    }
                    Rectangle {
                        anchors.horizontalCenter: parent.horizontalCenter
                        width: 30
                        height: 30
                        radius: 15
                        color: cell.isToday ? sys.highlight
                                            : (dayHover.hovered ? Qt.rgba(sys.windowText.r, sys.windowText.g, sys.windowText.b, 0.07) : "transparent")

                        Label {
                            anchors.centerIn: parent
                            text: cell.modelData.number
                            font.pixelSize: 15
                            font.bold: cell.isToday
                            color: cell.isToday ? sys.highlightedText : sys.windowText
                        }
                    }
                    Row {
                        objectName: "dayDots"
                        anchors.horizontalCenter: parent.horizontalCenter
                        height: 4
                        spacing: 3

                        Repeater {
                            model: Math.min(cell.modelData.open, 3)
                            delegate: Rectangle {
                                width: 4
                                height: 4
                                radius: 2
                                color: sys.placeholderText
                            }
                        }
                    }
                }
            }
        }
    }

    Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: 1
        color: sys.mid
        opacity: 0.4
    }
}
