#include "PaletteFile.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QRegularExpression>
#include <QStandardPaths>

using namespace Qt::StringLiterals;

namespace dayhand {

namespace {

struct Role {
    const char *key;
    QPalette::ColorRole role;
};

/// Names as Omarchy's colors.toml spells them, mapped to the palette roles the screens use.
constexpr Role roles[] = {
    {"background", QPalette::Window},       {"background", QPalette::Base},
    {"lighter_background", QPalette::AlternateBase},
    {"lighter_background", QPalette::Button}, {"foreground", QPalette::WindowText},
    {"foreground", QPalette::Text},         {"foreground", QPalette::ButtonText},
    {"accent", QPalette::Highlight},        {"accent", QPalette::Accent},
    {"selection_foreground", QPalette::HighlightedText},
    {"muted", QPalette::PlaceholderText},   {"muted", QPalette::Mid},
    {"accent", QPalette::Link},
};

QString unquote(QString value)
{
    value = value.trimmed();
    if (value.size() >= 2 && (value.startsWith(u'"') || value.startsWith(u'\'')) && value.back() == value.front())
        value = value.mid(1, value.size() - 2);
    return value;
}

} // namespace

PaletteColors PaletteColors::parse(const QString &text)
{
    PaletteColors out;
    for (const QString &raw : text.split(u'\n')) {
        const QString line = raw.trimmed();
        if (line.isEmpty() || line.startsWith(u'#') || line.startsWith(u';') || line.startsWith(u'['))
            continue;
        const qsizetype equals = line.indexOf(u'=');
        if (equals <= 0)
            continue;
        // A comment after the value (`accent = #7aa2f7 ; links`) is not part of it.
        static const QRegularExpression trailingComment(u"\\s+[#;].*$"_s);
        const QColor color = QColor::fromString(unquote(line.mid(equals + 1).trimmed().remove(trailingComment)));
        if (color.isValid())
            out.colors.insert(line.left(equals).trimmed().toLower(), color);
    }
    return out;
}

QPalette PaletteColors::applyTo(const QPalette &system) const
{
    QPalette palette = system;
    for (const Role &entry : roles) {
        const auto found = colors.constFind(QString::fromLatin1(entry.key));
        if (found == colors.constEnd())
            continue;
        palette.setColor(QPalette::All, entry.role, *found);
        QColor disabled = *found;
        disabled.setAlphaF(0.5F);
        palette.setColor(QPalette::Disabled, entry.role, disabled);
    }
    return palette;
}

std::optional<QColor> PaletteColors::overdue() const
{
    for (const QString &key : {u"overdue"_s, u"red"_s}) {
        if (colors.contains(key))
            return colors.value(key);
    }
    return std::nullopt;
}

PaletteFile::PaletteFile(QObject *parent)
    : QObject(parent)
{
    settle.setSingleShot(true);
    settle.setInterval(300);
    connect(&settle, &QTimer::timeout, this, &PaletteFile::reload);
    connect(&watcher, &QFileSystemWatcher::fileChanged, &settle, qOverload<>(&QTimer::start));
    connect(&watcher, &QFileSystemWatcher::directoryChanged, &settle, qOverload<>(&QTimer::start));
    reload();
}

QStringList PaletteFile::candidates()
{
    QStringList paths;
    if (const QString custom = qEnvironmentVariable("DAYHAND_PALETTE"); !custom.isEmpty())
        paths.append(custom);
    const QString config = QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation);
    paths.append(QDir(config).filePath(u"dayhand/palette.conf"_s));
    const QString state = qEnvironmentVariable("XDG_STATE_HOME", QDir::home().filePath(u".local/state"_s));
    paths.append(QDir(state).filePath(u"omarchy/current/theme/dayhand-palette.conf"_s));
    return paths;
}

void PaletteFile::reload()
{
    QString found;
    PaletteColors colors;
    for (const QString &path : candidates()) {
        QFile file(path);
        if (file.open(QIODevice::ReadOnly)) {
            found = path;
            colors = PaletteColors::parse(QString::fromUtf8(file.readAll()));
            break;
        }
    }
    const bool different = found != active || colors.colors != loaded.colors;
    active = found;
    loaded = colors;
    watch();
    if (different)
        emit changed();
}

void PaletteFile::watch()
{
    if (!watcher.files().isEmpty())
        watcher.removePaths(watcher.files());
    if (!watcher.directories().isEmpty())
        watcher.removePaths(watcher.directories());
    for (const QString &path : candidates()) {
        // Omarchy replaces the whole theme folder on a switch, so its parent is watched as well.
        const QFileInfo info(path);
        for (const QString &dir : {info.absolutePath(), QFileInfo(info.absolutePath()).absolutePath()}) {
            if (QFileInfo::exists(dir) && !watcher.directories().contains(dir))
                watcher.addPath(dir);
        }
        if (info.exists())
            watcher.addPath(path);
    }
}

} // namespace dayhand
