#pragma once

#include <QIcon>
#include <QMenu>
#include <QObject>
#include <QSystemTrayIcon>

#include <memory>

namespace dayhand {

class AppModel;

/**
 * Dayhand in the tray, as the macOS app is in the menu bar: the number of open tasks today in the tooltip (and a
 * mark on the icon when some are overdue), quick add, and today's open tasks to tick off without opening the
 * window. Qt shows it as a StatusNotifierItem over D-Bus, which the Omarchy shell's tray, Waybar's `tray` module,
 * KDE and other hosts display.
 */
class Tray final : public QObject {
    Q_OBJECT

public:
    /// Today's tasks listed in the menu; the rest are in the window.
    static constexpr int maxTasks = 10;

    explicit Tray(AppModel &model, QObject *parent = nullptr);

    bool available() const;
    QSystemTrayIcon &icon() { return trayIcon; }
    /// The menu as it is now (tests read it).
    QMenu &menu() { return *trayMenu; }

signals:
    void showWindowRequested();
    void quickAddRequested();
    void quitRequested();

private:
    void rebuild();
    QIcon iconFor(bool overdue) const;

    AppModel &model;
    QSystemTrayIcon trayIcon;
    std::unique_ptr<QMenu> trayMenu;
    QIcon plainIcon;
    QIcon overdueIcon;
};

} // namespace dayhand
