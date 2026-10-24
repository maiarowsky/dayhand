import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// The small quick add window for `dayhand-qt --quick-add` (a Hyprland binding): one field, and a line saying
// what will be added. Return adds and closes, Escape closes. Its title is what a window rule matches.
Window {
    id: root

    function openWindow() {
        field.readPhrase = true
        root.show()
        root.raise()
        root.requestActivate()
        field.focusField()
    }

    title: "Dayhand quick add"
    objectName: "quickAddWindow"
    flags: Qt.Dialog
    width: 560
    height: content.implicitHeight + 32
    minimumWidth: 360
    color: sys.window

    SystemPalette {
        id: sys
        colorGroup: SystemPalette.Active
    }

    ColumnLayout {
        id: content
        anchors.fill: parent
        anchors.margins: 16

        QuickAddField {
            id: field
            Layout.fillWidth: true
            large: true
            onAdded: root.close()
            onCancelled: root.close()
        }
    }

    Shortcut {
        sequences: [StandardKey.Cancel]
        onActivated: root.close()
    }
}
