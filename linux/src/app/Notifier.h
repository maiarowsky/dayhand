#pragma once

#include <QHash>
#include <QObject>
#include <QString>

namespace dayhand {

/**
 * Desktop notifications through the freedesktop notification service (`org.freedesktop.Notifications` on the
 * session bus: the Omarchy shell, mako, dunst, GNOME, KDE). A reminder has the actions **Done** and **Open**; a
 * morning summary is sent with low urgency, so it waits quietly instead of sounding. Without a session bus or a
 * notification service nothing is shown and [available] is false.
 */
class Notifier final : public QObject {
    Q_OBJECT

public:
    static constexpr const char *service = "org.freedesktop.Notifications";
    static constexpr const char *path = "/org/freedesktop/Notifications";
    static constexpr const char *doneAction = "done";
    static constexpr const char *openAction = "default";

    explicit Notifier(QObject *parent = nullptr);

    bool available() const;
    /// Shows a reminder for [taskId], or a summary when [taskId] is empty. The notification's id, 0 when not shown.
    uint show(const QString &title, const QString &body, const QString &taskId);

signals:
    /// **Done** on a reminder.
    void doneRequested(const QString &taskId);
    /// A click on a notification (empty [taskId] for a summary).
    void openRequested(const QString &taskId);

private slots:
    void onActionInvoked(uint id, const QString &action);
    void onClosed(uint id, uint reason);

private:
    QHash<uint, QString> shown;
};

} // namespace dayhand
