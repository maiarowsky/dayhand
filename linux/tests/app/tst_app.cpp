#include "Desktop.h"
#include "PaletteFile.h"
#include "ReminderClock.h"
#include "SingleInstance.h"
#include "TestSupport.h"
#include "Translations.h"

#include <QQuickItem>
#include <QQuickStyle>
#include <QQuickWindow>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>

#include <algorithm>
#include <memory>

using namespace Qt::StringLiterals;
using namespace dayhand;
using dayhand::test::utc;

namespace {

/// A model on an in-memory database, with no keyring, no network and a clock the test moves.
AppEnvironment environment(const std::shared_ptr<qint64> &now, const QString &dir)
{
    AppEnvironment env;
    env.databasePath = u":memory:"_s;
    env.credentials = std::make_unique<MemoryCredentialStore>();
    env.preferences = std::make_unique<QSettings>(QDir(dir).filePath(u"dayhand-qt.conf"_s), QSettings::IniFormat);
    // English whatever the machine's language, unless a test switches it.
    env.preferences->setValue(u"language"_s, u"en"_s);
    env.clock = [now] { return *now; };
    env.localTimezone = [] { return u"UTC"_s; };
    env.sync = false;
    env.deviceName = u"Test"_s;
    return env;
}

QStringList titles(const QVariantList &rows)
{
    QStringList out;
    for (const QVariant &row : rows)
        out.append(row.toMap().value(u"title"_s).toString());
    return out;
}

QString idOf(const AppModel &model, const QString &title)
{
    for (const TaskItem &task : model.tasks())
        if (task.title == title)
            return task.localId;
    return {};
}

std::optional<TaskItem> taskTitled(const AppModel &model, const QString &title)
{
    for (const TaskItem &task : model.tasks())
        if (task.title == title)
            return task;
    return std::nullopt;
}

/// Items by objectName, through the visual tree (Repeater delegates have no QObject parent to search).
void collect(QQuickItem *item, const QString &name, QList<QQuickItem *> &out)
{
    if (item->objectName() == name)
        out.append(item);
    for (QQuickItem *child : item->childItems())
        collect(child, name, out);
}

QList<QQuickItem *> items(QQuickWindow *window, const QString &name)
{
    QList<QQuickItem *> out;
    collect(window->contentItem(), name, out);
    // Popups (dialogs) live in the overlay, which is outside the content item.
    if (QQuickItem *overlay = window->property("overlay").value<QQuickItem *>())
        collect(overlay, name, out);
    return out;
}

QQuickItem *item(QQuickWindow *window, const QString &name)
{
    for (QQuickItem *found : items(window, name))
        if (found->isVisible())
            return found;
    return nullptr;
}

void click(QQuickWindow *window, QQuickItem *target)
{
    const QPointF centre = target->mapToScene(QPointF(target->width() / 2, target->height() / 2));
    QTest::mouseClick(window, Qt::LeftButton, {}, centre.toPoint());
}

/// Scrolls a detail control into the viewport before real mouse/keyboard interaction.
void reveal(QQuickWindow *window, QQuickItem *target)
{
    // Archive/Restore changes visibility in a Flow; measure only after its next layout frame.
    QTest::qWait(20);
    QQuickItem *scroll = item(window, u"detailsScroll"_s);
    if (!scroll)
        return;
    auto *flick = scroll->property("contentItem").value<QQuickItem *>();
    if (!flick)
        return;
    auto *content = flick->property("contentItem").value<QQuickItem *>();
    if (!content)
        return;
    const qreal y = target->mapToItem(content, QPointF()).y();
    const qreal maximum = std::max(qreal(0), flick->property("contentHeight").toReal() - flick->height());
    flick->setProperty("contentY", std::clamp(y - flick->height() / 2, qreal(0), maximum));
    QCoreApplication::processEvents();
}

/// Types [text] into the focused item of [window] (QTest::keyClicks takes widgets only).
void typeText(QWindow *window, const QString &text)
{
    for (const QChar c : text)
        QTest::keyClick(window, c.toLatin1());
}

QQuickWindow *windowTitled(const QString &title)
{
    for (QWindow *window : QGuiApplication::topLevelWindows())
        if (window->title() == title)
            return qobject_cast<QQuickWindow *>(window);
    return nullptr;
}

/// The visible task row titled [title] (agenda or To plan), or nothing.
QQuickItem *rowTitled(QQuickWindow *window, const QString &title)
{
    for (QQuickItem *row : items(window, u"taskRow"_s))
        if (row->isVisible() && row->property("task").toMap().value(u"title"_s).toString() == title)
            return row;
    return nullptr;
}

/// Saves a picture of [window] when `DAYHAND_SNAPSHOT_DIR` names a folder (for the report; tests pass without it).
void snapshot(QQuickWindow *window, const QString &name)
{
    const QString dir = qEnvironmentVariable("DAYHAND_SNAPSHOT_DIR");
    if (dir.isEmpty())
        return;
    QDir().mkpath(dir);
    QVERIFY(window->grabWindow().save(QDir(dir).filePath(name)));
}

} // namespace

class TestApp : public QObject {
    Q_OBJECT

private slots:
    void initTestCase();
    void quickAddReadsTheDatePhrase();
    void sectionsFollowTheDay();
    void reminderRingsOnceWhenDue();
    void reminderSettingsReplanTheRunningClock();
    void reminderTooLateIsDropped();
    void paletteFileSetsColours();
    void secondCopyHandsItsRequestOver();
    void windowShowsTodayAndAddsTasks();
    void agendaShowsTheDaysAndToPlanShareTheRightSideWithDetails();
    void toPlanKeepsItsPlaceWhileATaskOrTrashIsOpen();
    void detailsEditTheLocalRowAndKeepSelection();
    void quickAddWindowAddsAndCloses();
    void connectOpensWhenNotConnected();
    void languageSwitchesAtOnce();

private:
    QTemporaryDir home;
};

void TestApp::initTestCase()
{
    QVERIFY(home.isValid());
    // No palette file from the machine running the tests: the system palette only.
    qputenv("XDG_CONFIG_HOME", QDir(home.path()).filePath(u"config"_s).toUtf8());
    qputenv("XDG_STATE_HOME", QDir(home.path()).filePath(u"state"_s).toUtf8());
    qunsetenv("DAYHAND_PALETTE");
    QQuickStyle::setStyle(u"Fusion"_s);
}

