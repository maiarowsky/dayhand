#include "Desktop.h"
#include "SingleInstance.h"

#include <QApplication>
#include <QCommandLineParser>
#include <QIcon>
#include <QQuickStyle>

#include <cstdio>

using namespace Qt::StringLiterals;

namespace {

dayhand::LaunchOptions parseOptions(QCommandLineParser &parser, const QApplication &app)
{
    parser.setApplicationDescription(u"Dayhand: today's tasks, quick add and reminders."_s);
    parser.addHelpOption();
    parser.addVersionOption();
    parser.addOption({u"quick-add"_s, u"Open only the quick add window (for a keyboard binding)."_s});
    parser.addOption({u"background"_s, u"Start in the tray without opening the window (autostart)."_s});
    parser.addPositionalArgument(u"link"_s, u"A dayhand://pair link from `dayhand pair`."_s, u"[link]"_s);
    parser.process(app);
    return {parser.isSet(u"quick-add"_s), parser.isSet(u"background"_s), parser.positionalArguments().value(0)};
}

/// What a second `dayhand-qt` asks the running one to do.
QString messageFor(const dayhand::LaunchOptions &options)
{
    if (!options.link.isEmpty())
        return u"open "_s + options.link;
    if (options.quickAdd)
        return u"quick-add"_s;
    return options.background ? QString() : u"show"_s;
}

} // namespace

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);
    QApplication::setApplicationName(u"dayhand"_s);
    QApplication::setApplicationDisplayName(u"Dayhand"_s);
    QApplication::setApplicationVersion(QStringLiteral(DAYHAND_VERSION));
    // The Wayland app id and the name of the .desktop file, which Hyprland window rules and notifications use.
    QGuiApplication::setDesktopFileName(u"io.github.maiarowsky.dayhand"_s);
    QApplication::setWindowIcon(QIcon::fromTheme(u"io.github.maiarowsky.dayhand"_s, QIcon(u":/icons/io.github.maiarowsky.dayhand.svg"_s)));
    if (qEnvironmentVariableIsEmpty("QT_QUICK_CONTROLS_STYLE"))
        QQuickStyle::setStyle(u"Fusion"_s);

    QCommandLineParser parser;
    const dayhand::LaunchOptions options = parseOptions(parser, app);

    dayhand::SingleInstance instance(dayhand::SingleInstance::defaultName());
    const QString message = messageFor(options);
    if (instance.sendToRunning(message.isEmpty() ? u"ping"_s : message))
        return 0;
    if (!instance.listen())
        std::fprintf(stderr, "dayhand-qt: another copy cannot reach this one (the socket could not be made)\n");

    try {
        dayhand::Desktop desktop(dayhand::AppEnvironment::standard());
        QObject::connect(&instance, &dayhand::SingleInstance::messageReceived, &desktop, &dayhand::Desktop::handleMessage);
        if (!desktop.start(options))
            return 1;
        return QApplication::exec();
    } catch (const dayhand::StoreError &error) {
        // Without its database the app cannot show anything true.
        std::fprintf(stderr, "dayhand-qt: %s\n", error.what());
        return 1;
    }
}
