import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// The selected local row stays open even when a change takes it off Today.
Pane {
    id: root
    objectName: "detailsPanel"

    required property bool narrow
    property var task: app.selectedTask
    readonly property bool readOnly: task.inTrash === true
    property string loadedId: ""
    property bool ready: false
    property bool noteDirty: false
    readonly property var duePreview: {
        // Re-read generated text after a language or task/timezone change.
        let language = app.language
        let selected = root.task
        return app.previewDue(dueField.text)
    }

    function refresh() {
        if (!ready || !task.id)
            return
        let changed = loadedId !== task.id
        if (changed || !titleField.activeFocus)
            titleField.text = task.title
        if (changed || !labelsField.activeFocus)
            labelsField.text = task.labels
        if (changed || !resumeField.activeFocus)
            resumeField.text = task.resumeNote
        if (changed || !noteDirty || readOnly) {
            noteField.text = task.note
            noteDirty = false
        }
        if (changed)
            dueField.clear()
        loadedId = task.id
    }

    function applyDue() {
        if (!readOnly && duePreview.valid && app.setDuePhrase(task.id, dueField.text))
            dueField.clear()
    }

    onTaskChanged: refresh()
    Component.onCompleted: {
        ready = true
        refresh()
    }
    Keys.onEscapePressed: app.closeDetails()
    padding: 0

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        RowLayout {
            Layout.fillWidth: true
            Layout.margins: 8
            ToolButton {
                objectName: "detailsBack"
                text: root.narrow ? qsTr("Back") : qsTr("Close")
                onClicked: app.closeDetails()
            }
            Label {
                Layout.fillWidth: true
                text: qsTr("Task details")
                font.bold: true
            }
        }

        ScrollView {
            id: scroll
            objectName: "detailsScroll"
            Layout.fillWidth: true
            Layout.fillHeight: true
            contentWidth: availableWidth
            clip: true

            ColumnLayout {
                width: scroll.availableWidth
                spacing: 8

                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.margins: 16
                    spacing: 8

                    Label {
                        visible: root.readOnly || root.task.archived === true
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                        text: root.readOnly ? qsTr("In Trash — restore to edit.") : qsTr("Archived")
                    }
                    Label { text: qsTr("Title") }
                    TextField {
                        id: titleField
                        objectName: "detailsTitle"
                        Layout.fillWidth: true
                        Accessible.name: qsTr("Title")
                        readOnly: root.readOnly
                        selectByMouse: true
                        maximumLength: 500
                        property string editingId: ""
                        onActiveFocusChanged: if (activeFocus) editingId = root.task.id
                        onEditingFinished: {
                            if (!readOnly && editingId === root.task.id && text !== root.task.title
                                    && app.rename(editingId, text))
                                text = root.task.title
                        }
                    }
                    Label { text: qsTr("Status") }
                    ComboBox {
                        id: statusBox
                        objectName: "detailsStatus"
                        Layout.fillWidth: true
                        Accessible.name: qsTr("Status")
                        enabled: !root.readOnly
                        model: [qsTr("To do"), qsTr("In progress"), qsTr("Done")]
                        currentIndex: root.task.status === "done" ? 2 : (root.task.status === "doing" ? 1 : 0)
                        onActivated: app.setStatus(root.task.id, ["todo", "doing", "done"][currentIndex])
                    }
                    CheckBox {
                        objectName: "detailsNow"
                        Layout.fillWidth: true
                        text: qsTr("Working on it now")
                        checked: root.task.isNow === true
                        enabled: !root.readOnly
                        onClicked: checked ? app.setNow(root.task.id) : app.clearNow()
                    }
                    Label { text: qsTr("Where I stopped") }
                    TextField {
                        id: resumeField
                        objectName: "detailsResume"
                        Layout.fillWidth: true
                        Accessible.name: qsTr("Where I stopped")
                        readOnly: root.readOnly
                        selectByMouse: true
                        maximumLength: 2000
                        property string editingId: ""
                        onActiveFocusChanged: if (activeFocus) editingId = root.task.id
                        onEditingFinished: {
                            if (!readOnly && editingId === root.task.id && text !== root.task.resumeNote) {
                                app.setResumeNote(editingId, text)
                                text = root.task.resumeNote
                            }
                        }
                    }

                    Label { text: qsTr("Due") }
                    Label {
                        objectName: "detailsDue"
                        Layout.fillWidth: true
                        text: root.task.due || ""
                        wrapMode: Text.WordWrap
                    }
                    TextField {
                        id: dueField
                        objectName: "detailsDuePhrase"
                        Layout.fillWidth: true
                        Accessible.name: qsTr("Date phrase")
                        placeholderText: qsTr("e.g. tomorrow 9am")
                        readOnly: root.readOnly
                        selectByMouse: true
                        onAccepted: root.applyDue()
                    }
                    Label {
                        objectName: "detailsDuePreview"
                        Layout.fillWidth: true
                        visible: dueField.text.trim() !== ""
                        text: root.duePreview.valid ? qsTr("I understand: %1").arg(root.duePreview.text) : root.duePreview.text
                        wrapMode: Text.WordWrap
                    }
                    Button {
                        text: qsTr("Set date")
                        enabled: !root.readOnly && dueField.text.trim() !== "" && root.duePreview.valid
                        onClicked: root.applyDue()
                    }
                    Flow {
                        Layout.fillWidth: true
                        spacing: 4
                        Button {
                            objectName: "detailsToday"
                            text: qsTr("Today")
                            enabled: !root.readOnly
                            onClicked: app.moveToToday(root.task.id)
                        }
                        Button {
                            objectName: "detailsNoDay"
                            text: qsTr("No day")
                            enabled: !root.readOnly
                            onClicked: app.clearDue(root.task.id)
                        }
                        Button {
                            objectName: "detailsRemoveTime"
                            text: qsTr("Remove time")
                            enabled: !root.readOnly && root.task.dueTime !== ""
                            onClicked: app.removeDueTime(root.task.id)
                        }
                    }

                    Label { text: qsTr("Labels (comma-separated)") }
                    TextField {
                        id: labelsField
                        objectName: "detailsLabels"
                        Layout.fillWidth: true
                        Accessible.name: qsTr("Labels (comma-separated)")
                        readOnly: root.readOnly
                        selectByMouse: true
                        property string editingId: ""
                        onActiveFocusChanged: if (activeFocus) editingId = root.task.id
                        onEditingFinished: {
                            if (!readOnly && editingId === root.task.id && text !== root.task.labels
                                    && app.setLabels(editingId, text))
                                text = root.task.labels
                        }
                    }

                    Label { text: qsTr("Checklist"); font.bold: true }
                    Repeater {
                        model: root.task.checklist || []
                        delegate: RowLayout {
                            required property var modelData
                            Layout.fillWidth: true
                            CheckBox {
                                objectName: "detailsChecklistDone"
                                Accessible.name: modelData.title
                                checked: modelData.done
                                enabled: !root.readOnly
                                onClicked: app.toggleChecklistItem(root.task.id, modelData.id)
                            }
                            TextField {
                                objectName: "detailsChecklistTitle"
                                Layout.fillWidth: true
                                Accessible.name: qsTr("Checklist item")
                                text: modelData.title
                                maximumLength: 500
                                readOnly: root.readOnly
                                selectByMouse: true
                                property string editingId: ""
                                onActiveFocusChanged: if (activeFocus) editingId = root.task.id
                                onEditingFinished: {
                                    if (!readOnly && editingId === root.task.id && text !== modelData.title)
                                        app.renameChecklistItem(editingId, modelData.id, text)
                                }
                            }
                            ToolButton {
                                objectName: "detailsChecklistRemove"
                                text: "×"
                                Accessible.name: qsTr("Remove item")
                                enabled: !root.readOnly
                                onClicked: app.removeChecklistItem(root.task.id, modelData.id)
                            }
                        }
                    }
                    TextField {
                        id: addItem
                        objectName: "detailsChecklistAdd"
                        Layout.fillWidth: true
                        placeholderText: qsTr("Add item")
                        Accessible.name: qsTr("Add item")
                        maximumLength: 500
                        readOnly: root.readOnly
                        onAccepted: {
                            if (!readOnly && app.addChecklistItem(root.task.id, text))
                                clear()
                        }
                    }

                    Label { text: qsTr("Note"); font.bold: true }
                    TextArea {
                        id: noteField
                        objectName: "detailsNote"
                        Layout.fillWidth: true
                        Layout.preferredHeight: Math.max(100, implicitHeight)
                        Accessible.name: qsTr("Note")
                        readOnly: root.readOnly
                        selectByMouse: true
                        wrapMode: TextEdit.Wrap
                        onTextChanged: if (root.ready) root.noteDirty = text !== root.task.note
                    }
                    Button {
                        objectName: "detailsSaveNote"
                        text: qsTr("Save note")
                        enabled: !root.readOnly && root.noteDirty
                        onClicked: {
                            if (app.saveNote(root.task.id, noteField.text)) {
                                noteField.text = root.task.note
                                root.noteDirty = false
                            }
                        }
                    }

                    Label { text: qsTr("Repeat"); font.bold: true }
                    Label {
                        objectName: "detailsRepeat"
                        Layout.fillWidth: true
                        text: root.task.repeat || ""
                        textFormat: Text.PlainText
                        wrapMode: Text.WordWrap
                    }
                    Label { text: qsTr("Reminders"); font.bold: true }
                    Label {
                        objectName: "detailsReminders"
                        Layout.fillWidth: true
                        text: root.task.reminders || ""
                        wrapMode: Text.WordWrap
                    }
                    Label { text: qsTr("Links"); font.bold: true }
                    Label {
                        visible: (root.task.links || []).length === 0
                        text: qsTr("None")
                    }
                    Repeater {
                        model: root.task.links || []
                        delegate: TextArea {
                            objectName: "detailsLink"
                            required property var modelData
                            Layout.fillWidth: true
                            text: modelData.title === modelData.url ? modelData.url : modelData.title + "\n" + modelData.url
                            textFormat: TextEdit.PlainText
                            wrapMode: TextEdit.Wrap
                            readOnly: true
                            selectByMouse: true
                            background: null
                        }
                    }

                    Flow {
                        Layout.fillWidth: true
                        spacing: 8
                        Button {
                            objectName: "detailsArchive"
                            text: qsTr("Archive")
                            visible: !root.readOnly && root.task.archived !== true
                            onClicked: app.archive(root.task.id)
                        }
                        Button {
                            objectName: "detailsTrash"
                            text: qsTr("Move to Trash")
                            visible: !root.readOnly
                            onClicked: app.moveToTrash(root.task.id)
                        }
                        Button {
                            objectName: "detailsRestore"
                            text: qsTr("Restore")
                            visible: root.readOnly || root.task.archived === true
                            onClicked: app.restore(root.task.id)
                        }
                    }
                }
            }
        }
    }
}
