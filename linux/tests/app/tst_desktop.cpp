// Notifications and the tray against fake desktop services on a private session bus (run by dbus-run-session):
// the freedesktop notification service, and a StatusNotifierWatcher such as the Omarchy shell or Waybar runs.

#include "AppModel.h"
#include "Notifier.h"
#include "TestSupport.h"
#include "Tray.h"

#include <QDBusArgument>
#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusMessage>
#include <QDBusPendingCall>
#include <QDBusVariant>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>

#include <memory>

using namespace Qt::StringLiterals;
using namespace dayhand;
using dayhand::test::utc;

namespace {

struct Shown {
    QString app;
    QString icon;
    QString summary;
    QString body;
    QStringList actions;
    QVariantMap hints;
};

} // namespace

/// `org.freedesktop.Notifications`, keeping what it was asked to show.
class FakeNotifications : public QObject {
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.freedesktop.Notifications")

public:
    QList<Shown> shown;

public slots:
    uint Notify(const QString &app, uint, const QString &icon, const QString &summary, const QString &body,
                const QStringList &actions, const QVariantMap &hints, int)
    {
        shown.append({app, icon, summary, body, actions, hints});
        return uint(shown.size());
    }
    QStringList GetCapabilities() { return {u"actions"_s, u"body"_s}; }
};

/// `org.kde.StatusNotifierWatcher`, the tray host's side, keeping the items that registered.
class FakeWatcher : public QObject {
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.kde.StatusNotifierWatcher")
    Q_PROPERTY(bool IsStatusNotifierHostRegistered READ hostRegistered)
    Q_PROPERTY(int ProtocolVersion READ protocolVersion)
    Q_PROPERTY(QStringList RegisteredStatusNotifierItems READ registeredItems)

public:
    QStringList items;
    bool hostRegistered() const { return true; }
    int protocolVersion() const { return 0; }
    QStringList registeredItems() const { return items; }

public slots:
    void RegisterStatusNotifierItem(const QString &service) { items.append(service); }
    void RegisterStatusNotifierHost(const QString &) {}
};