void TestApp::quickAddReadsTheDatePhrase()
{
    QTemporaryDir dir;
    auto now = std::make_shared<qint64>(utc(u"2026-10-24T09:00"_s)); // a Saturday
    AppModel model(environment(now, dir.path()));

    const QVariantMap preview = model.preview(u"Pay rent fri 9am"_s);
    QCOMPARE(preview.value(u"title"_s).toString(), u"Pay rent"_s);
    QCOMPARE(preview.value(u"phrase"_s).toString(), u"fri 9am"_s);
    QVERIFY2(preview.value(u"when"_s).toString().contains(u"09:00"_s), qPrintable(preview.value(u"when"_s).toString()));
    QCOMPARE(model.preview(u"Pay rent fri 9am"_s, false).value(u"title"_s).toString(), u"Pay rent fri 9am"_s);
    QVERIFY(model.preview(u"   "_s).isEmpty());

    QVERIFY(model.quickAdd(u"Pay rent fri 9am"_s));
    QVERIFY(model.quickAdd(u"Read chapter 3"_s));
    QVERIFY(model.quickAdd(u"Watch tomorrow"_s, false));
    QVERIFY(!model.quickAdd(u"   "_s));

    const auto rent = taskTitled(model, u"Pay rent"_s);
    QVERIFY(rent);
    QCOMPARE(rent->dueDate, std::optional<QString>(u"2026-10-30"_s));
    QCOMPARE(rent->dueTime, std::optional<QString>(u"09:00"_s));
    QCOMPARE(taskTitled(model, u"Read chapter 3"_s)->dueDate, std::optional<QString>(u"2026-10-24"_s));
    QCOMPARE(taskTitled(model, u"Watch tomorrow"_s)->dueDate, std::optional<QString>(u"2026-10-24"_s));
    QStringList today = titles(model.today());
    today.sort();
    QCOMPARE(today, (QStringList{u"Read chapter 3"_s, u"Watch tomorrow"_s}));
    // Every change waits in the outbox for the server.
    QCOMPARE(model.pendingCount(), 3);
}

void TestApp::sectionsFollowTheDay()
{
    QTemporaryDir dir;
    auto now = std::make_shared<qint64>(utc(u"2026-10-24T09:00"_s));
    AppModel model(environment(now, dir.path()));
    QVERIFY(model.planEmpty());
    QCOMPARE(model.dateTitle(), u"Sat 24 Oct"_s);
    model.quickAdd(u"Call the bank"_s);
    model.quickAdd(u"Buy milk"_s);
    QCOMPARE(model.openCount(), 2);

    // The next morning both are overdue.
    *now = utc(u"2026-10-25T08:00"_s);
    QSignalSpy sections(&model, &AppModel::sectionsChanged);
    model.reload();
    QCOMPARE(sections.count(), 1);
    QCOMPARE(model.overdueCount(), 2);
    QVERIFY(model.today().isEmpty());
    QVERIFY(model.overdue().first().toMap().value(u"overdue"_s).toBool());

    model.moveToToday(idOf(model, u"Call the bank"_s));
    QCOMPARE(titles(model.today()), QStringList{u"Call the bank"_s});
    QCOMPARE(titles(model.overdue()), QStringList{u"Buy milk"_s});

    model.setNow(idOf(model, u"Call the bank"_s));
    QCOMPARE(model.nowTask().value(u"title"_s).toString(), u"Call the bank"_s);
    QVERIFY(model.today().isEmpty());
    model.clearNow();
    QVERIFY(model.nowTask().isEmpty());

    model.toggleDone(idOf(model, u"Call the bank"_s));
    QCOMPARE(titles(model.done()), QStringList{u"Call the bank"_s});
    model.toggleDone(idOf(model, u"Call the bank"_s));
    QVERIFY(model.done().isEmpty());

    model.moveToTomorrow(idOf(model, u"Buy milk"_s));
    QCOMPARE(taskTitled(model, u"Buy milk"_s)->dueDate, std::optional<QString>(u"2026-10-26"_s));
    model.moveToTrash(idOf(model, u"Call the bank"_s));
    QVERIFY(model.planEmpty());
}

void TestApp::reminderRingsOnceWhenDue()
{
    QTemporaryDir dir;
    auto now = std::make_shared<qint64>(utc(u"2026-10-24T08:58"_s));
    AppModel model(environment(now, dir.path()));
    model.quickAdd(u"Standup 9am"_s);
    QList<PlannedNotification> rung;
    {
        ReminderClock clock(model, [&rung](const PlannedNotification &n) { rung.append(n); });
        clock.check();
        QVERIFY(rung.isEmpty());

        *now = utc(u"2026-10-24T09:00"_s) + 30'000;
        clock.check();
        QCOMPARE(rung.size(), 1);
        QCOMPARE(rung.first().kind, PlannedNotification::Kind::Reminder);
        QCOMPARE(rung.first().taskLocalId, idOf(model, u"Standup"_s));
        QCOMPARE(rung.first().title, u"Standup"_s);
        clock.check();
        QCOMPARE(rung.size(), 1);
    }
    // A restart remembers what has rung.
    ReminderClock restarted(model, [&rung](const PlannedNotification &n) { rung.append(n); });
    restarted.check();
    QCOMPARE(rung.size(), 1);
}

