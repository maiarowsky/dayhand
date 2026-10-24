#pragma once

#include "ReminderPlanner.h"

#include <QObject>
#include <QTimer>

#include <functional>

namespace dayhand {

class AppModel;
class Notifier;

/**
 * Rings the reminders and morning summaries while Dayhand runs (in the tray). The notification service cannot keep a
 * notification for later, so the clock plans the rings from the local database ([ReminderPlanner]) and wakes for
 * the next one, at the latest every minute (a suspended laptop's timers drift). What has rung is remembered in the
 * database (`reminders.handledUntil`), so a restart does not ring it again; a ring more than 15 minutes late is
 * dropped, as on Android.
 */
class ReminderClock final : public QObject {
    Q_OBJECT

public:
    static constexpr int maxSleepMs = 60'000;
    static inline const QString handledKey = QStringLiteral("reminders.handledUntil");

    ReminderClock(AppModel &model, std::function<void(const PlannedNotification &)> ring, QObject *parent = nullptr);

    /// Plans again from the current tasks and settings, rings what is due and sets the next wake-up.
    void check();
    qint64 handledUntil() const { return handled; }

private:
    void schedule();

    AppModel &model;
    std::function<void(const PlannedNotification &)> ring;
    QTimer timer;
    qint64 handled = 0;
};

} // namespace dayhand
