import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Settings: the language (the system's by default). The other settings come from the server, as on the Mac.
Dialog {
    id: root

    title: qsTr("Settings")
    modal: true
    standardButtons: Dialog.Close
    width: Math.min(parent ? parent.width - 32 : 420, 420)

    SystemPalette {
        id: sys
        colorGroup: SystemPalette.Active
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 8

        Label { text: qsTr("Language") }
        ComboBox {
            id: language
            objectName: "languageChoice"
            Layout.fillWidth: true
            model: app.languages
            textRole: "name"
            valueRole: "code"
            Component.onCompleted: currentIndex = indexOfValue(app.language)
            onActivated: app.setLanguage(currentValue)

            Connections {
                target: app
                // The list is rebuilt in the new language first, then the choice is shown again.
                function onLanguageChanged() { Qt.callLater(() => language.currentIndex = language.indexOfValue(app.language)) }
            }
        }
        Label {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            font.pixelSize: 12
            color: sys.placeholderText
            text: qsTr("Quick add reads dates in English in every language, as dayhand does: tomorrow 9am, fri, 23 oct.")
        }
    }
}
