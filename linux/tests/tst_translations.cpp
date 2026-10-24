// Every text in the sources has a finished translation in every language: lupdate reads the sources afresh, and
// each translations/dayhand_<language>.ts must hold exactly those texts, translated, with the plural forms its
// language needs and the same %1/%n placeholders.

#include <QFile>
#include <QProcess>
#include <QRegularExpression>
#include <QSet>
#include <QTemporaryDir>
#include <QTest>
#include <QXmlStreamReader>

using namespace Qt::StringLiterals;

namespace {

struct Message {
    QString key;
    QString source;
    bool numerus = false;
    QString type;
    QStringList forms;
};

QList<Message> readTs(const QString &path)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly))
        return {};
    QList<Message> out;
    QXmlStreamReader xml(&file);
    QString context;
    Message message;
    QString element;
    while (!xml.atEnd()) {
        xml.readNext();
        if (xml.isStartElement()) {
            element = xml.name().toString();
            if (element == u"message") {
                message = {};
                message.numerus = xml.attributes().value(u"numerus") == u"yes";
            } else if (element == u"translation") {
                message.type = xml.attributes().value(u"type").toString();
                if (!message.numerus)
                    message.forms.append(QString());
            } else if (element == u"numerusform") {
                message.forms.append(QString());
            }
        } else if (xml.isCharacters()) {
            const QString text = xml.text().toString();
            if (element == u"name")
                context += text;
            else if (element == u"source")
                message.source += text;
            else if (element == u"comment")
                message.key += text;
            else if ((element == u"translation" || element == u"numerusform") && !message.forms.isEmpty())
                message.forms.last() += text;
        } else if (xml.isEndElement()) {
            if (xml.name() == u"context")
                context.clear();
            if (xml.name() == u"message") {
                message.key = context + u'\x1f' + message.source + u'\x1f' + message.key;
                out.append(message);
            }
            element.clear();
        }
    }
    return out;
}

QSet<QString> placeholders(const QString &text)
{
    static const QRegularExpression pattern(u"%(\\d|n)"_s);
    QSet<QString> out;
    for (const auto &match : pattern.globalMatch(text))
        out.insert(match.captured());
    return out;
}

/// Plural forms Qt uses for each language (see QTranslator's numerus rules).
int pluralForms(const QString &language)
{
    if (language == u"pl")
        return 3;
    if (language == u"ja" || language == u"zh_CN")
        return 1;
    return 2;
}

} // namespace

class TranslationsTest : public QObject {
    Q_OBJECT

private slots:
    void initTestCase()
    {
        QVERIFY(tmp.isValid());
        const QString fresh = tmp.filePath(u"fresh.ts"_s);
        QProcess lupdate;
        lupdate.start(QString::fromUtf8(DAYHAND_LUPDATE),
                      {u"-silent"_s, u"-locations"_s, u"none"_s, u"-no-obsolete"_s, QString::fromUtf8(DAYHAND_SOURCES),
                       u"-ts"_s, fresh});
        QVERIFY(lupdate.waitForFinished(120'000));
        QVERIFY2(lupdate.exitCode() == 0, lupdate.readAllStandardError().constData());
        sources = readTs(fresh);
        QVERIFY(sources.size() > 50);
    }

    void languageIsComplete_data()
    {
        QTest::addColumn<QString>("language");
        for (const char *language : {"pl", "de", "es", "fr", "pt_BR", "ja", "zh_CN"})
            QTest::newRow(language) << QString::fromLatin1(language);
    }

    void languageIsComplete()
    {
        QFETCH(QString, language);
        const QList<Message> translated = readTs(u"%1/dayhand_%2.ts"_s.arg(QString::fromUtf8(DAYHAND_TS_DIR), language));
        QHash<QString, Message> byKey;
        for (const Message &m : translated)
            byKey.insert(m.key, m);

        QStringList problems;
        QSet<QString> expected;
        for (const Message &source : sources) {
            expected.insert(source.key);
            const auto found = byKey.constFind(source.key);
            if (found == byKey.constEnd()) {
                problems << u"missing: "_s + source.source;
                continue;
            }
            if (!found->type.isEmpty())
                problems << u"%1: %2"_s.arg(found->type, source.source);
            const int forms = source.numerus ? pluralForms(language) : 1;
            if (found->forms.size() != forms)
                problems << u"%1 forms instead of %2: %3"_s.arg(found->forms.size()).arg(forms).arg(source.source);
            for (const QString &form : found->forms) {
                if (form.trimmed().isEmpty())
                    problems << u"empty: "_s + source.source;
                else if (placeholders(form) != placeholders(source.source))
                    problems << u"placeholders differ: %1 -> %2"_s.arg(source.source, form);
            }
        }
        for (const Message &m : translated)
            if (!expected.contains(m.key))
                problems << u"no longer in the sources: "_s + m.source;
        QVERIFY2(problems.isEmpty(), qPrintable(problems.join(u'\n')));
    }

    void englishHasThePluralForms()
    {
        const QList<Message> english = readTs(QString::fromUtf8(DAYHAND_TS_DIR) + u"/dayhand_en.ts"_s);
        QHash<QString, Message> byKey;
        for (const Message &m : english)
            byKey.insert(m.key, m);
        QStringList problems;
        for (const Message &source : sources) {
            if (!source.numerus)
                continue;
            const auto found = byKey.constFind(source.key);
            if (found == byKey.constEnd() || !found->type.isEmpty() || found->forms.size() != 2
                || found->forms.contains(QString()))
                problems << source.source;
        }
        QVERIFY2(problems.isEmpty(), qPrintable(u"English plural forms missing for:\n"_s + problems.join(u'\n')));
    }

private:
    QTemporaryDir tmp;
    QList<Message> sources;
};

QTEST_GUILESS_MAIN(TranslationsTest)
#include "tst_translations.moc"
