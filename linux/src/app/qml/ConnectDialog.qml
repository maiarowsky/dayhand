import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Connect to a server with a one-time code from `dayhand pair` (or a dayhand://pair link).
Dialog {
    id: root

    property string error: ""

    function openWith(serverUrl, code) {
        address.text = serverUrl
        pairingCode.text = code
        root.error = ""
        root.open();
        (serverUrl === "" ? address : pairingCode).forceActiveFocus();
    }

    title: qsTr("Connect to your server")
    modal: true
    closePolicy: Popup.CloseOnEscape
    width: Math.min(parent ? parent.width - 32 : 520, 520)

    Connections {
        target: app
        function onConnectFinished(error) {
            root.error = error
            if (error === "")
                root.close()
        }
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 10

        Label {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            text: qsTr("On a computer signed in to your server, run dayhand pair and type the code it shows, or open the link it prints. The code works once, for 10 minutes.")
        }
        Label { text: qsTr("Server address") }
        TextField {
            id: address
            objectName: "connectAddress"
            Layout.fillWidth: true
            placeholderText: "https://<name>.convex.site"
            inputMethodHints: Qt.ImhUrlCharactersOnly | Qt.ImhNoAutoUppercase
        }
        Label { text: qsTr("Pairing code") }
        TextField {
            id: pairingCode
            objectName: "connectCode"
            Layout.fillWidth: true
            placeholderText: "XXXX-XXXX-XXXX"
            inputMethodHints: Qt.ImhNoPredictiveText
            onAccepted: connectButton.clicked()
        }
        Label {
            objectName: "connectError"
            Layout.fillWidth: true
            visible: root.error !== ""
            wrapMode: Text.WordWrap
            text: "⚠ " + root.error
            color: app.overdueColor
        }
    }

    footer: DialogButtonBox {
        Button {
            text: qsTr("Not Now, Use Dayhand Offline")
            flat: true
            DialogButtonBox.buttonRole: DialogButtonBox.RejectRole
            onClicked: {
                app.useOffline()
                root.close()
            }
        }
        BusyIndicator {
            running: app.connecting
            visible: app.connecting
            implicitWidth: 24
            implicitHeight: 24
        }
        Button {
            id: connectButton
            text: qsTr("Connect")
            highlighted: true
            enabled: !app.connecting && address.text !== "" && pairingCode.text !== ""
            onClicked: app.connectServer(address.text, pairingCode.text)
        }
    }
}
