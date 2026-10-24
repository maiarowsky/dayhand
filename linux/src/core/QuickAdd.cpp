#include "QuickAdd.h"

#include <QList>

#include <algorithm>

namespace dayhand::QuickAdd {

namespace {

/// Where each word of [text] starts.
QList<qsizetype> wordStarts(const QString &text)
{
    QList<qsizetype> starts;
    bool inWord = false;
    for (qsizetype index = 0; index < text.size(); ++index) {
        const bool space = text[index].isSpace();
        if (!space && !inWord)
            starts.append(index);
        inWord = !space;
    }
    return starts;
}

} // namespace

QuickAddInput parse(const QString &line, qint64 now, const QString &timezone)
{
    const QString trimmed = line.trimmed();
    const QList<qsizetype> starts = wordStarts(trimmed);
    if (starts.size() >= 2) {
        const int longest = static_cast<int>(std::min<qsizetype>(maxPhraseWords, starts.size() - 1));
        for (int length = longest; length >= 1; --length) {
            const qsizetype phraseStart = starts[starts.size() - length];
            const QString phrase = trimmed.mid(phraseStart);
            const WhenResult result = WhenParser::parse(phrase, now, timezone);
            if (!result.ok())
                continue;
            return {trimmed.left(phraseStart).trimmed(), result.when, phrase};
        }
    }
    return {trimmed, std::nullopt, std::nullopt};
}

} // namespace dayhand::QuickAdd
