#pragma once

#include <QLocale>
#include <QString>
#include <QStringList>

namespace dayhand::Translations {

/// The languages Dayhand speaks: English (the source language) first, then the translations, as codes like `pt_BR`.
QStringList available();

/// The language to use for a preference: the preference when Dayhand has it, otherwise (empty, "system" or unknown)
/// the first of the system's UI languages that Dayhand has, otherwise English.
QString resolve(const QString &preference, const QLocale &system = QLocale::system());

/// The language's own name, for the language menu ("Polski", "日本語").
QString nativeName(const QString &language);

/**
 * Makes [language] the application's language: its translation over English (whose file carries the plural forms
 * of the source texts), and the default QLocale. Replaces what an earlier call installed. False when the
 * translation could not be loaded, in which case the texts stay English.
 */
bool install(const QString &language);

/// The language [install] made current ("en" before any call).
QString current();

} // namespace dayhand::Translations