void TestApp::reminderSettingsReplanTheRunningClock()
{
    QTemporaryDir dir;
    auto now = std::make_shared<qint64>(utc(u"2026-10-24T08:49"_s));
    AppModel model(environment(now, dir.path()));
    model.quickAdd(u"Synthetic standup 9am"_s);
    QList<PlannedNotification> rung;
    ReminderClock clock(model, [&rung](const PlannedNotification &n) { rung.append(n); });
    clock.check(); // The old plan has nothing due within the next minute.
    QSignalSpy settings(&model, &AppModel::reminderSettingsChanged);

    // Changing a default must replace the existing timer, not wait for its minute-long poll.
    *now = utc(u"2026-10-24T08:50"_s) - 40;
    model.setDefaultReminder(10, true);
    QCOMPARE(settings.count(), 1);
    QCOMPARE(model.settings().reminderMinutes, (QList<int>{0, 10}));
    *now += 40;
    QTRY_COMPARE_WITH_TIMEOUT(rung.size(), 1, 2'000);
    QCOMPARE(rung.first().kind, PlannedNotification::Kind::Reminder);
    QCOMPARE(rung.first().at, *now);
    QCOMPARE(rung.first().taskLocalId, idOf(model, u"Synthetic standup"_s));

    model.setDefaultReminder(0, false);
    *now = utc(u"2026-10-24T08:51"_s) - 40;
    model.setSummaryTime(u"08:51"_s);
    QCOMPARE(model.summaryTime(), u"08:51"_s);
    *now += 40;
    QTRY_COMPARE_WITH_TIMEOUT(rung.size(), 2, 2'000);
    QCOMPARE(rung.last().kind, PlannedNotification::Kind::Summary);
    QCOMPARE(rung.last().at, *now);

    // Empty defaults cancel the old at-time reminder too; already handled rings never repeat.
    model.setDefaultReminder(10, false);
    QVERIFY(model.settings().reminderMinutes.isEmpty());
    *now = utc(u"2026-10-24T09:00"_s);
    clock.check();
    QCOMPARE(rung.size(), 2);
}

void TestApp::reminderTooLateIsDropped()
{
    QTemporaryDir dir;
    auto now = std::make_shared<qint64>(utc(u"2026-10-24T08:58"_s));
    AppModel model(environment(now, dir.path()));
    model.quickAdd(u"Standup 9am"_s);
    QList<PlannedNotification> rung;
    ReminderClock clock(model, [&rung](const PlannedNotification &n) { rung.append(n); });
    // The laptop slept through it: 20 minutes late is too late to ring.
    *now = utc(u"2026-10-24T09:20"_s);
    clock.check();
    QVERIFY(rung.isEmpty());
}

void TestApp::paletteFileSetsColours()
{
    const PaletteColors colors = PaletteColors::parse(
        u"# Dayhand palette from the Omarchy theme\n"
        "[colors]\n"
        "background = \"#1a1b26\"\n"
        "foreground = '#c0caf5'\n"
        "accent=#7aa2f7 ; inline comments are not part of the value\n"
        "red = #f7768e\n"
        "unknown = #000000\n"
        "broken = not-a-colour\n"_s);
    const QPalette system(Qt::white);
    const QPalette themed = colors.applyTo(system);
    QCOMPARE(themed.color(QPalette::Window), QColor(u"#1a1b26"_s));
    QCOMPARE(themed.color(QPalette::WindowText), QColor(u"#c0caf5"_s));
    QCOMPARE(themed.color(QPalette::Highlight), QColor(u"#7aa2f7"_s));
    QCOMPARE(colors.overdue(), std::optional<QColor>(QColor(u"#f7768e"_s)));
    QVERIFY(!colors.colors.contains(u"broken"_s));

    // An explicit overdue colour wins over red; no colours leave the system's.
    QCOMPARE(PaletteColors::parse(u"red = #ff0000\noverdue = #00ff00\n"_s).overdue(),
             std::optional<QColor>(QColor(u"#00ff00"_s)));
    QCOMPARE(PaletteColors::parse(QString()).applyTo(system), system);
}

void TestApp::secondCopyHandsItsRequestOver()
{
    QTemporaryDir dir;
    const QString name = QDir(dir.path()).filePath(u"dayhand.socket"_s);
    SingleInstance nobody(name);
    QVERIFY(!nobody.sendToRunning(u"show"_s, 200));

    SingleInstance running(name);
    QVERIFY(running.listen());
    QSignalSpy received(&running, &SingleInstance::messageReceived);
    SingleInstance second(name);
    QVERIFY(second.sendToRunning(u"quick-add"_s));
    QTRY_COMPARE(received.count(), 1);
    QCOMPARE(received.first().first().toString(), u"quick-add"_s);
    QVERIFY(second.sendToRunning(u"open dayhand://pair?url=https%3A%2F%2Fexample.convex.site&code=ABCD-EFGH-JKMN"_s));
    QTRY_COMPARE(received.count(), 2);
    QVERIFY(received.at(1).first().toString().startsWith(u"open dayhand://pair?"_s));
}

void TestApp::windowShowsTodayAndAddsTasks()
{
    QTemporaryDir dir;
    auto now = std::make_shared<qint64>(utc(u"2026-10-23T10:00"_s));
    Desktop desktop(environment(now, dir.path()));
    AppModel &model = desktop.appModel();
    model.quickAdd(u"Send the invoice to Kowalski & Co"_s);
    *now = utc(u"2026-10-24T09:10"_s);
    model.reload();
    model.quickAdd(u"Review the pull request"_s);
    model.quickAdd(u"Dentist 4:30pm"_s);
    model.quickAdd(u"Water the plants"_s);
    model.setNow(idOf(model, u"Review the pull request"_s));
    model.quickAdd(u"Book train tickets"_s);
    model.toggleDone(idOf(model, u"Book train tickets"_s));
    model.useOffline();

    QVERIFY(desktop.start({}));
    auto *window = qobject_cast<QQuickWindow *>(desktop.qmlEngine().rootObjects().value(0));
    QVERIFY(window);
    QCOMPARE(window->title(), u"Dayhand"_s);
    // A narrow window: no To plan beside the agenda, so the overdue tasks lead it.
    window->resize(440, 720);
    QVERIFY(QTest::qWaitForWindowExposed(window));
    window->requestActivate();
    QVERIFY(QTest::qWaitForWindowActive(window));

    QQuickItem *overdue = item(window, u"overdueHeader"_s);
    QVERIFY(overdue);
    QCOMPARE(overdue->property("text").toString(), u"Overdue (1)"_s);
    QVERIFY(item(window, u"nowRow"_s));
    QCOMPARE(item(window, u"doneHeader"_s)->property("text").toString(), u"▸ Done (1)"_s);
    QVERIFY(!item(window, u"emptyToday"_s));
    snapshot(window, u"today.png"_s);

    // Quick add in the window: the line under the field says what the date phrase means.
    QQuickItem *field = item(window, u"quickAddText"_s);
    QVERIFY(field);
    field->forceActiveFocus();
    typeText(window, u"Pay rent tomorrow 9am"_s);
    QTRY_VERIFY(item(window, u"quickAddWhen"_s));
    QVERIFY2(item(window, u"quickAddWhen"_s)->property("text").toString().contains(u"tomorrow 9am"_s),
             qPrintable(item(window, u"quickAddWhen"_s)->property("text").toString()));
    snapshot(window, u"today-typing.png"_s);
    QTest::keyClick(window, Qt::Key_Return);
    const auto rent = taskTitled(model, u"Pay rent"_s);
    QVERIFY(rent);
    QCOMPARE(rent->dueDate, std::optional<QString>(u"2026-10-25"_s));
    QCOMPARE(rent->dueTime, std::optional<QString>(u"09:00"_s));
    QCOMPARE(field->property("text").toString(), QString());

    // Ticking a task off with its circle moves it to Done.
    const int openBefore = model.openCount();
    QList<QQuickItem *> circles;
    for (QQuickItem *circle : items(window, u"doneBox"_s))
        if (circle->isVisible())
            circles.append(circle);
    QVERIFY(!circles.isEmpty());
    click(window, circles.first());
    QTRY_COMPARE(model.openCount(), openBefore - 1);
    QTRY_COMPARE(item(window, u"doneHeader"_s)->property("text").toString(), u"▸ Done (2)"_s);

    // The done section unfolds.
    click(window, item(window, u"doneHeader"_s));
    QTRY_COMPARE(item(window, u"doneHeader"_s)->property("text").toString(), u"▾ Done (2)"_s);
    snapshot(window, u"today-done-open.png"_s);
}

void TestApp::agendaShowsTheDaysAndToPlanShareTheRightSideWithDetails()
{
    QTemporaryDir dir;
    auto now = std::make_shared<qint64>(utc(u"2026-10-23T10:00"_s));
    Desktop desktop(environment(now, dir.path()));
    AppModel &model = desktop.appModel();
    model.quickAdd(u"Send the invoice"_s);
    *now = utc(u"2026-10-24T09:10"_s); // a Saturday morning
    model.reload();
    model.quickAdd(u"Call the bank 2pm"_s);
    model.quickAdd(u"Water the plants"_s);
    model.quickAdd(u"Dentist mon 10am"_s);
    model.quickAdd(u"Write the cards tue"_s);
    model.quickAdd(u"Far away wed"_s);
    model.quickAdd(u"Idea for the garden"_s);
    model.clearDue(idOf(model, u"Idea for the garden"_s));
    model.quickAdd(u"Book train tickets"_s);
    model.toggleDone(idOf(model, u"Book train tickets"_s));
    TaskItem plants = *model.database().task(idOf(model, u"Water the plants"_s));
    plants.repeat = RepeatRule();
    plants.repeat->every = RepeatEvery::Week;
    model.database().save(plants);
    model.reload();
    model.useOffline();

    // The model: the strip of days, the sentence about the day and To plan, with the Mac's semantics.
    const QVariantList days = model.days();
    QCOMPARE(days.size(), 14);
    QCOMPARE(days.first().toMap().value(u"date"_s).toString(), u"2026-10-24"_s);
    QVERIFY(days.first().toMap().value(u"today"_s).toBool());
    QCOMPARE(days.first().toMap().value(u"weekday"_s).toString(), u"Sat"_s);
    QList<int> open;
    for (const QVariant &day : days.mid(0, 5))
        open.append(day.toMap().value(u"open"_s).toInt());
    QCOMPARE(open, (QList<int>{2, 0, 1, 1, 1}));
    QCOMPARE(days.value(2).toMap().value(u"label"_s).toString(), u"Mon 26 Oct: 1 open"_s);
    QVariantMap summary = model.daySummary();
    QCOMPARE(summary.value(u"sentence"_s).toString(), u"Good morning. 2 on today's plan."_s);
    QCOMPARE(summary.value(u"timed"_s).toString(), u"1 at a set time"_s);
    QCOMPARE(summary.value(u"repeating"_s).toString(), u"1 repeating"_s);
    QCOMPARE(summary.value(u"overdue"_s).toString(), u"1 overdue"_s);
    QCOMPARE(titles(model.noDay()), QStringList{u"Idea for the garden"_s});
    // The next three days, not the fourth.
    QCOMPARE(titles(model.comingUp()), (QStringList{u"Dentist"_s, u"Write the cards"_s}));
    QCOMPARE(model.comingUp().first().toMap().value(u"detail"_s).toString(), u"Mon 26 Oct, 10:00"_s);
    QCOMPARE(model.today().first().toMap().value(u"time"_s).toString(), u"14:00"_s);

    QVERIFY(desktop.start({}));
    auto *window = qobject_cast<QQuickWindow *>(desktop.qmlEngine().rootObjects().value(0));
    QVERIFY(window);
    window->resize(1000, 720);
    QVERIFY(QTest::qWaitForWindowExposed(window));
    window->requestActivate();
    QVERIFY(QTest::qWaitForWindowActive(window));

    // A wide window with nothing open: the agenda and To plan beside it, the overdue task there and not in the agenda.
    QTRY_VERIFY(item(window, u"toPlanPanel"_s));
    QVERIFY(item(window, u"dayStrip"_s));
    int cells = 0;
    for (QQuickItem *cell : items(window, u"dayCell"_s))
        cells += cell->isVisible() ? 1 : 0;
    QVERIFY2(cells >= 7 && cells <= 14, qPrintable(QString::number(cells)));
    QCOMPARE(item(window, u"daySentence"_s)->property("text").toString(), u"Good morning. 2 on today's plan."_s);
    QVERIFY(item(window, u"summaryTimed"_s));
    QVERIFY(item(window, u"summaryRepeating"_s));
    QVERIFY(item(window, u"summaryOverdue"_s));
    QVERIFY(!item(window, u"overdueHeader"_s));
    QVERIFY(item(window, u"toPlanOverdue"_s));
    QVERIFY(item(window, u"toPlanNoDay"_s));
    QVERIFY(item(window, u"toPlanComingUp"_s));
    QVERIFY(!item(window, u"toPlanHeader"_s));
    QVERIFY(!item(window, u"detailsPanel"_s));
    QCOMPARE(item(window, u"anyTimeHeader"_s)->property("text").toString(), u"Any time"_s);
    QStringList times;
    for (QQuickItem *time : items(window, u"rowTime"_s))
        if (time->isVisible() && !time->property("text").toString().isEmpty())
            times.append(time->property("text").toString());
    QCOMPARE(times, QStringList{u"14:00"_s});
    QVERIFY(rowTitled(window, u"Idea for the garden"_s));
    QVERIFY(!rowTitled(window, u"Far away"_s));
    // Only the To plan a window can show builds rows: the agenda's folded copy and a narrow window's panel hold none.
    const auto rowsTitled = [&](const QString &title) {
        int count = 0;
        for (QQuickItem *row : items(window, u"taskRow"_s))
            count += row->property("task").toMap().value(u"title"_s).toString() == title ? 1 : 0;
        return count;
    };
    QCOMPARE(rowsTitled(u"Idea for the garden"_s), 1);
    snapshot(window, u"agenda-wide.png"_s);

    // The to-do bar and the ↻ counter take the Mac's pair for the window: the darker one on a light window, the
    // lighter one on a dark window.
    const auto bar = [&] {
        QList<QQuickItem *> bars;
        collect(rowTitled(window, u"Call the bank"_s), u"statusBar"_s, bars);
        return bars.value(0)->property("color").value<QColor>();
    };
    const auto repeating = [&] {
        return item(window, u"summaryRepeating"_s)->childItems().value(0)->property("color").value<QColor>();
    };
    const QPalette systemPalette = QGuiApplication::palette();
    QGuiApplication::setPalette(QPalette(QColor(u"#f4f4f4"_s)));
    QTRY_COMPARE(bar(), QColor(u"#4a7c00"_s));
    QCOMPARE(repeating(), QColor(u"#626d28"_s));
    QGuiApplication::setPalette(QPalette(QColor(u"#1a1b26"_s)));
    QTRY_COMPARE(bar(), QColor(u"#cedc85"_s));
    QCOMPARE(repeating(), QColor(u"#8e9a3f"_s));
    QGuiApplication::setPalette(systemPalette);

    // A task opens its details in To plan's place; the agenda keeps its rows, the overdue task stays out of it.
    click(window, rowTitled(window, u"Idea for the garden"_s));
    QTRY_COMPARE(model.selectedTask().value(u"title"_s).toString(), u"Idea for the garden"_s);
    QTRY_VERIFY(item(window, u"detailsPanel"_s));
    QVERIFY(!item(window, u"toPlanPanel"_s));
    QCOMPARE(rowsTitled(u"Idea for the garden"_s), 1);
    QVERIFY(item(window, u"todayList"_s));
    QVERIFY(!item(window, u"overdueHeader"_s));
    QVERIFY(!rowTitled(window, u"Send the invoice"_s));
    QCOMPARE(item(window, u"detailsBack"_s)->property("text").toString(), u"Close"_s);
    model.openDetails(idOf(model, u"Call the bank"_s));
    QTRY_VERIFY(rowTitled(window, u"Call the bank"_s)->property("selected").toBool());
    snapshot(window, u"agenda-wide-details.png"_s);
    click(window, item(window, u"detailsBack"_s));
    QTRY_VERIFY(item(window, u"toPlanPanel"_s));
    QVERIFY(!item(window, u"overdueHeader"_s));

    // Moved to today, the overdue task leaves To plan for the agenda and the sentence counts it.
    QVERIFY(item(window, u"toPlanOverdue"_s));
    model.moveToToday(idOf(model, u"Send the invoice"_s));
    QTRY_VERIFY(!item(window, u"toPlanOverdue"_s));
    QCOMPARE(item(window, u"daySentence"_s)->property("text").toString(), u"Good morning. 3 on today's plan."_s);
    QVERIFY(!item(window, u"summaryOverdue"_s));
    TaskItem invoice = *model.database().task(idOf(model, u"Send the invoice"_s));
    invoice.dueDate = u"2026-10-23"_s;
    model.database().save(invoice);
    model.reload();
    QTRY_VERIFY(item(window, u"toPlanOverdue"_s));

    // A narrow window: no To plan beside; the overdue tasks lead the agenda and To plan folds in at its end.
    window->resize(440, 720);
    QTRY_VERIFY(!item(window, u"toPlanPanel"_s));
    QVERIFY(item(window, u"dayStrip"_s));
    QCOMPARE(item(window, u"overdueHeader"_s)->property("text").toString(), u"Overdue (1)"_s);
    QQuickItem *toPlan = item(window, u"toPlanHeader"_s);
    QVERIFY(toPlan);
    QCOMPARE(toPlan->property("text").toString(), u"▸ To plan (3)"_s);
    QVERIFY(!item(window, u"toPlanNoDay"_s));
    QTRY_COMPARE(rowsTitled(u"Idea for the garden"_s), 0);
    click(window, toPlan);
    QTRY_COMPARE(item(window, u"toPlanHeader"_s)->property("text").toString(), u"▾ To plan (3)"_s);
    QVERIFY(item(window, u"toPlanNoDay"_s));
    QTRY_COMPARE(rowsTitled(u"Idea for the garden"_s), 1);
    QVERIFY(item(window, u"toPlanComingUp"_s));
    snapshot(window, u"agenda-narrow.png"_s);

    // A short window gives the strip's room to the tasks; the greeting follows the hour.
    window->resize(440, 500);
    QTRY_VERIFY(!item(window, u"dayStrip"_s));
    *now = utc(u"2026-10-24T19:30"_s);
    model.reload();
    QTRY_COMPARE(item(window, u"daySentence"_s)->property("text").toString(), u"Good evening. 2 on today's plan."_s);
}

void TestApp::toPlanKeepsItsPlaceWhileATaskOrTrashIsOpen()
{
    QTemporaryDir dir;
    auto now = std::make_shared<qint64>(utc(u"2026-10-24T09:10"_s));
    Desktop desktop(environment(now, dir.path()));
    AppModel &model = desktop.appModel();
    for (int i = 1; i <= 30; ++i) {
        const QString title = u"Idea %1"_s.arg(i);
        QVERIFY(model.quickAdd(title, false));
        model.clearDue(idOf(model, title));
    }
    model.useOffline();
    QCOMPARE(model.noDay().size(), 30);

    QVERIFY(desktop.start({}));
    auto *window = qobject_cast<QQuickWindow *>(desktop.qmlEngine().rootObjects().value(0));
    QVERIFY(window);
    window->resize(1000, 720);
    QVERIFY(QTest::qWaitForWindowExposed(window));
    window->requestActivate();
    QVERIFY(QTest::qWaitForWindowActive(window));

    // To plan scrolled down, a task opened from it and closed again: To plan is where it was. Trash likewise.
    QTRY_VERIFY(item(window, u"toPlanPanel"_s));
    auto *list = item(window, u"toPlanScroll"_s)->property("contentItem").value<QQuickItem *>();
    QVERIFY(list);
    QTRY_VERIFY(list->property("contentHeight").toReal() > list->height() + 400);
    list->setProperty("contentY", 400);
    QCoreApplication::processEvents();
    QQuickItem *row = nullptr;
    for (QQuickItem *candidate : items(window, u"taskRow"_s)) {
        const QPointF centre = candidate->mapToItem(list, QPointF(0, candidate->height() / 2));
        if (candidate->isVisible() && centre.y() > 0 && centre.y() < list->height()) {
            row = candidate;
            break;
        }
    }
    QVERIFY(row);
    const QString title = row->property("task").toMap().value(u"title"_s).toString();
    click(window, row);
    QTRY_COMPARE(model.selectedTask().value(u"title"_s).toString(), title);
    QTRY_VERIFY(!item(window, u"toPlanPanel"_s));
    click(window, item(window, u"detailsBack"_s));
    QTRY_VERIFY(item(window, u"toPlanPanel"_s));
    QTest::qWait(50);
    QCOMPARE(list->property("contentY").toReal(), 400.0);

    window->setProperty("trashOpen", true);
    QTRY_VERIFY(!item(window, u"toPlanPanel"_s));
    window->setProperty("trashOpen", false);
    QTRY_VERIFY(item(window, u"toPlanPanel"_s));
    QTest::qWait(50);
    QCOMPARE(list->property("contentY").toReal(), 400.0);
}

void TestApp::detailsEditTheLocalRowAndKeepSelection()
{
    QTemporaryDir dir;
    auto now = std::make_shared<qint64>(utc(u"2026-10-24T09:10"_s));
    Desktop desktop(environment(now, dir.path()));
    AppModel &model = desktop.appModel();
    model.useOffline();
    model.quickAdd(u"Plan synthetic release 2pm"_s);
    const QString id = idOf(model, u"Plan synthetic release"_s);
    // Synthetic fields that arrive from another client; L1 previews them without offering editors.
    TaskItem seed = *model.database().task(id);
    RepeatRule repeat;
    repeat.every = RepeatEvery::Week;
    seed.repeat = repeat;
    seed.reminders = QList<TaskReminder>{TaskReminder::before(15), TaskReminder::at(u"18:00"_s, 1)};
    seed.links = {{u"https://example.invalid/release"_s, u"Synthetic release link"_s}};
    model.database().save(seed);
    model.reload();
    QVERIFY(desktop.start({}));
    auto *window = qobject_cast<QQuickWindow *>(desktop.qmlEngine().rootObjects().value(0));
    QVERIFY(window);
    window->resize(980, 900);
    QVERIFY(QTest::qWaitForWindowExposed(window));
    window->requestActivate();
    QVERIFY(QTest::qWaitForWindowActive(window));
    QVERIFY(item(window, u"taskDetailsTarget"_s));
    click(window, item(window, u"taskDetailsTarget"_s));
    QTRY_COMPARE(model.selectedTask().value(u"id"_s).toString(), id);
    QVERIFY(item(window, u"todayList"_s));
    QVERIFY(item(window, u"detailsPanel"_s));
    QVERIFY(item(window, u"detailsPanel"_s)->x() > 0);
    QCOMPARE(item(window, u"detailsBack"_s)->property("text").toString(), u"Close"_s);
    QVERIFY(item(window, u"detailsRepeat"_s)->property("text").toString().contains(u"Every 1 week"_s));
    QVERIFY(item(window, u"detailsReminders"_s)->property("text").toString().contains(u"15 minutes before"_s));
    QVERIFY(item(window, u"detailsLink"_s)->property("text").toString().contains(u"https://example.invalid/release"_s));

    const auto replace = [&](const QString &name, const QString &text) {
        QQuickItem *field = item(window, name);
        QVERIFY(field);
        reveal(window, field);
        field->forceActiveFocus();
        QTest::keyClick(window, Qt::Key_A, Qt::ControlModifier);
        typeText(window, text);
        QTest::keyClick(window, Qt::Key_Return);
    };
    replace(u"detailsTitle"_s, u"Ship synthetic release"_s);
    QTRY_COMPARE(model.database().task(id)->title, u"Ship synthetic release"_s);
    QVERIFY(!item(window, u"detailsLabels"_s));
    replace(u"detailsChecklistAdd"_s, u"Build package"_s);
    QTRY_COMPARE(model.database().task(id)->checklist.size(), 1);
    const QString checklistId = model.database().task(id)->checklist.first().id;
    QVERIFY(!checklistId.isEmpty());
    replace(u"detailsChecklistTitle"_s, u"Test package"_s);
    QTRY_COMPARE(model.database().task(id)->checklist.first().title, u"Test package"_s);
    auto *check = item(window, u"detailsChecklistDone"_s);
    QVERIFY(check);
    reveal(window, check);
    click(window, check);
    QTRY_VERIFY(model.database().task(id)->checklist.first().done);
    QCOMPARE(model.database().task(id)->checklist.first().id, checklistId);
    replace(u"detailsChecklistAdd"_s, u"Disposable item"_s);
    QTRY_COMPARE(model.database().task(id)->checklist.size(), 2);
    auto *remove = items(window, u"detailsChecklistRemove"_s).last();
    reveal(window, remove);
    click(window, remove);
    QTRY_COMPARE(model.database().task(id)->checklist.size(), 1);
    QCOMPARE(model.database().task(id)->checklist.first().id, checklistId);

    // Invalid date phrases do not queue changes; a valid phrase is previewed and applied on Return.
    const int pending = model.pendingCount();
    replace(u"detailsDuePhrase"_s, u"not a date"_s);
    QCOMPARE(model.pendingCount(), pending);
    auto *due = item(window, u"detailsDuePhrase"_s);
    due->forceActiveFocus();
    QTest::keyClick(window, Qt::Key_A, Qt::ControlModifier);
    typeText(window, u"tomorrow 9am"_s);
    QVERIFY(item(window, u"detailsDuePreview"_s)->property("text").toString().contains(u"09:00"_s));
    QTest::keyClick(window, Qt::Key_Return);
    QTRY_COMPARE(model.database().task(id)->dueDate, std::optional<QString>(u"2026-10-25"_s));
    QCOMPARE(model.database().task(id)->dueTime, std::optional<QString>(u"09:00"_s));
    // The row has left Today, but the selected details remain.
    QVERIFY(model.today().isEmpty());
    QCOMPARE(model.selectedTask().value(u"id"_s).toString(), id);
    for (const QString &name : {u"detailsToday"_s, u"detailsRemoveTime"_s, u"detailsNoDay"_s}) {
        auto *button = item(window, name);
        reveal(window, button);
        click(window, button);
        if (name == u"detailsToday") {
            QCOMPARE(model.database().task(id)->dueDate, std::optional<QString>(u"2026-10-24"_s));
            QCOMPARE(model.database().task(id)->dueTime, std::optional<QString>(u"09:00"_s));
        } else if (name == u"detailsRemoveTime") {
            QVERIFY(!model.database().task(id)->dueTime);
            QVERIFY(model.database().task(id)->dueDate);
        } else {
            QVERIFY(!model.database().task(id)->dueDate);
            QVERIFY(!model.database().task(id)->dueTime);
        }
    }
    model.moveToToday(id);
    replace(u"detailsResume"_s, u"Next: verify archive"_s);
    QCOMPARE(model.database().task(id)->resumeNote, std::optional<QString>(u"Next: verify archive"_s));
    auto *nowBox = item(window, u"detailsNow"_s);
    reveal(window, nowBox);
    click(window, nowBox);
    QTRY_VERIFY(model.database().task(id)->isNow);
    QCOMPARE(model.database().task(id)->status, TaskStatus::Doing);
    auto *status = item(window, u"detailsStatus"_s);
    reveal(window, status);
    status->forceActiveFocus();
    QTest::keyClick(window, Qt::Key_End);
    QTRY_COMPARE(model.database().task(id)->status, TaskStatus::Done);
    QVERIFY(!model.database().task(id)->isNow);
    QTest::keyClick(window, Qt::Key_Home);
    QTRY_COMPARE(model.database().task(id)->status, TaskStatus::Todo);
    QVERIFY(!model.database().task(id)->completedAt);

    // Unrelated model refreshes must not overwrite a note waiting for its explicit Save button.
    auto *note = item(window, u"detailsNote"_s);
    reveal(window, note);
    note->forceActiveFocus();
    typeText(window, u"Synthetic release notes"_s);
    QVERIFY(!model.database().task(id)->note);
    model.setResumeNote(id, u"Next: run the package tests"_s);
    QCOMPARE(note->property("text").toString(), u"Synthetic release notes"_s);
    auto *save = item(window, u"detailsSaveNote"_s);
    reveal(window, save);
    click(window, save);
    QTRY_COMPARE(model.database().task(id)->note, std::optional<QString>(u"Synthetic release notes"_s));
    QVERIFY(!save->isEnabled());
    reveal(window, item(window, u"detailsTitle"_s));
    snapshot(window, u"details-wide.png"_s);

    // Narrow windows have a separate page with Back; resizing does not change selection.
    window->resize(420, 760);
    QTRY_VERIFY(!item(window, u"todayList"_s));
    QCOMPARE(item(window, u"detailsBack"_s)->property("text").toString(), u"Back"_s);
    snapshot(window, u"details-narrow.png"_s);
    click(window, item(window, u"detailsBack"_s));
    QTRY_VERIFY(model.selectedTask().isEmpty());
    QVERIFY(item(window, u"todayList"_s));
    click(window, item(window, u"taskDetailsTarget"_s));
    QTRY_COMPARE(model.selectedTask().value(u"id"_s).toString(), id);

    auto *archive = item(window, u"detailsArchive"_s);
    reveal(window, archive);
    click(window, archive);
    QTRY_VERIFY(model.database().task(id)->archivedAt);
    QVERIFY(item(window, u"detailsPanel"_s));
    auto *restore = item(window, u"detailsRestore"_s);
    reveal(window, restore);
    click(window, restore);
    QTRY_VERIFY(!model.database().task(id)->archivedAt);
    auto *trash = item(window, u"detailsTrash"_s);
    reveal(window, trash);
    click(window, trash);
    QTRY_VERIFY(model.database().task(id)->inTrash());
    QVERIFY(item(window, u"detailsTitle"_s)->property("readOnly").toBool());
    QVERIFY(item(window, u"detailsNote"_s)->property("readOnly").toBool());
    QVERIFY(item(window, u"detailsChecklistAdd"_s)->property("readOnly").toBool());
    QVERIFY(!item(window, u"detailsStatus"_s)->isEnabled());
    QVERIFY(!item(window, u"detailsNow"_s)->isEnabled());
    QVERIFY(!item(window, u"detailsSaveNote"_s)->isEnabled());
    QVERIFY(!item(window, u"detailsChecklistDone"_s)->isEnabled());
    const int beforeRestore = model.pendingCount();
    model.rename(id, u"Ignored in trash"_s);
    QCOMPARE(model.pendingCount(), beforeRestore);
    QCOMPARE(model.database().task(id)->title, u"Ship synthetic release"_s);
    reveal(window, item(window, u"detailsTitle"_s));
    snapshot(window, u"details-trash.png"_s);
    restore = item(window, u"detailsRestore"_s);
    reveal(window, restore);
    click(window, restore);
    QTRY_VERIFY(!model.database().task(id)->inTrash());
    QVERIFY(!item(window, u"detailsTitle"_s)->property("readOnly").toBool());
    QCOMPARE(model.pendingCount(), beforeRestore + 1);
    model.setLanguage(u"pl"_s);
    QTRY_COMPARE(item(window, u"detailsBack"_s)->property("text").toString(), u"Wstecz"_s);
    QVERIFY(item(window, u"detailsRepeat"_s)->property("text").toString().contains(u"Co 1 tydzień"_s));
    model.setLanguage(u"en"_s);
}

void TestApp::quickAddWindowAddsAndCloses()
{
    QTemporaryDir dir;
    auto now = std::make_shared<qint64>(utc(u"2026-10-24T09:10"_s));
    Desktop desktop(environment(now, dir.path()));
    desktop.appModel().useOffline();
    QVERIFY(desktop.start({true, false, {}}));

    auto *main = qobject_cast<QQuickWindow *>(desktop.qmlEngine().rootObjects().value(0));
    QVERIFY(main);
    QVERIFY(!main->isVisible());
    QQuickWindow *quick = windowTitled(u"Dayhand quick add"_s);
    QVERIFY(quick);
    QTRY_VERIFY(quick->isVisible());
    QVERIFY(QTest::qWaitForWindowExposed(quick));
    QVERIFY(QTest::qWaitForWindowActive(quick));
    QCOMPARE(quick->width(), 560);

    typeText(quick, u"Call the accountant fri 2pm"_s);
    QTRY_VERIFY(item(quick, u"quickAddWhen"_s)->property("text").toString().contains(u"14:00"_s));
    snapshot(quick, u"quick-add.png"_s);
    QTest::keyClick(quick, Qt::Key_Return);
    QTRY_VERIFY(!quick->isVisible());
    const auto added = taskTitled(desktop.appModel(), u"Call the accountant"_s);
    QVERIFY(added);
    QCOMPARE(added->dueDate, std::optional<QString>(u"2026-10-30"_s));
    QCOMPARE(added->dueTime, std::optional<QString>(u"14:00"_s));

    // Again from a second `dayhand-qt --quick-add`; Escape closes without adding.
    desktop.handleMessage(u"quick-add"_s);
    QTRY_VERIFY(quick->isVisible());
    QVERIFY(QTest::qWaitForWindowActive(quick));
    typeText(quick, u"Never mind"_s);
    QTest::keyClick(quick, Qt::Key_Escape);
    QTRY_VERIFY(!quick->isVisible());
    QVERIFY(!taskTitled(desktop.appModel(), u"Never mind"_s));
    QVERIFY(!main->isVisible());
}

void TestApp::connectOpensWhenNotConnected()
{
    QTemporaryDir dir;
    auto now = std::make_shared<qint64>(utc(u"2026-10-24T09:10"_s));
    Desktop desktop(environment(now, dir.path()));
    QVERIFY(desktop.start({}));
    auto *window = qobject_cast<QQuickWindow *>(desktop.qmlEngine().rootObjects().value(0));
    QVERIFY(QTest::qWaitForWindowExposed(window));
    QTRY_VERIFY(item(window, u"connectAddress"_s));
    QVERIFY(item(window, u"emptyToday"_s));
    snapshot(window, u"connect.png"_s);

    // A pairing link fills it in.
    desktop.handleMessage(u"open dayhand://pair?url=https%3A%2F%2Fexample.convex.site&code=ABCD-EFGH-JKMN"_s);
    QTRY_COMPARE(item(window, u"connectAddress"_s)->property("text").toString(), u"https://example.convex.site"_s);
    QCOMPARE(item(window, u"connectCode"_s)->property("text").toString(), u"ABCD-EFGH-JKMN"_s);
}

void TestApp::languageSwitchesAtOnce()
{
    QTemporaryDir dir;
    auto now = std::make_shared<qint64>(utc(u"2026-10-23T10:00"_s));
    Desktop desktop(environment(now, dir.path()));
    AppModel &model = desktop.appModel();
    model.quickAdd(u"Send the invoice"_s);
    *now = utc(u"2026-10-24T09:10"_s);
    model.reload();
    model.quickAdd(u"Water the plants"_s);
    model.quickAdd(u"Call mum"_s);
    model.useOffline();
    QVERIFY(desktop.start({}));
    auto *window = qobject_cast<QQuickWindow *>(desktop.qmlEngine().rootObjects().value(0));
    QVERIFY(QTest::qWaitForWindowExposed(window));
    QCOMPARE(item(window, u"todayTitle"_s)->property("text").toString(), u"Today"_s);

    QSignalSpy changed(&model, &AppModel::languageChanged);
    model.setLanguage(u"pl"_s);
    QCOMPARE(changed.count(), 1);
    QCOMPARE(model.language(), u"pl"_s);
    QCOMPARE(Translations::current(), u"pl"_s);
    QTRY_COMPARE(item(window, u"todayTitle"_s)->property("text").toString(), u"Dzisiaj"_s);
    QCOMPARE(item(window, u"daySentence"_s)->property("text").toString(), u"Dzień dobry. 2 zadania na dziś."_s);
    QCOMPARE(model.daySummary().value(u"overdue"_s).toString(), u"1 zaległe"_s);
    window->resize(440, 720);
    QTRY_VERIFY(item(window, u"overdueHeader"_s));
    QCOMPARE(item(window, u"overdueHeader"_s)->property("text").toString(), u"Zaległe (1)"_s);
    QCOMPARE(model.dateTitle(), u"sob 24 paź"_s);
    QCOMPARE(model.statusText(), u"Brak połączenia z serwerem; zadania zostają na tym komputerze."_s);
    QCOMPARE(model.overdue().first().toMap().value(u"detail"_s).toString(), u"Wczoraj"_s);
    QCOMPARE(model.languages().value(2).toMap().value(u"name"_s).toString(), u"Polski"_s);
    // Polish has three plural forms.
    QCOMPARE(ReminderPlanner::summaryTitle({2, 5, std::nullopt}), u"2 zadania na dziś, 5 zaległych"_s);
    snapshot(window, u"today-pl.png"_s);

    // A longer word for Now (French) stays inside the time column, the same width as on the other rows.
    model.setNow(idOf(model, u"Call mum"_s));
    model.setLanguage(u"fr"_s);
    QTRY_VERIFY(item(window, u"nowRow"_s));
    QList<QQuickItem *> found;
    collect(item(window, u"nowRow"_s), u"rowTime"_s, found);
    QQuickItem *nowTime = found.value(0);
    QTRY_COMPARE(nowTime->property("text").toString(), u"Maintenant"_s);
    QTRY_COMPARE(nowTime->width(), 44.0);
    QTRY_VERIFY2(nowTime->property("contentWidth").toReal() <= nowTime->width(),
                 qPrintable(QString::number(nowTime->property("contentWidth").toReal())));

    // Empty follows the system's language.
    model.setLanguage(QString());
    QCOMPARE(model.language(), QString());
    QCOMPARE(Translations::current(), Translations::resolve(QString()));
    model.setLanguage(u"en"_s);
    QTRY_COMPARE(item(window, u"todayTitle"_s)->property("text").toString(), u"Today"_s);
}

QTEST_MAIN(TestApp)
#include "tst_app.moc"
