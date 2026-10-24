import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// The main window: Today, top to bottom: overdue, now, today, done (folded), as on the phone and the Mac.
ApplicationWindow {
    id: window

    required property bool startHidden
    readonly property bool wide: width >= 800
    readonly property bool detailsOpen: app.selectedTask.id !== undefined

    function showMain() {
        window.show()
        window.raise()
        window.requestActivate()
        if (!app.connected && !app.offlineMode && !connectDialog.opened)
            connectDialog.openWith(app.serverUrl, "")
    }

    title: "Dayhand"
    width: 440
    height: 680
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
        visible: window.wide || !window.detailsOpen
        spacing: 0

        RowLayout {
            Layout.fillWidth: true
            Layout.leftMargin: 16
            Layout.rightMargin: 8
            Layout.topMargin: 10

            ColumnLayout {
                spacing: 0
                Label {
                    objectName: "todayTitle"
                    text: qsTr("Today")
                    font.pixelSize: 22
                    font.bold: true
                    color: sys.windowText
                }
                Label {
                    text: app.dateTitle
                    color: sys.placeholderText
                }
            }

            Item { Layout.fillWidth: true }

            ToolButton {
                id: menuButton
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
            onConnectClicked: connectDialog.openWith(app.serverUrl, "")
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
    }

    RowLayout {
        anchors.fill: parent
        spacing: 0

        TodayList {
            objectName: "todayList"
            visible: window.wide || !window.detailsOpen
            Layout.fillWidth: true
            Layout.fillHeight: true
            onAddClicked: inlineQuickAdd.focusField()
        }
        Rectangle {
            visible: window.wide && window.detailsOpen
            Layout.fillHeight: true
            implicitWidth: 1
            color: sys.mid
            opacity: 0.4
        }
        TaskDetails {
            visible: window.detailsOpen
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
