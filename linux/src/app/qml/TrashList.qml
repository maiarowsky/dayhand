import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// No permanent-delete action: the server purges tasks 30 days after deletion.
ScrollView {
    id: root
    objectName: "trashList"

    contentWidth: availableWidth
    clip: true

    SystemPalette {
        id: sys
        colorGroup: SystemPalette.Active
    }

    ColumnLayout {
        width: root.availableWidth
        spacing: 4

        Label {
            visible: app.trash.length === 0
            Layout.fillWidth: true
            Layout.topMargin: 64
            Layout.margins: 16
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.WordWrap
            text: qsTr("Trash is empty.")
            color: sys.placeholderText
        }

        Repeater {
            model: app.trash
            delegate: RowLayout {
                required property var modelData
                Layout.fillWidth: true
                Layout.margins: 12
                spacing: 8

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 4
                    Label {
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: modelData.title
                        color: sys.windowText
                    }
                    Label {
                        objectName: "trashExpiry"
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: modelData.expiry
                        font.pixelSize: 12
                        color: sys.placeholderText
                    }
                }
                Button {
                    objectName: "trashRestore"
                    text: qsTr("Restore")
                    Accessible.name: qsTr("Restore %1").arg(modelData.title)
                    onClicked: app.restore(modelData.id)
                }
            }
        }
    }
}
