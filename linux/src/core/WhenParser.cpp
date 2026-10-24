#include "WhenParser.h"

#include "HelmDates.h"

#include <QHash>
#include <QRegularExpression>

using namespace Qt::StringLiterals;

namespace dayhand::WhenParser {

namespace {

struct WhenError {
    QString message;
};

enum class Unit { Minute, Hour, Day, Week, Month, Year };

struct Ref {
    qint64 now;
    QString timezone;
    CivilDate today;
    ClockTime time;
};

template <class T> struct Match {
    T value;
    qsizetype next;
};

const QHash<QString, int> &weekdays()
{
    static const QHash<QString, int> table{
        {u"mon"_s, 1}, {u"monday"_s, 1}, {u"tue"_s, 2}, {u"tues"_s, 2}, {u"tuesday"_s, 2}, {u"wed"_s, 3},
        {u"weds"_s, 3}, {u"wednesday"_s, 3}, {u"thu"_s, 4}, {u"thur"_s, 4}, {u"thurs"_s, 4}, {u"thursday"_s, 4},
        {u"fri"_s, 5}, {u"friday"_s, 5}, {u"sat"_s, 6}, {u"saturday"_s, 6}, {u"sun"_s, 7}, {u"sunday"_s, 7},
    };
    return table;
}

const QHash<QString, int> &months()
{
    static const QHash<QString, int> table{
        {u"jan"_s, 1}, {u"january"_s, 1}, {u"feb"_s, 2}, {u"february"_s, 2}, {u"mar"_s, 3}, {u"march"_s, 3},
        {u"apr"_s, 4}, {u"april"_s, 4}, {u"may"_s, 5}, {u"jun"_s, 6}, {u"june"_s, 6}, {u"jul"_s, 7},
        {u"july"_s, 7}, {u"aug"_s, 8}, {u"august"_s, 8}, {u"sep"_s, 9}, {u"sept"_s, 9}, {u"september"_s, 9},
        {u"oct"_s, 10}, {u"october"_s, 10}, {u"nov"_s, 11}, {u"november"_s, 11}, {u"dec"_s, 12},
        {u"december"_s, 12},
    };
    return table;
}

const QHash<QString, int> &numbers()
{
    static const QHash<QString, int> table{
        {u"a"_s, 1}, {u"an"_s, 1}, {u"one"_s, 1}, {u"two"_s, 2}, {u"three"_s, 3}, {u"four"_s, 4},
        {u"five"_s, 5}, {u"six"_s, 6}, {u"seven"_s, 7}, {u"eight"_s, 8}, {u"nine"_s, 9}, {u"ten"_s, 10},
        {u"eleven"_s, 11}, {u"twelve"_s, 12},
    };
    return table;
}

const QHash<QString, Unit> &units()
{
    static const QHash<QString, Unit> table{
        {u"min"_s, Unit::Minute}, {u"mins"_s, Unit::Minute}, {u"minute"_s, Unit::Minute},
        {u"minutes"_s, Unit::Minute}, {u"h"_s, Unit::Hour}, {u"hr"_s, Unit::Hour}, {u"hrs"_s, Unit::Hour},
        {u"hour"_s, Unit::Hour}, {u"hours"_s, Unit::Hour}, {u"d"_s, Unit::Day}, {u"day"_s, Unit::Day},
        {u"days"_s, Unit::Day}, {u"w"_s, Unit::Week}, {u"wk"_s, Unit::Week}, {u"wks"_s, Unit::Week},
        {u"week"_s, Unit::Week}, {u"weeks"_s, Unit::Week}, {u"mo"_s, Unit::Month}, {u"month"_s, Unit::Month},
        {u"months"_s, Unit::Month}, {u"y"_s, Unit::Year}, {u"yr"_s, Unit::Year}, {u"yrs"_s, Unit::Year},
        {u"year"_s, Unit::Year}, {u"years"_s, Unit::Year},
    };
    return table;
}

WhenError notUnderstood()
{
    return {u"Not a date Dayhand understands; try e.g. tomorrow, fri 14:00, next mon, in 3 days, 23 oct, 2026-10-23"_s};
}

WhenError noSuchDay()
{
    return {u"That day does not exist in the calendar"_s};
}

/// The capture groups of [pattern] matched against the whole of [text] ("" for a group that took no part).
std::optional<QStringList> capture(const QRegularExpression &pattern, const QString &text)
{
    const auto match = pattern.match(text);
    if (!match.hasMatch())
        return std::nullopt;
    QStringList groups;
    for (int index = 1; index <= pattern.captureCount(); ++index)
        groups.append(match.captured(index));
    return groups;
}

QStringList words(const QString &text)
{
    QStringList out;
    QString current;
    for (QChar c : text) {
        if (c.isSpace()) {
            if (!current.isEmpty())
                out.append(current);
            current.clear();
        } else {
            current.append(c);
        }
    }
    if (!current.isEmpty())
        out.append(current);
    return out;
}

QString at(const QStringList &tokens, qsizetype index)
{
    return index < tokens.size() ? tokens[index] : QString();
}

std::optional<int> count(const QString &word)
{
    if (!word.isEmpty() && word.size() <= 3 && isAsciiDigits(word))
        return word.toInt();
    const auto found = numbers().constFind(word);
    return found == numbers().constEnd() ? std::nullopt : std::optional<int>(*found);
}

When settle(const CivilDate &date, const ClockTime &time, const QString &timezone)
{
    const LocalMoment wanted{date, time};
    const LocalMoment real = HelmDates::localAt(HelmDates::instantOf(wanted, timezone), timezone);
    if (real == wanted)
        return {date.toString(), time.toString(), std::nullopt};
    return {real.date.toString(), real.time.toString(), time.toString()};
}

/// "in 2 hours", "in 30 min", "+3h": a moment, so both a day and a time.
std::optional<When> relativeInstant(const QStringList &tokens, const Ref &ref)
{
    static const QRegularExpression shortForm(u"^\\+(\\d{1,3})(h|min)$"_s);
    std::optional<int> amount;
    std::optional<Unit> unit;
    if (tokens.size() == 1) {
        if (const auto found = capture(shortForm, tokens[0])) {
            amount = (*found)[0].toInt();
            unit = units().value((*found)[1]);
        }
    } else if (tokens.size() == 3 && tokens[0] == u"in") {
        amount = count(tokens[1]);
        if (units().contains(tokens[2]))
            unit = units().value(tokens[2]);
    }
    if (!amount || !unit || (*unit != Unit::Hour && *unit != Unit::Minute))
        return std::nullopt;
    const qint64 step = *unit == Unit::Hour ? 3'600'000 : 60'000;
    const LocalMoment moment = HelmDates::localAt(ref.now + qint64(*amount) * step, ref.timezone);
    return When{moment.date.toString(), moment.time.toString(), std::nullopt};
}

CivilDate shift(const CivilDate &date, int amount, Unit unit)
{
    switch (unit) {
    case Unit::Day:
        return date.addingDays(amount);
    case Unit::Week:
        return date.addingDays(qint64(amount) * 7);
    case Unit::Month:
        return date.addingMonths(amount);
    default:
        return date.addingMonths(amount * 12);
    }
}

/// First day on or after [from] with this ISO weekday.
CivilDate onOrAfter(const CivilDate &from, int weekday)
{
    return from.addingDays((weekday - from.weekday() + 7) % 7);
}

CivilDate nextWeekMonday(const CivilDate &today)
{
    return today.addingDays(8 - today.weekday());
}

/// Saturday on or after today; on a Sunday, today.
CivilDate weekend(const CivilDate &today)
{
    return today.weekday() == 7 ? today : onOrAfter(today, 6);
}

CivilDate endOfYear(const CivilDate &today)
{
    return {today.year, 12, 31};
}

CivilDate realDate(int year, int month, int day)
{
    const auto date = CivilDate::of(year, month, day);
    if (!date)
        throw noSuchDay();
    return *date;
}

/// With a year, exactly that day; without, its next occurrence (today included).
CivilDate dated(int day, int month, std::optional<int> year, const Ref &ref)
{
    if (year)
        return realDate(*year, month, day);
    for (int y = ref.today.year; y < ref.today.year + 9; ++y) {
        const auto date = CivilDate::of(y, month, day);
        if (date && *date >= ref.today)
            return *date;
    }
    throw noSuchDay();
}

CivilDate nextDayOfMonth(int day, const CivilDate &today)
{
    if (day < 1 || day > 31)
        throw noSuchDay();
    for (int m = 0; m < 13; ++m) {
        const CivilDate month = today.firstOfMonth().addingMonths(m);
        if (day <= month.lengthOfMonth() && month.withDay(day) >= today)
            return month.withDay(day);
    }
    throw noSuchDay();
}

/// "end of week/work week/month/year", "day after tomorrow".
std::optional<Match<CivilDate>> phraseDate(const QStringList &tokens, qsizetype i, const Ref &ref)
{
    struct Phrase {
        QRegularExpression pattern;
        CivilDate (*resolve)(const CivilDate &);
    };
    static const QList<Phrase> phrases{
        {QRegularExpression(u"^(the )?day after tomorrow\\b"_s), [](const CivilDate &t) { return t.addingDays(2); }},
        {QRegularExpression(u"^end of (the )?work week\\b"_s), [](const CivilDate &t) { return onOrAfter(t, 5); }},
        {QRegularExpression(u"^end of (the )?week\\b"_s), [](const CivilDate &t) { return onOrAfter(t, 7); }},
        {QRegularExpression(u"^end of (the )?month\\b"_s), [](const CivilDate &t) { return t.lastOfMonth(); }},
        {QRegularExpression(u"^end of (the )?year\\b"_s), [](const CivilDate &t) { return endOfYear(t); }},
    };
    const QString rest = tokens.mid(i).join(u' ');
    for (const auto &phrase : phrases) {
        const auto match = phrase.pattern.match(rest);
        if (match.hasMatch())
            return Match<CivilDate>{phrase.resolve(ref.today), i + match.captured(0).split(u' ').size()};
    }
    return std::nullopt;
}

std::optional<int> fourDigitYear(const QString &word)
{
    if (word.size() != 4 || !isAsciiDigits(word))
        return std::nullopt;
    return word.toInt();
}

/// "23 oct", "23rd of october 2027", "oct 23", "the 15th".
std::optional<Match<CivilDate>> dayMonth(const QStringList &tokens, qsizetype start, const Ref &ref)
{
    static const QRegularExpression dayPattern(u"^(\\d{1,2})(st|nd|rd|th)?$"_s);
    qsizetype i = start;
    if (at(tokens, i) == u"the")
        ++i;
    if (const auto first = capture(dayPattern, at(tokens, i))) {
        qsizetype j = i + 1;
        if (at(tokens, j) == u"of")
            ++j;
        if (months().contains(at(tokens, j))) {
            const auto year = fourDigitYear(at(tokens, j + 1));
            const CivilDate date = dated((*first)[0].toInt(), months().value(at(tokens, j)), year, ref);
            return Match<CivilDate>{date, year ? j + 2 : j + 1};
        }
        // "the 15th": the next 15th of a month, this month included.
        if (!(*first)[1].isEmpty())
            return Match<CivilDate>{nextDayOfMonth((*first)[0].toInt(), ref.today), i + 1};
        return std::nullopt;
    }
    if (months().contains(at(tokens, i))) {
        if (const auto second = capture(dayPattern, at(tokens, i + 1))) {
            const auto year = fourDigitYear(at(tokens, i + 2));
            const CivilDate date = dated((*second)[0].toInt(), months().value(at(tokens, i)), year, ref);
            return Match<CivilDate>{date, year ? i + 3 : i + 2};
        }
    }
    return std::nullopt;
}

/// One-word days: "today", "eom", "fri", "2026-10-23", "+2w".
std::optional<CivilDate> singleWordDate(const QString &word, const Ref &ref)
{
    static const QRegularExpression iso(u"^(\\d{4})-(\\d{2})-(\\d{2})$"_s);
    static const QRegularExpression plus(u"^\\+(\\d{1,3})(d|w|mo|y)$"_s);
    if (word == u"today" || word == u"tod")
        return ref.today;
    if (word == u"tomorrow" || word == u"tmr" || word == u"tmrw")
        return ref.today.addingDays(1);
    if (word == u"yesterday")
        return ref.today.addingDays(-1);
    if (word == u"weekend")
        return weekend(ref.today);
    if (word == u"eow")
        return onOrAfter(ref.today, 7);
    if (word == u"eoww")
        return onOrAfter(ref.today, 5);
    if (word == u"eom")
        return ref.today.lastOfMonth();
    if (word == u"eoy")
        return endOfYear(ref.today);
    if (weekdays().contains(word))
        return ref.today.addingDays(((weekdays().value(word) - ref.today.weekday() + 6) % 7) + 1);
    if (const auto found = capture(iso, word))
        return realDate((*found)[0].toInt(), (*found)[1].toInt(), (*found)[2].toInt());
    if (const auto found = capture(plus, word))
        return shift(ref.today, (*found)[0].toInt(), units().value((*found)[1]));
    return std::nullopt;
}

/// Two- and three-word days: "this fri", "next week", "in 3 days".
std::optional<Match<CivilDate>> relativeDate(const QStringList &tokens, qsizetype i, const Ref &ref)
{
    const QString word = tokens[i];
    const QString following = at(tokens, i + 1);
    if (following.isEmpty())
        return std::nullopt;
    const bool followingIsDay = weekdays().contains(following);
    const int followingDay = weekdays().value(following);
    const auto two = [i](CivilDate value) { return Match<CivilDate>{value, i + 2}; };
    if (word == u"this") {
        if (followingIsDay)
            return two(onOrAfter(ref.today, followingDay));
        if (following == u"weekend")
            return two(weekend(ref.today));
    }
    if (word == u"next") {
        const CivilDate monday = nextWeekMonday(ref.today);
        if (followingIsDay)
            return two(monday.addingDays(followingDay - 1));
        if (following == u"week")
            return two(monday);
        if (following == u"weekend")
            return two(monday.addingDays(5));
        if (following == u"month")
            return two(ref.today.addingMonths(1).firstOfMonth());
        if (following == u"year")
            return two(CivilDate{ref.today.year + 1, 1, 1});
    }
    if (word == u"in") {
        const auto amount = count(following);
        const QString unitWord = at(tokens, i + 2);
        if (amount && units().contains(unitWord)) {
            const Unit unit = units().value(unitWord);
            if (unit != Unit::Hour && unit != Unit::Minute)
                return Match<CivilDate>{shift(ref.today, *amount, unit), i + 3};
        }
    }
    return std::nullopt;
}

std::optional<Match<CivilDate>> datePart(const QStringList &tokens, qsizetype start, const Ref &ref)
{
    qsizetype i = start;
    if (at(tokens, i) == u"on")
        ++i;
    if (i >= tokens.size())
        return std::nullopt;
    if (const auto single = singleWordDate(tokens[i], ref))
        return Match<CivilDate>{*single, i + 1};
    if (const auto relative = relativeDate(tokens, i, ref))
        return relative;
    if (const auto phrase = phraseDate(tokens, i, ref))
        return phrase;
    return dayMonth(tokens, i, ref);
}

/// "14:00", "9:30am", "2pm", "2 pm", "at 9", "noon", "midnight" (24h unless am/pm).
std::optional<Match<ClockTime>> timePart(const QStringList &tokens, qsizetype start)
{
    static const QRegularExpression pattern(u"^(\\d{1,2})(?::(\\d{2}))?(am|pm)?$"_s);
    qsizetype i = start;
    const bool isAt = at(tokens, i) == u"at";
    if (isAt)
        ++i;
    if (i >= tokens.size())
        return std::nullopt;
    const QString word = tokens[i];
    if (word == u"noon")
        return Match<ClockTime>{{12, 0}, i + 1};
    if (word == u"midnight")
        return Match<ClockTime>{{0, 0}, i + 1};
    const auto found = capture(pattern, word);
    if (!found)
        return std::nullopt;
    QString meridiem = (*found)[2];
    qsizetype next = i + 1;
    if (meridiem.isEmpty() && (at(tokens, next) == u"am" || at(tokens, next) == u"pm"))
        meridiem = tokens[next++];
    // A bare number is a time only after "at" ("at 9"); "9" alone is not a date or a time.
    if (meridiem.isEmpty() && (*found)[1].isEmpty() && !isAt)
        return std::nullopt;
    int hour = (*found)[0].toInt();
    const int minute = (*found)[1].isEmpty() ? 0 : (*found)[1].toInt();
    if (minute > 59)
        throw WhenError{u"Minutes must be 00 to 59"_s};
    if (!meridiem.isEmpty()) {
        if (hour < 1 || hour > 12)
            throw WhenError{u"With am or pm the hour must be 1 to 12"_s};
        hour = hour % 12 + (meridiem == u"pm" ? 12 : 0);
    } else if (hour > 23) {
        throw WhenError{u"The hour must be 0 to 23"_s};
    }
    return Match<ClockTime>{{hour, minute}, next};
}

When parseTokens(const QStringList &tokens, const Ref &ref)
{
    if (const auto instant = relativeInstant(tokens, ref))
        return *instant;
    if (const auto date = datePart(tokens, 0, ref)) {
        if (date->next == tokens.size())
            return {date->value.toString(), std::nullopt, std::nullopt};
        const auto time = timePart(tokens, date->next);
        if (time && time->next == tokens.size())
            return settle(date->value, time->value, ref.timezone);
        throw notUnderstood();
    }
    const auto time = timePart(tokens, 0);
    if (!time)
        throw notUnderstood();
    if (time->next == tokens.size()) {
        // A time alone is the next time the clock shows it: today, or tomorrow once it has passed.
        const CivilDate day = time->value > ref.time ? ref.today : ref.today.addingDays(1);
        return settle(day, time->value, ref.timezone);
    }
    const qsizetype start = tokens[time->next] == u"on" ? time->next + 1 : time->next;
    const auto after = datePart(tokens, start, ref);
    if (after && after->next == tokens.size())
        return settle(after->value, time->value, ref.timezone);
    throw notUnderstood();
}

} // namespace

QStringList examples()
{
    return {u"today"_s,  u"tomorrow"_s,    u"fri"_s,        u"next mon"_s, u"this weekend"_s, u"in 3 days"_s,
            u"+2w"_s,    u"in 2 hours"_s,  u"eow"_s,        u"eom"_s,      u"23 oct"_s,       u"oct 23 2027"_s,
            u"2026-10-23"_s, u"14:00"_s,   u"2pm"_s,        u"noon"_s,     u"tomorrow at 9am"_s, u"fri 14:30"_s};
}

WhenResult parse(const QString &text, qint64 now, const QString &timezone)
{
    const QStringList tokens = words(text.toLower().replace(u',', u' '));
    if (tokens.isEmpty())
        return {std::nullopt, notUnderstood().message};
    const LocalMoment local = HelmDates::localAt(now, timezone);
    const Ref ref{now, timezone, local.date, local.time};
    try {
        return {parseTokens(tokens, ref), QString()};
    } catch (const WhenError &error) {
        return {std::nullopt, error.message};
    }
}

QString relativeDay(const QString &date, const QString &today)
{
    const auto d = CivilDate::parse(date);
    const auto t = CivilDate::parse(today);
    if (!d || !t)
        return date;
    const qint64 days = t->daysUntil(*d);
    if (days == 0)
        return u"today"_s;
    if (days == 1)
        return u"tomorrow"_s;
    if (days == -1)
        return u"yesterday"_s;
    return days > 0 ? u"in %1 days"_s.arg(days) : u"%1 days ago"_s.arg(-days);
}

} // namespace dayhand::WhenParser
