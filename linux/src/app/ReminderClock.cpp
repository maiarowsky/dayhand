#include "ReminderClock.h"

#include "AppModel.h"

#include <algorithm>

namespace dayhand {

ReminderClock::ReminderClock(AppModel &model, std::function<void(const PlannedNotification &)> ring, QObject *parent)
    : QObject(parent)
    , model(model)
    , ring(std::move(ring))
{
    timer.setSingleShot(true);
    timer.setTimerType(Qt::PreciseTimer);
    connect(&timer, &QTimer::timeout, this, &ReminderClock::check);
    connect(&model, &AppModel::tasksChanged, this, &ReminderClock::check);
    const auto stored = model.database().meta(handledKey);
    bool ok = false;
    handled = stored ? stored->toLongLong(&ok) : 0;
    if (!ok) {
        // The first start rings nothing from before it.
        handled = model.now();
        model.database().setMeta(handledKey, QString::number(handled));
    }
}

void ReminderClock::check()
{
    const qint64 now = model.now();
    // Plan from the last handled moment, so the rings due since then are part of the plan.
    const qint64 since = std::max(handled, now - ReminderRules::lateLimitMs);
    const auto plan = ReminderPlanner::plan(model.tasks(), model.settings(), since);
    const auto due = ReminderPlanner::due(plan, now, handled);
    if (now > handled) {
        handled = now;
        model.database().setMeta(handledKey, QString::number(handled));
    }
    for (const auto &notification : due)
        ring(notification);
    schedule();
}

void ReminderClock::schedule()
{
    const qint64 now = model.now();
    const auto plan = ReminderPlanner::plan(model.tasks(), model.settings(), now);
    const auto next = ReminderPlanner::nextRing(plan, now, handled);
    const qint64 wait = next ? std::clamp<qint64>(*next - now, 0, maxSleepMs) : maxSleepMs;
    timer.start(int(wait));
}

} // namespace dayhand
