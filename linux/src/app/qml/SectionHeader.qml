import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// A section title on Today: "Overdue (2)", "Now", "Today", "▸ Done (3)".
Label {
    id: root

    property bool clickable: false

    signal clicked()

    Layout.fillWidth: true
    Layout.leftMargin: 16
    Layout.topMargin: 14
    Layout.bottomMargin: 4
    font.pixelSize: 13
    font.bold: true
    font.capitalization: Font.AllUppercase
    color: sys.placeholderText

    SystemPalette {
        id: sys
        colorGroup: SystemPalette.Active
    }

    MouseArea {
        anchors.fill: parent
        enabled: root.clickable
        cursorShape: root.clickable ? Qt.PointingHandCursor : Qt.ArrowCursor
        onClicked: root.clicked()
    }

    Accessible.role: clickable ? Accessible.Button : Accessible.StaticText
    Accessible.onPressAction: if (clickable) root.clicked()
}