namespace {

/// One dbusmenu node: its id, properties (`label`, `toggle-type`, …) and children.
struct MenuNode {
    int id = 0;
    QVariantMap properties;
    QList<MenuNode> children;
};

MenuNode readNode(const QDBusArgument &argument)
{
    MenuNode node;
    argument.beginStructure();
    argument >> node.id >> node.properties;
    argument.beginArray();
    while (!argument.atEnd()) {
        QDBusVariant child;
        argument >> child;
        node.children.append(readNode(child.variant().value<QDBusArgument>()));
    }
    argument.endArray();
    argument.endStructure();
    return node;
}

/// Calls without blocking, as the tray answers on its own connection in this thread.
QDBusMessage callAndWait(const QDBusMessage &call)
{
    QDBusPendingCall pending = QDBusConnection::sessionBus().asyncCall(call, 5'000);
    QDeadlineTimer deadline(6'000);
    while (!pending.isFinished() && !deadline.hasExpired())
        QTest::qWait(20);
    return pending.reply();
}

QVariant itemProperty(const QString &service, const QString &name)
{
    QDBusMessage get = QDBusMessage::createMethodCall(service, u"/StatusNotifierItem"_s,
                                                      u"org.freedesktop.DBus.Properties"_s, u"Get"_s);
    get << u"org.kde.StatusNotifierItem"_s << name;
    const QDBusMessage reply = callAndWait(get);
    return reply.type() == QDBusMessage::ReplyMessage ? reply.arguments().value(0).value<QDBusVariant>().variant()
                                                      : QVariant();
}

AppEnvironment environment(const std::shared_ptr<qint64> &now, const QString &dir)
{
    AppEnvironment env;
    env.databasePath = u":memory:"_s;
    env.credentials = std::make_unique<MemoryCredentialStore>();
    env.preferences = std::make_unique<QSettings>(QDir(dir).filePath(u"dayhand-qt.conf"_s), QSettings::IniFormat);
    env.clock = [now] { return *now; };
    env.localTimezone = [] { return u"UTC"_s; };
    env.sync = false;
    return env;
}

} // namespace

class TestDesktop : public QObject {
    Q_OBJECT

private slots:
    void initTestCase();
    void reminderHasDoneAndOpen();
    void summaryIsQuiet();
    void trayIsAStatusNotifierItem();

private:
    FakeNotifications notifications;
    FakeWatcher watcher;
};

void TestDesktop::initTestCase()
{
    QDBusConnection bus = QDBusConnection::sessionBus();
    QVERIFY2(bus.isConnected(), "run under dbus-run-session");
    QVERIFY(bus.registerObject(u"/org/freedesktop/Notifications"_s, &notifications, QDBusConnection::ExportAllSlots));
    QVERIFY(bus.registerService(u"org.freedesktop.Notifications"_s));
    QVERIFY(bus.registerObject(u"/StatusNotifierWatcher"_s, &watcher,
                               QDBusConnection::ExportAllSlots | QDBusConnection::ExportAllProperties));
    QVERIFY(bus.registerService(u"org.kde.StatusNotifierWatcher"_s));
}

void TestDesktop::reminderHasDoneAndOpen()
{
    Notifier notifier;
    QVERIFY(notifier.available());
    const uint id = notifier.show(u"Pay rent"_s, u"Now, 09:00"_s, u"task-1"_s);
    QVERIFY(id > 0);
    const Shown shown = notifications.shown.last();
    QCOMPARE(shown.app, u"Dayhand"_s);
    QCOMPARE(shown.icon, u"io.github.maiarowsky.dayhand"_s);
    QCOMPARE(shown.summary, u"Pay rent"_s);
    QCOMPARE(shown.body, u"Now, 09:00"_s);
    QCOMPARE(shown.actions, (QStringList{u"default"_s, u"Open"_s, u"done"_s, u"Done"_s}));
    QCOMPARE(shown.hints.value(u"urgency"_s).toInt(), 1);
    QCOMPARE(shown.hints.value(u"desktop-entry"_s).toString(), u"io.github.maiarowsky.dayhand"_s);

    // Done on the notification, as the notification service reports it.
    QSignalSpy done(&notifier, &Notifier::doneRequested);
    QSignalSpy open(&notifier, &Notifier::openRequested);
    QDBusMessage action = QDBusMessage::createSignal(u"/org/freedesktop/Notifications"_s,
                                                     u"org.freedesktop.Notifications"_s, u"ActionInvoked"_s);
    action << id << u"done"_s;
    QVERIFY(QDBusConnection::sessionBus().send(action));
    QTRY_COMPARE(done.count(), 1);
    QCOMPARE(done.first().first().toString(), u"task-1"_s);
    QCOMPARE(open.count(), 0);

    // A click opens Dayhand; after the notification closed, its actions are forgotten.
    QDBusMessage click = QDBusMessage::createSignal(u"/org/freedesktop/Notifications"_s,
                                                    u"org.freedesktop.Notifications"_s, u"ActionInvoked"_s);
    click << id << u"default"_s;
    QVERIFY(QDBusConnection::sessionBus().send(click));
    QTRY_COMPARE(open.count(), 1);
    QDBusMessage closed = QDBusMessage::createSignal(u"/org/freedesktop/Notifications"_s,
                                                     u"org.freedesktop.Notifications"_s, u"NotificationClosed"_s);
    closed << id << uint(2);
    QVERIFY(QDBusConnection::sessionBus().send(closed));
    QTest::qWait(200);
    QVERIFY(QDBusConnection::sessionBus().send(click));
    QTest::qWait(200);
    QCOMPARE(open.count(), 1);
}

void TestDesktop::summaryIsQuiet()
{
    Notifier notifier;
    QVERIFY(notifier.show(u"Today"_s, u"1 task today, 2 overdue"_s, QString()) > 0);
    const Shown shown = notifications.shown.last();
    QCOMPARE(shown.actions, (QStringList{u"default"_s, u"Open"_s}));
    QCOMPARE(shown.hints.value(u"urgency"_s).toInt(), 0);
}

void TestDesktop::trayIsAStatusNotifierItem()
{
    QTemporaryDir dir;
    auto now = std::make_shared<qint64>(utc(u"2026-10-23T10:00"_s));
    AppModel model(environment(now, dir.path()));
    model.quickAdd(u"Send the invoice"_s);
    *now = utc(u"2026-10-24T09:00"_s);
    model.reload();
    model.quickAdd(u"Water the plants"_s);
    model.quickAdd(u"Dentist 4:30pm"_s);

    QVERIFY(QSystemTrayIcon::isSystemTrayAvailable());
    Tray tray(model);
    QVERIFY(tray.available());
    QTRY_COMPARE(watcher.items.size(), 1);
    const QString service = watcher.items.first();

    QCOMPARE(itemProperty(service, u"Status"_s).toString(), u"Active"_s);
    QCOMPARE(itemProperty(service, u"Category"_s).toString(), u"ApplicationStatus"_s);
    const QDBusArgument toolTip = itemProperty(service, u"ToolTip"_s).value<QDBusArgument>();
    QString iconName, title, text;
    toolTip.beginStructure();
    toolTip >> iconName;
    toolTip.beginArray();
    while (!toolTip.atEnd()) {
        toolTip.beginStructure();
        int width = 0, height = 0;
        QByteArray pixels;
        toolTip >> width >> height >> pixels;
        toolTip.endStructure();
    }
    toolTip.endArray();
    toolTip >> title >> text;
    toolTip.endStructure();
    QVERIFY2((title + text).contains(u"Dayhand: 3 open tasks today, 1 overdue"_s), qPrintable(title + u" | "_s + text));

    // The menu, as the tray host reads it over dbusmenu.
    const QString menuPath = qvariant_cast<QDBusObjectPath>(itemProperty(service, u"Menu"_s)).path();
    QVERIFY(!menuPath.isEmpty());
    QDBusMessage getLayout = QDBusMessage::createMethodCall(service, menuPath, u"com.canonical.dbusmenu"_s,
                                                            u"GetLayout"_s);
    getLayout << 0 << -1 << QStringList();
    const QDBusMessage layoutReply = callAndWait(getLayout);
    QCOMPARE(layoutReply.type(), QDBusMessage::ReplyMessage);
    const MenuNode root = readNode(layoutReply.arguments().value(1).value<QDBusArgument>());
    QStringList labels;
    int waterId = -1;
    for (const MenuNode &child : root.children) {
        const QString label = child.properties.value(u"label"_s).toString().remove(u'&');
        labels.append(label);
        if (label == u"Water the plants")
            waterId = child.id;
    }
    QVERIFY2(labels.contains(u"Quick Add…"_s), qPrintable(labels.join(u", "_s)));
    QVERIFY(labels.contains(u"Open Dayhand"_s));
    QVERIFY(labels.contains(u"Send the invoice"_s));
    QVERIFY(labels.contains(u"Quit Dayhand"_s));
    QVERIFY(waterId >= 0);

    // Ticking a task off in the tray menu.
    QDBusMessage event = QDBusMessage::createMethodCall(service, menuPath, u"com.canonical.dbusmenu"_s, u"Event"_s);
    event << waterId << u"clicked"_s << QVariant::fromValue(QDBusVariant(0)) << uint(0);
    callAndWait(event);
    QTRY_COMPARE(model.done().size(), 1);
    QCOMPARE(model.done().first().toMap().value(u"title"_s).toString(), u"Water the plants"_s);

    // A click on the icon opens the window.
    QSignalSpy show(&tray, &Tray::showWindowRequested);
    QDBusMessage activate = QDBusMessage::createMethodCall(service, u"/StatusNotifierItem"_s,
                                                           u"org.kde.StatusNotifierItem"_s, u"Activate"_s);
    activate << 0 << 0;
    callAndWait(activate);
    QTRY_COMPARE(show.count(), 1);
}

QTEST_MAIN(TestDesktop)
#include "tst_desktop.moc"
