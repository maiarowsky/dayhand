#include "Notifier.h"

#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusMessage>
#include <QDBusReply>
#include <QVariantMap>

using namespace Qt::StringLiterals;

namespace dayhand {

namespace {

constexpr int defaultTimeout = -1;
const QString interfaceName = u"org.freedesktop.Notifications"_s;

} // namespace

Notifier::Notifier(QObject *parent)
    : QObject(parent)
{
    QDBusConnection bus = QDBusConnection::sessionBus();
    if (!bus.isConnected())
        return;
    const QString name = QString::fromLatin1(service);
    const QString objectPath = QString::fromLatin1(path);
    bus.connect(name, objectPath, interfaceName, u"ActionInvoked"_s, this, SLOT(onActionInvoked(uint, QString)));
    bus.connect(name, objectPath, interfaceName, u"NotificationClosed"_s, this, SLOT(onClosed(uint, uint)));
}

bool Notifier::available() const
{
    const QDBusConnection bus = QDBusConnection::sessionBus();
    return bus.isConnected() && bus.interface()
        && bus.interface()->isServiceRegistered(QString::fromLatin1(service)).value();
}

uint Notifier::show(const QString &title, const QString &body, const QString &taskId)
{
    QDBusConnection bus = QDBusConnection::sessionBus();
    if (!bus.isConnected())
        return 0;
    const bool reminder = !taskId.isEmpty();
    QStringList actions{QString::fromLatin1(openAction), tr("Open")};
    if (reminder)
        actions << QString::fromLatin1(doneAction) << tr("Done");
    const QVariantMap hints{
        {u"urgency"_s, QVariant::fromValue<uchar>(reminder ? 1 : 0)},
        {u"desktop-entry"_s, u"io.github.maiarowsky.dayhand"_s},
        {u"category"_s, reminder ? u"reminder"_s : u"summary"_s},
    };
    QDBusMessage call = QDBusMessage::createMethodCall(QString::fromLatin1(service), QString::fromLatin1(path),
                                                       interfaceName, u"Notify"_s);
    call << u"Dayhand"_s << uint(0) << u"io.github.maiarowsky.dayhand"_s << title << body << actions << hints
         << defaultTimeout;
    const QDBusReply<uint> reply = bus.call(call, QDBus::Block, 5'000);
    if (!reply.isValid())
        return 0;
    shown.insert(reply.value(), taskId);
    return reply.value();
}

void Notifier::onActionInvoked(uint id, const QString &action)
{
    const auto found = shown.constFind(id);
    if (found == shown.constEnd())
        return;
    const QString taskId = *found;
    if (action == QLatin1StringView(doneAction) && !taskId.isEmpty())
        emit doneRequested(taskId);
    else
        emit openRequested(taskId);
}

void Notifier::onClosed(uint id, uint)
{
    shown.remove(id);
}

} // namespace dayhand
