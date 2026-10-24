import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Language stays on this computer; reminder settings save locally and travel through the outbox.
Dialog {
    id: root

    title: qsTr("Settings")
    modal: true
    standardButtons: Dialog.Close
    width: Math.min(parent ? parent.width - 32 : 420, 420)
    height: Math.min(parent ? parent.height - 32 : 620, 620)

    function twoDigits(value) { return value.toString().padStart(2, "0") }

    SystemPalette {
        id: sys
        colorGroup: SystemPalette.Active
    }

    ScrollView {
        id: settingsScroll
        anchors.fill: parent
        contentWidth: availableWidth
        clip: true

        ColumnLayout {
            width: settingsScroll.availableWidth
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

            Label {
                Layout.topMargin: 12
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: qsTr("Morning summary:")
            }
            RowLayout {
                SpinBox {
                    objectName: "summaryHour"
                    from: 0
                    to: 23
                    value: Number(app.summaryTime.slice(0, 2))
                    textFromValue: function(value) { return root.twoDigits(value) }
                    Accessible.name: qsTr("Hour")
                    onValueModified: app.setSummaryTime(root.twoDigits(value) + ":" + app.summaryTime.slice(3, 5))
                }
                Label { text: ":" }
                SpinBox {
                    objectName: "summaryMinute"
                    from: 0
                    to: 59
                    value: Number(app.summaryTime.slice(3, 5))
                    textFromValue: function(value) { return root.twoDigits(value) }
                    Accessible.name: qsTr("Minute")
                    onValueModified: app.setSummaryTime(app.summaryTime.slice(0, 2) + ":" + root.twoDigits(value))
                }
            }
            Label {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                font.pixelSize: 12
                color: sys.placeholderText
                text: qsTr("Times use %1.").arg(app.reminderTimezone)
            }

            Label {
                Layout.topMargin: 12
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: qsTr("Default reminders")
            }
            Label {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                font.pixelSize: 12
                color: sys.placeholderText
                text: qsTr("For timed tasks without their own reminders.")
            }
            Repeater {
                model: [
                    { minutes: 0, label: qsTr("At the time") },
                    { minutes: 5, label: qsTr("5 min") },
                    { minutes: 10, label: qsTr("10 min") },
                    { minutes: 15, label: qsTr("15 min") },
                    { minutes: 30, label: qsTr("30 min") },
                    { minutes: 60, label: qsTr("1 h") },
                    { minutes: 120, label: qsTr("2 h") },
                    { minutes: 1440, label: qsTr("1 day") }
                ]
                delegate: CheckBox {
                    required property var modelData
                    objectName: "defaultReminder" + modelData.minutes
                    Layout.fillWidth: true
                    text: modelData.label
                    checked: app.defaultReminderMinutes.indexOf(modelData.minutes) >= 0
                    onClicked: app.setDefaultReminder(modelData.minutes, checked)
                }
            }
        }
    }
}
