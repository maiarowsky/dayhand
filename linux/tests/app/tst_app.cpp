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
    void reminderTooLateIsDropped();
    void paletteFileSetsColours();
    void secondCopyHandsItsRequestOver();
    void windowShowsTodayAndAddsTasks();
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
    QCOMPARE(item(window, u"overdueHeader"_s)->property("text").toString(), u"Zaległe (1)"_s);
    QCOMPARE(model.dateTitle(), u"sob 24 paź"_s);
    QCOMPARE(model.statusText(), u"Brak połączenia z serwerem; zadania zostają na tym komputerze."_s);
    QCOMPARE(model.overdue().first().toMap().value(u"detail"_s).toString(), u"Wczoraj"_s);
    QCOMPARE(model.languages().value(2).toMap().value(u"name"_s).toString(), u"Polski"_s);
    // Polish has three plural forms.
    QCOMPARE(ReminderPlanner::summaryTitle({2, 5, std::nullopt}), u"2 zadania na dziś, 5 zaległych"_s);
    snapshot(window, u"today-pl.png"_s);

    // Empty follows the system's language.
    model.setLanguage(QString());
    QCOMPARE(model.language(), QString());
    QCOMPARE(Translations::current(), Translations::resolve(QString()));
    model.setLanguage(u"en"_s);
    QTRY_COMPARE(item(window, u"todayTitle"_s)->property("text").toString(), u"Today"_s);
}

QTEST_MAIN(TestApp)
#include "tst_app.moc"
