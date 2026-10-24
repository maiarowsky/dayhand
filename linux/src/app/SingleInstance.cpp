#include "SingleInstance.h"

#include <QDir>
#include <QLocalSocket>

#include <unistd.h>

using namespace Qt::StringLiterals;

namespace dayhand {

SingleInstance::SingleInstance(QString name, QObject *parent)
    : QObject(parent)
    , name(std::move(name))
{
    connect(&server, &QLocalServer::newConnection, this, &SingleInstance::accept);
}

QString SingleInstance::defaultName()
{
    const QString runtime = qEnvironmentVariable("XDG_RUNTIME_DIR");
    const QString file = u"dayhand-qt-%1.socket"_s.arg(getuid());
    return runtime.isEmpty() ? file : QDir(runtime).filePath(file);
}

bool SingleInstance::sendToRunning(const QString &message, int timeoutMs) const
{
    QLocalSocket socket;
    socket.connectToServer(name);
    if (!socket.waitForConnected(timeoutMs))
        return false;
    socket.write(message.toUtf8().left(maxMessage) + '\n');
    if (!socket.waitForBytesWritten(timeoutMs))
        return false;
    socket.disconnectFromServer();
    return true;
}

bool SingleInstance::listen()
{
    // Only the user may connect: the messages open windows and pairing links.
    server.setSocketOptions(QLocalServer::UserAccessOption);
    if (server.listen(name))
        return true;
    // A socket left by a process that crashed: nobody answers on it (checked by the caller first), so it goes.
    QLocalServer::removeServer(name);
    return server.listen(name);
}

void SingleInstance::accept()
{
    while (QLocalSocket *socket = server.nextPendingConnection()) {
        connect(socket, &QLocalSocket::disconnected, socket, &QObject::deleteLater);
        connect(socket, &QLocalSocket::readyRead, this, [this, socket] {
            if (!socket->canReadLine() && socket->bytesAvailable() < maxMessage)
                return;
            const QString message = QString::fromUtf8(socket->readLine(maxMessage)).trimmed();
            socket->disconnectFromServer();
            if (!message.isEmpty())
                emit messageReceived(message);
        });
    }
}

} // namespace dayhand
