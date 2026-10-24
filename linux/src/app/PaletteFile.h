#pragma once

#include <QColor>
#include <QFileSystemWatcher>
#include <QHash>
#include <QObject>
#include <QPalette>
#include <QStringList>
#include <QTimer>

#include <optional>

namespace dayhand {

/// The colours a palette file sets, by name (`background = #1a1b26`).
struct PaletteColors {
    QHash<QString, QColor> colors;

    /// The system palette with the colours the file names; roles it does not name stay the system's.
    QPalette applyTo(const QPalette &system) const;
    std::optional<QColor> overdue() const;

    /// `key = value` lines; `#`/`;` comments, `[sections]` and quotes are allowed, unknown keys are kept and ignored.
    static PaletteColors parse(const QString &text);
};

/**
 * Dayhand takes its colours from the system palette (the Qt platform theme: GTK on Omarchy, KDE's colours on
 * Plasma). A palette file can set them instead: the first of `$DAYHAND_PALETTE`,
 * `$XDG_CONFIG_HOME/dayhand/palette.conf` and Omarchy's current theme folder
 * (`~/.local/state/omarchy/current/theme/dayhand-palette.conf`, written by a theme template, see docs/linux.md).
 * The file and its folder are watched, so a theme switch recolours the running app.
 */
class PaletteFile final : public QObject {
    Q_OBJECT

public:
    explicit PaletteFile(QObject *parent = nullptr);

    static QStringList candidates();
    /// The file in use now, or empty for the system palette.
    QString current() const { return active; }
    PaletteColors colors() const { return loaded; }

signals:
    void changed();

private:
    void reload();
    void watch();

    QFileSystemWatcher watcher;
    QTimer settle;
    QString active;
    PaletteColors loaded;
};

} // namespace dayhand
