#pragma once

#include "AppModel.h"
#include "Notifier.h"
#include "PaletteFile.h"
#include "ReminderClock.h"
#include "Tray.h"

#include <QObject>
#include <QQmlApplicationEngine>

#include <memory>

namespace dayhand {

/// How the process was started.
struct LaunchOptions {
    /// `--quick-add`: only the small quick add window (for a Hyprland binding).
    bool quickAdd = false;
    /// `--background`: start in the tray without a window (autostart).
    bool background = false;
    /// A `dayhand://pair?…` link to open.
    QString link;
};

/**
 * The running app: the model, the QML windows (Today and quick add), the tray, the notifications and the reminder
 * clock, and the requests a second `dayhand-qt` hands over ([handleMessage]). Closing the window keeps Dayhand in
 * the tray when there is one, so reminders keep ringing.
 */
class Desktop final : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool trayAvailable READ trayAvailable CONSTANT)

public:
    Desktop(AppEnvironment environment, QObject *parent = nullptr);
    ~Desktop() override;

    /// Loads the windows; false when the QML could not be loaded.
    bool start(const LaunchOptions &options);
    /// `show`, `quick-add` or `open <url>` from another `dayhand-qt`.
    void handleMessage(const QString &message);
    bool trayAvailable() const { return tray && tray->available(); }

    AppModel &appModel() { return *model; }
    QQmlApplicationEngine &qmlEngine() { return engine; }

signals:
    /// For QML: bring the Today window up.
    void showMainRequested();
    /// For QML: open the small quick add window.
    void quickAddRequested();

private:
    void applyPalette();
    void ring(const PlannedNotification &notification);

    std::unique_ptr<AppModel> model;
    std::unique_ptr<Notifier> notifier;
    std::unique_ptr<ReminderClock> reminders;
    std::unique_ptr<Tray> tray;
    PaletteFile palette;
    /// The platform theme's palette before a palette file changed it.
    QPalette systemPalette;
    bool paletteFromFile = false;
    QQmlApplicationEngine engine;
};

} // namespace dayhand
