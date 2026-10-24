import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// One line of quick add and, under it, what it will become: a date phrase at the end of the line
// ("Call the accountant fri 2pm") sets the day and time; **Keep in title** keeps the words as text.
ColumnLayout {
    id: root

    property bool large: false
    property bool readPhrase: true
    readonly property var preview: app.preview(field.text, readPhrase)
    readonly property alias text: field.text

    signal added()
    signal cancelled()

    function focusField() {
        field.forceActiveFocus()
    }

    spacing: 4

    SystemPalette {
        id: sys
        colorGroup: SystemPalette.Active
    }

    TextField {
        id: field
        objectName: "quickAddText"
        Layout.fillWidth: true
        font.pixelSize: root.large ? 20 : 14
        // The date words stay English in every language: quick add reads the same phrases as `dayhand`.
        placeholderText: root.large ? qsTr("New task, e.g. Call the accountant fri 2pm") : qsTr("Add a task (try: Pay rent fri 9am)")
        onTextEdited: root.readPhrase = true
        onAccepted: {
            if (app.quickAdd(text, root.readPhrase)) {
                text = ""
                root.readPhrase = true
                root.added()
            }
        }
        Keys.onEscapePressed: root.cancelled()
    }

    RowLayout {
        objectName: "quickAddPreview"
        Layout.fillWidth: true
        visible: root.large || (root.preview.phrase !== undefined && root.preview.phrase !== "")
        spacing: 6

        Label {
            objectName: "quickAddWhen"
            Layout.fillWidth: true
            elide: Text.ElideRight
            font.pixelSize: 12
            color: sys.placeholderText
            text: root.preview.when === undefined
                  ? qsTr("Return adds it for today; a date at the end (tomorrow 9am, fri, 23 oct) sets the day.")
                  : root.preview.phrase ? qsTr("%1  ·  from “%2”").arg(root.preview.when).arg(root.preview.phrase) : root.preview.when
        }
        Button {
            visible: root.preview.phrase !== undefined && root.preview.phrase !== ""
            text: qsTr("Keep in title")
            flat: true
            font.pixelSize: 12
            onClicked: root.readPhrase = false
        }
    }
}
