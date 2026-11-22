import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// The main window: Today as an agenda, as on the Mac. The title and the date, a strip of the coming days, one
// sentence about the day, quick add, then the tasks by time. In a wide window the right-hand side holds To plan
// (overdue, no day, coming up) while no task is open, and the open task's details otherwise; in a narrow one the
// details are a page of their own with Back, and To plan folds in at the end of the agenda.
ApplicationWindow {
    id: window

    required property bool startHidden
    readonly property bool wide: width >= 800
    readonly property bool detailsOpen: app.selectedTask.id !== undefined
    property bool trashOpen: false
    /// To plan beside the agenda: a wide window with no task open.
    readonly property bool toPlanBeside: wide && !detailsOpen && !trashOpen

    function showMain() {
        window.show()
        window.raise()
        window.requestActivate()
        if (!app.connected && !app.offlineMode && !connectDialog.opened)
            connectDialog.openWith(app.serverUrl, "")
    }

    title: "Dayhand"
    width: 960
    height: 720
    minimumWidth: 320
    minimumHeight: 360
    visible: !startHidden
    color: sys.window

    Component.onCompleted: {
        if (!startHidden && !app.connected && !app.offlineMode)
            connectDialog.openWith(app.serverUrl, "")
    }

    SystemPalette {
        id: sys
        colorGroup: SystemPalette.Active
    }

    Connections {
        target: desktop
        function onShowMainRequested() { window.showMain() }
        function onQuickAddRequested() { quickAddWindow.openWindow() }
    }

    Connections {
        target: app
        function onConnectRequested(serverUrl, code) {
            window.showMain()
            connectDialog.openWith(serverUrl, code)
        }
    }

    header: ColumnLayout {
        visible: window.trashOpen || window.wide || !window.detailsOpen
        spacing: 0

        RowLayout {
            Layout.fillWidth: true
            Layout.leftMargin: 16
            Layout.rightMargin: 8
            Layout.topMargin: 10

            ToolButton {
                visible: window.trashOpen
                text: qsTr("Back")
                onClicked: window.trashOpen = false
            }

            Label {
                objectName: "todayTitle"
                Layout.alignment: Qt.AlignBaseline
                text: window.trashOpen ? qsTr("Trash") : qsTr("Today")
                font.pixelSize: 24
                font.bold: true
                color: sys.windowText
            }
            Label {
                objectName: "todayDate"
                visible: !window.trashOpen
                Layout.alignment: Qt.AlignBaseline
                Layout.leftMargin: 6
                Layout.fillWidth: true
                elide: Text.ElideRight
                text: app.dateTitle
                font.pixelSize: 16
                color: sys.placeholderText
            }

            Item {
                visible: window.trashOpen
                Layout.fillWidth: true
            }

            ToolButton {
                id: menuButton
                objectName: "appMenuButton"
                text: "⋯"
                font.pixelSize: 18
                Accessible.name: qsTr("Menu")
                onClicked: appMenu.open()

                Menu {
                    id: appMenu
                    y: menuButton.height

                    MenuItem {
                        text: app.connected ? qsTr("Disconnect") : qsTr("Connect…")
                        onTriggered: app.connected ? disconnectDialog.open() : connectDialog.openWith(app.serverUrl, "")
                    }
                    MenuItem {
                        objectName: "trashMenuItem"
                        text: qsTr("Trash")
                        onTriggered: {
                            app.closeDetails()
                            window.trashOpen = true
                        }
                    }
                    MenuItem {
                        objectName: "settingsMenuItem"
                        text: qsTr("Settings…")
                        onTriggered: settingsDialog.open()
                    }
                    MenuItem {
                        text: qsTr("Sync Now")
                        enabled: app.connected
                        onTriggered: app.syncNow()
                    }
                    MenuSeparator {}
                    MenuItem {
                        text: qsTr("Quit Dayhand")
                        onTriggered: Qt.quit()
                    }
                }
            }
        }

        StatusLine {
            Layout.fillWidth: true
            Layout.topMargin: 6
            onConnectClicked: connectDialog.openWith(app.serverUrl, "")
        }

        Rectangle {
            visible: window.trashOpen
            Layout.fillWidth: true
            Layout.topMargin: 10
            implicitHeight: 1
            color: sys.mid
            opacity: 0.4
        }
    }

    RowLayout {
        anchors.fill: parent
        spacing: 0

        // The agenda: the strip of days, the sentence about the day, quick add and the tasks.
        ColumnLayout {
            objectName: "agenda"
            visible: !window.trashOpen && (window.wide || !window.detailsOpen)
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 0

            DayStrip {
                // Below this height the strip makes room for the tasks.
                visible: window.height >= 560
                Layout.fillWidth: true
                Layout.leftMargin: 12
                Layout.rightMargin: 12
                Layout.topMargin: 8
            }
            DaySummary {
                Layout.fillWidth: true
                Layout.leftMargin: 16
                Layout.rightMargin: 16
                Layout.topMargin: 12
            }
            QuickAddField {
                id: inlineQuickAdd
                objectName: "inlineQuickAdd"
                Layout.fillWidth: true
                Layout.margins: 12
            }
            Rectangle {
                Layout.fillWidth: true
                implicitHeight: 1
                color: sys.mid
                opacity: 0.4
            }
            TodayList {
                objectName: "todayList"
                Layout.fillWidth: true
                Layout.fillHeight: true
                showsOverdue: !window.toPlanBeside
                showsToPlan: !window.wide
                onAddClicked: inlineQuickAdd.focusField()
            }
        }
        TrashList {
            visible: window.trashOpen
            Layout.fillWidth: true
            Layout.fillHeight: true
        }
        Rectangle {
            visible: !window.trashOpen && window.wide
            Layout.fillHeight: true
            implicitWidth: 1
            color: sys.mid
            opacity: 0.4
        }
        ToPlanPanel {
            visible: window.toPlanBeside
            Layout.preferredWidth: 300
            Layout.fillHeight: true
        }
        TaskDetails {
            visible: !window.trashOpen && window.detailsOpen
            narrow: !window.wide
            Layout.fillWidth: !window.wide
            Layout.preferredWidth: window.wide ? Math.min(480, window.width / 2) : window.width
            Layout.fillHeight: true
        }
    }

    QuickAddWindow {
        id: quickAddWindow
    }

    ConnectDialog {
        id: connectDialog
        anchors.centerIn: Overlay.overlay
    }

    SettingsDialog {
        id: settingsDialog
        anchors.centerIn: Overlay.overlay
    }

    Dialog {
        id: disconnectDialog
        anchors.centerIn: Overlay.overlay
        title: qsTr("Disconnect from the server?")
        modal: true
        standardButtons: Dialog.Cancel | Dialog.Ok
        width: Math.min(window.width - 32, 420)

        Label {
            width: parent.width
            wrapMode: Text.WordWrap
            text: qsTr("Dayhand forgets the sign-in on this computer. Your tasks and waiting changes stay here. To end it on the server too, run: dayhand revoke %1").arg(app.deviceId)
        }

        onAccepted: app.disconnectServer()
    }

    Dialog {
        id: alertDialog
        anchors.centerIn: Overlay.overlay
        title: "Dayhand"
        modal: true
        visible: app.alert !== ""
        standardButtons: Dialog.Ok
        width: Math.min(window.width - 32, 420)

        Label {
            width: parent.width
            wrapMode: Text.WordWrap
            text: app.alert
        }

        onClosed: app.dismissAlert()
    }

    onClosing: function (close) {
        // With a tray the window only hides, so reminders keep ringing; without one, closing quits.
        if (desktop.trayAvailable) {
            close.accepted = false
            window.hide()
        }
    }
}
