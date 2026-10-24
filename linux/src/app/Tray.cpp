#include "Tray.h"

#include "AppModel.h"

#include <QPainter>

using namespace Qt::StringLiterals;

namespace dayhand {

namespace {

QString summary(int open, int overdue)
{
    const QString today = Tray::tr("%n open task(s) today", nullptr, open);
    return overdue == 0 ? today : Tray::tr("%1, %n overdue", "1 open task today, 2 overdue", overdue).arg(today);
}

} // namespace

Tray::Tray(AppModel &model, QObject *parent)
    : QObject(parent)
    , model(model)
    , trayMenu(std::make_unique<QMenu>())
{
    plainIcon = iconFor(false);
    overdueIcon = iconFor(true);
    trayIcon.setContextMenu(trayMenu.get());
    connect(&trayIcon, &QSystemTrayIcon::activated, this, [this](QSystemTrayIcon::ActivationReason reason) {
        if (reason == QSystemTrayIcon::Trigger || reason == QSystemTrayIcon::DoubleClick)
            emit showWindowRequested();
        else if (reason == QSystemTrayIcon::MiddleClick)
            emit quickAddRequested();
    });
    connect(&model, &AppModel::sectionsChanged, this, &Tray::rebuild);
    connect(&model, &AppModel::statusChanged, this, &Tray::rebuild);
    rebuild();
    trayIcon.show();
}

bool Tray::available() const
{
    return QSystemTrayIcon::isSystemTrayAvailable();
}

QIcon Tray::iconFor(bool overdue) const
{
    const QIcon base = QIcon::fromTheme(u"io.github.maiarowsky.dayhand"_s, QIcon(u":/icons/io.github.maiarowsky.dayhand.svg"_s));
    if (!overdue)
        return base;
    QIcon marked;
    for (int size : {16, 22, 24, 32, 48, 64}) {
        QPixmap pixmap = base.pixmap(size, size);
        QPainter painter(&pixmap);
        painter.setRenderHint(QPainter::Antialiasing);
        const int dot = std::max(5, size * 3 / 8);
        painter.setPen(QPen(Qt::white, std::max(1, size / 16)));
        painter.setBrush(model.overdueColor());
        painter.drawEllipse(size - dot - 1, 1, dot, dot);
        painter.end();
        marked.addPixmap(pixmap);
    }
    return marked;
}

void Tray::rebuild()
{
    const int open = model.openCount();
    const int overdue = model.overdueCount();
    trayIcon.setIcon(overdue > 0 ? overdueIcon : plainIcon);
    trayIcon.setToolTip(tr("Dayhand: %1").arg(summary(open, overdue)));
    trayMenu->clear();
    trayMenu->setTitle(u"Dayhand"_s);
    trayMenu->addAction(summary(open, overdue))->setEnabled(false);
    trayMenu->addAction(tr("Quick Add…"), this, &Tray::quickAddRequested);
    trayMenu->addAction(tr("Open Dayhand"), this, &Tray::showWindowRequested);
    QVariantList tasks = model.overdue();
    if (const QVariantMap now = model.nowTask(); !now.isEmpty())
        tasks.prepend(now);
    tasks.append(model.today());
    if (!tasks.isEmpty())
        trayMenu->addSeparator();
    for (const QVariant &item : tasks.mid(0, maxTasks)) {
        const QVariantMap task = item.toMap();
        QAction *action = trayMenu->addAction(task[u"title"_s].toString());
        action->setCheckable(true);
        action->setChecked(false);
        const QString id = task[u"id"_s].toString();
        // Queued: ticking the task off rebuilds this menu, which deletes the action still sending the signal.
        connect(action, &QAction::triggered, &model, [this, id] { model.toggleDone(id); }, Qt::QueuedConnection);
    }
    if (tasks.size() > maxTasks)
        trayMenu->addAction(tr("%n more in Dayhand…", nullptr, int(tasks.size() - maxTasks)), this, &Tray::showWindowRequested);
    trayMenu->addSeparator();
    if (model.connected())
        trayMenu->addAction(tr("Sync Now"), &model, &AppModel::syncNow);
    trayMenu->addAction(tr("Quit Dayhand"), this, &Tray::quitRequested);
}

} // namespace dayhand
