#pragma once

#include <QLocalServer>
#include <QObject>
#include <QString>

namespace dayhand {

/**
 * One Dayhand per user session. The first process listens on a local socket in `$XDG_RUNTIME_DIR`; a second one
 * (`dayhand-qt --quick-add` from a Hyprland binding, a `dayhand://pair` link opened from the browser, a click on the
 * launcher) hands its request over and exits at once, so the binding opens quick add in the running app instantly.
 */
class SingleInstance final : public QObject {
    Q_OBJECT

public:
    /// `show`, `quick-add` or `open <url>`, one per connection.
    static constexpr int maxMessage = 4096;

    explicit SingleInstance(QString name, QObject *parent = nullptr);

    /// The socket for this user, in `$XDG_RUNTIME_DIR` (private to the user) when it is set.
    static QString defaultName();

    /// Sends [message] to a running instance; false when none answers.
    bool sendToRunning(const QString &message, int timeoutMs = 1'000) const;
    /// Becomes the running instance; false when the socket cannot be made.
    bool listen();

signals:
    void messageReceived(const QString &message);

private:
    void accept();

    QString name;
    QLocalServer server;
};

} // namespace dayhand
