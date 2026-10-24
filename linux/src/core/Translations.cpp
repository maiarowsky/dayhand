#include "Translations.h"

#include <QCoreApplication>
#include <QTranslator>

#include <memory>

using namespace Qt::StringLiterals;

namespace dayhand::Translations {

namespace {

struct Language {
    const char *code;
    const char *name;
};

const Language languages[] = {
    {"en", "English"},
    {"pl", "Polski"},
    {"de", "Deutsch"},
    {"es", "Español"},
    {"fr", "Français"},
    {"pt_BR", "Português (Brasil)"},
    {"ja", "日本語"},
    {"zh_CN", "简体中文"},
};

std::unique_ptr<QTranslator> english;
std::unique_ptr<QTranslator> chosen;
QString active = u"en"_s;

std::unique_ptr<QTranslator> load(const QString &language)
{
    auto translator = std::make_unique<QTranslator>();
    if (!translator->load(u":/i18n/dayhand_%1.qm"_s.arg(language)))
        return nullptr;
    return translator;
}

/// `pt-BR`, `pt_BR` and `pt_BR.UTF-8` alike.
QString normalize(QString code)
{
    code.replace(u'-', u'_');
    return code.section(u'.', 0, 0);
}

} // namespace

QStringList available()
{
    QStringList out;
    for (const Language &language : languages)
        out.append(QString::fromLatin1(language.code));
    return out;
}

QString resolve(const QString &preference, const QLocale &system)
{
    const QStringList known = available();
    const QString wanted = normalize(preference);
    if (known.contains(wanted))
        return wanted;
    for (const QString &ui : system.uiLanguages(QLocale::TagSeparator::Underscore)) {
        const QString code = normalize(ui);
        if (known.contains(code))
            return code;
        // A Portuguese or Chinese system in another region still gets the one variant there is.
        const QString base = code.section(u'_', 0, 0);
        for (const QString &language : known)
            if (language.section(u'_', 0, 0) == base)
                return language;
    }
    return u"en"_s;
}

QString nativeName(const QString &language)
{
    for (const Language &entry : languages)
        if (language == QLatin1StringView(entry.code))
            return QString::fromUtf8(entry.name);
    return language;
}

bool install(const QString &language)
{
    if (english)
        QCoreApplication::removeTranslator(english.get());
    if (chosen)
        QCoreApplication::removeTranslator(chosen.get());
    chosen.reset();
    english = load(u"en"_s);
    if (english)
        QCoreApplication::installTranslator(english.get());
    bool loaded = english != nullptr;
    if (language != u"en") {
        chosen = load(language);
        loaded = chosen != nullptr;
        if (chosen)
            QCoreApplication::installTranslator(chosen.get());
    }
    active = loaded ? language : u"en"_s;
    QLocale::setDefault(QLocale(active));
    return loaded;
}

QString current()
{
    return active;
}

} // namespace dayhand::Translations
