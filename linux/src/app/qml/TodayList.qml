import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

// Today's tasks by time, in one scrolling column: overdue (when To plan is not beside it), the task worked on now,
// today's at a set time, those without one under Any time, and done today (folded). In a narrow window To plan
// follows at the end, folded: the tasks without a day and the next three days'.
ScrollView {
    id: root

    /// The overdue tasks lead the agenda whenever To plan is not shown beside it.
    property bool showsOverdue: true
    /// A narrow window: To plan folds in at the end.
    property bool showsToPlan: false
    property bool showDone: false
    property bool showToPlan: false

    readonly property var timed: app.today.filter(task => task.time !== "")
    readonly property var anyTime: app.today.filter(task => task.time === "")
    readonly property bool hasNow: app.nowTask.id !== undefined
    readonly property bool overdueShown: showsOverdue && app.overdue.length > 0
    readonly property bool agendaEmpty: !hasNow && app.today.length === 0 && app.done.length === 0 && !overdueShown
    readonly property int toPlanCount: app.noDay.length + app.comingUp.length

    signal addClicked()

    contentWidth: availableWidth
    clip: true

    SystemPalette {
        id: sys
        colorGroup: SystemPalette.Active
    }

    ColumnLayout {
        width: root.availableWidth
        spacing: 2

        ColumnLayout {
            objectName: "emptyToday"
            visible: root.agendaEmpty
            Layout.fillWidth: true
            Layout.topMargin: 48
            Layout.bottomMargin: 16
            spacing: 12

            Label {
                Layout.alignment: Qt.AlignHCenter
                text: "☀"
                font.pixelSize: 36
                color: sys.placeholderText
            }
            Label {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("Nothing planned for today.")
                font.pixelSize: 16
                color: sys.windowText
            }
            Button {
                Layout.alignment: Qt.AlignHCenter
                text: qsTr("Add Task")
                onClicked: root.addClicked()
            }
        }

        SectionHeader {
            objectName: "overdueHeader"
            visible: root.overdueShown
            text: qsTr("Overdue (%1)").arg(app.overdue.length)
            color: app.overdueColor
        }
        Repeater {
            model: root.showsOverdue ? app.overdue : []
            delegate: TaskRow {
                required property var modelData
                task: modelData
                agenda: true
                Layout.fillWidth: true
            }
        }

        Item {
            visible: root.overdueShown
            Layout.preferredHeight: 10
        }
        TaskRow {
            objectName: "nowRow"
            visible: root.hasNow
            Layout.fillWidth: true
            task: app.nowTask
            nowRow: true
            agenda: true
        }
        Label {
            objectName: "todayPlaceholder"
            visible: app.today.length === 0 && !root.agendaEmpty
            Layout.leftMargin: 78
            Layout.topMargin: 6
            Layout.bottomMargin: 6
            color: sys.placeholderText
            text: !root.overdueShown && !root.hasNow
                  ? qsTr("Nothing left for today.") : qsTr("Nothing else planned for today.")
        }
        Repeater {
            model: root.timed
            delegate: TaskRow {
                required property var modelData
                task: modelData
                agenda: true
                Layout.fillWidth: true
            }
        }

        SectionHeader {
            objectName: "anyTimeHeader"
            visible: root.anyTime.length > 0 && (root.timed.length > 0 || root.hasNow)
            text: qsTr("Any time")
        }
        Repeater {
            model: root.anyTime
            delegate: TaskRow {
                required property var modelData
                task: modelData
                agenda: true
                Layout.fillWidth: true
            }
        }

        SectionHeader {
            objectName: "doneHeader"
            visible: app.done.length > 0
            text: (root.showDone ? "▾ " : "▸ ") + qsTr("Done (%1)").arg(app.done.length)
            clickable: true
            onClicked: root.showDone = !root.showDone
        }
        Repeater {
            model: root.showDone ? app.done : []
            delegate: TaskRow {
                required property var modelData
                task: modelData
                agenda: true
                Layout.fillWidth: true
            }
        }

        SectionHeader {
            objectName: "toPlanHeader"
            visible: root.showsToPlan && root.toPlanCount > 0
            text: (root.showToPlan ? "▾ " : "▸ ") + qsTr("To plan (%1)").arg(root.toPlanCount)
            clickable: true
            onClicked: root.showToPlan = !root.showToPlan
        }
        ToPlanGroup {
            objectName: "toPlanNoDay"
            visible: root.showsToPlan && root.showToPlan && tasks.length > 0
            Layout.fillWidth: true
            title: qsTr("No day")
            tasks: app.noDay
        }
        ToPlanGroup {
            objectName: "toPlanComingUp"
            visible: root.showsToPlan && root.showToPlan && tasks.length > 0
            Layout.fillWidth: true
            title: qsTr("Coming up")
            tasks: app.comingUp
        }

        Item { Layout.preferredHeight: 16 }
    }
}
