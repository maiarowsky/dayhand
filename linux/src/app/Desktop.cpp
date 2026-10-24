#include "Desktop.h"

#include <QApplication>
#include <QQmlContext>

#include <algorithm>

using namespace Qt::StringLiterals;

namespace dayhand {

Desktop::Desktop(AppEnvironment environment, QObject *parent)
    : QObject(parent)
    , model(std::make_unique<AppModel>(std::move(environment)))
    , systemPalette(QGuiApplication::palette())
{
    notifier = std::make_unique<Notifier>();
    reminders = std::make_unique<ReminderClock>(*model, [this](const PlannedNotification &n) { ring(n); });
    connect(notifier.get(), &Notifier::doneRequested, model.get(), [this](const QString &taskId) {
        const auto task = std::find_if(model->tasks().begin(), model->tasks().end(),
                                       [&taskId](const TaskItem &t) { return t.localId == taskId; });
        if (task != model->tasks().end() && task->status != TaskStatus::Done)
            model->toggleDone(taskId);
    });
    connect(notifier.get(), &Notifier::openRequested, this, &Desktop::showMainRequested);
    connect(&palette, &PaletteFile::changed, this, &Desktop::applyPalette);
    connect(model.get(), &AppModel::languageChanged, &engine, &QQmlEngine::retranslate);
    applyPalette();
}

Desktop::~Desktop() = default;

bool Desktop::start(const LaunchOptions &options)
{
    if (QSystemTrayIcon::isSystemTrayAvailable()) {
        tray = std::make_unique<Tray>(*model);
        connect(tray.get(), &Tray::showWindowRequested, this, &Desktop::showMainRequested);
        connect(tray.get(), &Tray::quickAddRequested, this, &Desktop::quickAddRequested);
        connect(tray.get(), &Tray::quitRequested, qApp, &QCoreApplication::quit);
    }
    // Without a tray, closing the last window quits, as there would be no way back to the app.
    QGuiApplication::setQuitOnLastWindowClosed(!trayAvailable());
    engine.rootContext()->setContextProperty(u"app"_s, model.get());
    engine.rootContext()->setContextProperty(u"desktop"_s, this);
    engine.setInitialProperties({{u"startHidden"_s, options.background || options.quickAdd}});
    engine.loadFromModule("Dayhand", "Main");
    if (engine.rootObjects().isEmpty())
        return false;
    if (options.quickAdd)
        emit quickAddRequested();
    if (!options.link.isEmpty())
        handleMessage(u"open "_s + options.link);
    reminders->check();
    return true;
}

void Desktop::handleMessage(const QString &message)
{
    if (message == u"ping") {
        // `--background` while Dayhand already runs: nothing to do.
    } else if (message == u"quick-add") {
        emit quickAddRequested();
    } else if (message.startsWith(u"open ")) {
        emit showMainRequested();
        model->openLink(message.mid(5));
    } else {
        emit showMainRequested();
    }
}

void Desktop::applyPalette()
{
    const PaletteColors colors = palette.colors();
    if (palette.current().isEmpty()) {
        // No file: the platform theme's palette, which also follows its light and dark switch.
        if (paletteFromFile)
            QGuiApplication::setPalette(systemPalette);
        paletteFromFile = false;
        return;
    }
    QGuiApplication::setPalette(colors.applyTo(systemPalette));
    paletteFromFile = true;
    if (const auto overdue = colors.overdue())
        model->setOverdueColor(*overdue);
}

void Desktop::ring(const PlannedNotification &notification)
{
    const bool reminder = notification.kind == PlannedNotification::Kind::Reminder;
    notifier->show(notification.title, notification.body, reminder ? notification.taskLocalId : QString());
}

} // namespace dayhand
