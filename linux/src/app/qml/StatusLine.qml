import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// One line about the connection when there is something to say (offline, sending, signed out).
Rectangle {
    id: root

    signal connectClicked()

    visible: app.statusText !== ""
    implicitHeight: visible ? row.implicitHeight + 12 : 0
    color: Qt.rgba(sys.mid.r, sys.mid.g, sys.mid.b, 0.15)

    SystemPalette {
        id: sys
        colorGroup: SystemPalette.Active
    }

    RowLayout {
        id: row
        anchors.fill: parent
        anchors.leftMargin: 16
        anchors.rightMargin: 8

        Label {
            objectName: "statusText"
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            font.pixelSize: 12
            color: sys.placeholderText
            text: app.statusText
        }
        Button {
            visible: !app.connected
            text: qsTr("Connect…")
            flat: true
            onClicked: root.connectClicked()
        }
    }
}
