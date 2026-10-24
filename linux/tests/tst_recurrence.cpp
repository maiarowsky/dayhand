// Repeating tasks: the same cases as backend/tests/repeat.test.ts, the Android app's RecurrenceTest.kt and the
// macOS app's RecurrenceTests, so every client agrees on every date a series falls on. The RFC 5545 dates of
// python-dateutil 2.9 are read from tests/cases/recurrence.json.
#include "HelmDates.h"
#include "Recurrence.h"
#include "TestSupport.h"

#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTest>

using namespace dayhand;
using namespace dayhand::test;
using namespace Qt::StringLiterals;

namespace {

RepeatRule rule(RepeatEvery every, int interval = 1)
{
    RepeatRule r;
    r.every = every;
    r.interval = interval;
    return r;
}

RepeatRule monthly(std::optional<int> monthDay = {}, std::optional<WeekdayOfMonth> nth = {}, int interval = 1,
                   std::optional<QString> from = {}, std::optional<QString> until = {})
{
    RepeatRule r = rule(RepeatEvery::Month, interval);
    r.monthDay = monthDay;
    r.weekdayOfMonth = nth;
    r.from = from;
    r.until = until;
    return r;
}

RepeatRule daily(int interval = 1, std::optional<int> count = {}, std::optional<QString> until = {},
                 std::optional<QString> from = {})
{
    RepeatRule r = rule(RepeatEvery::Day, interval);
    r.count = count;
    r.until = until;
    r.from = from;
    return r;
}

RepeatRule weekly(QList<int> days, int interval = 1)
{
    RepeatRule r = rule(RepeatEvery::Week, interval);
    r.weekdays = days;
    return r;
}

QStringList list(const RepeatRule &r, const QString &start, int limit = 500, const QString &from = u"2026-01-01"_s,
                 const QString &to = u"2031-12-31"_s)
{
    return Recurrence::occurrences(r, start, from, to, limit);
}

QString nextDue(const RepeatRule &r, const QString &due, const QString &today)
{
    const auto next = Recurrence::advance(r, due, today);
    return next ? next->dueDate : u"none"_s;
}

/// Completes each occurrence on its own day, [n] times, and returns the due dates.
QStringList completeOnTime(const RepeatRule &r, const QString &start, int n)
{
    QStringList dates{start};
    Recurrence::Next current{start, r};
    while (dates.size() < n) {
        const auto next = Recurrence::advance(current.repeat, current.dueDate, current.dueDate);
        if (!next)
            break;
        current = *next;
        dates.append(current.dueDate);
    }
    return dates;
}

RepeatRule ruleFromJson(const QJsonValue &value)
{
    const auto parsed = RepeatRule::parse(value);
    if (!parsed)
        qFatal("bad rule in tests/cases/recurrence.json");
    return *parsed;
}

} // namespace

class RecurrenceTest : public QObject {
    Q_OBJECT

private slots:
    void lastDayOfTheMonth()
    {
        QCOMPARE(list(monthly(-1), u"2026-01-31"_s, 4),
                 (QStringList{u"2026-01-31"_s, u"2026-02-28"_s, u"2026-03-31"_s, u"2026-04-30"_s}));
        const auto feb = Recurrence::advance(monthly(-1), u"2026-01-31"_s, u"2026-01-31"_s);
        QVERIFY(feb);
        QCOMPARE(feb->dueDate, u"2026-02-28"_s);
        QCOMPARE(nextDue(feb->repeat, feb->dueDate, feb->dueDate), u"2026-03-31"_s);
    }

    void day31FallsOnAShorterMonthsLastDayAndComesBack()
    {
        QCOMPARE(list(monthly(31), u"2026-01-31"_s, 4),
                 (QStringList{u"2026-01-31"_s, u"2026-02-28"_s, u"2026-03-31"_s, u"2026-04-30"_s}));
    }

    void plainMonthlyKeeps29To31AfterAShorterMonthAndLeavesThe15thAlone()
    {
        const auto feb = Recurrence::advance(monthly(), u"2026-01-31"_s, u"2026-01-31"_s);
        QCOMPARE(feb, (Recurrence::Next{u"2026-02-28"_s, monthly(31)}));
        QCOMPARE(nextDue(feb->repeat, feb->dueDate, feb->dueDate), u"2026-03-31"_s);
        QCOMPARE(completeOnTime(monthly(), u"2026-01-30"_s, 4),
                 (QStringList{u"2026-01-30"_s, u"2026-02-28"_s, u"2026-03-30"_s, u"2026-04-30"_s}));
        QCOMPARE(Recurrence::advance(monthly(), u"2026-01-15"_s, u"2026-01-15"_s), (Recurrence::Next{u"2026-02-15"_s, monthly()}));
    }

    void aMonthDayLaterInTheSameMonthComesFirst()
    {
        QCOMPARE(nextDue(monthly(-1), u"2026-01-10"_s, u"2026-01-10"_s), u"2026-01-31"_s);
    }

    void monthDayInAndNthWeekdayIn()
    {
        QCOMPARE(Recurrence::monthDayIn(day(u"2026-02-01"_s), 30), day(u"2026-02-28"_s));
        QCOMPARE(Recurrence::monthDayIn(day(u"2026-04-01"_s), -1), day(u"2026-04-30"_s));
        QCOMPARE(Recurrence::nthWeekdayIn(day(u"2026-10-01"_s), 2, 2), day(u"2026-10-13"_s));
        QCOMPARE(Recurrence::nthWeekdayIn(day(u"2026-10-01"_s), -1, 5), day(u"2026-10-30"_s));
        QVERIFY(!Recurrence::nthWeekdayIn(day(u"2026-02-01"_s), 5, 1));
        QCOMPARE(Recurrence::nthWeekdayIn(day(u"2026-03-01"_s), 5, 1), day(u"2026-03-30"_s));
    }

    void leapYears()
    {
        QCOMPARE(list(monthly(29), u"2028-01-29"_s, 3), (QStringList{u"2028-01-29"_s, u"2028-02-29"_s, u"2028-03-29"_s}));
        QCOMPARE(list(monthly(29), u"2027-01-29"_s, 3), (QStringList{u"2027-01-29"_s, u"2027-02-28"_s, u"2027-03-29"_s}));
        QCOMPARE(list(monthly(-1), u"2028-01-31"_s, 2), (QStringList{u"2028-01-31"_s, u"2028-02-29"_s}));
        QCOMPARE(list(monthly(-1), u"2029-01-31"_s, 2), (QStringList{u"2029-01-31"_s, u"2029-02-28"_s}));
        QCOMPARE(nextDue(rule(RepeatEvery::Year), u"2028-02-29"_s, u"2028-02-29"_s), u"2029-02-28"_s);
        QCOMPARE(nextDue(rule(RepeatEvery::Year, 4), u"2028-02-29"_s, u"2028-02-29"_s), u"2032-02-29"_s);
        QCOMPARE(list(daily(), u"2028-02-28"_s, 3), (QStringList{u"2028-02-28"_s, u"2028-02-29"_s, u"2028-03-01"_s}));
    }

    void nthWeekdayOfTheMonth()
    {
        const RepeatRule secondTuesday = monthly({}, WeekdayOfMonth{2, 2});
        QCOMPARE(list(secondTuesday, u"2026-10-13"_s, 4),
                 (QStringList{u"2026-10-13"_s, u"2026-11-10"_s, u"2026-12-08"_s, u"2027-01-12"_s}));
        const RepeatRule lastFriday = monthly({}, WeekdayOfMonth{-1, 5}, 2);
        QCOMPARE(list(lastFriday, u"2026-10-30"_s, 4),
                 (QStringList{u"2026-10-30"_s, u"2026-12-25"_s, u"2027-02-26"_s, u"2027-04-30"_s}));
        const RepeatRule fifthMonday = monthly({}, WeekdayOfMonth{5, 1});
        QCOMPARE(nextDue(fifthMonday, u"2026-01-01"_s, u"2026-01-01"_s), u"2026-03-30"_s);
        QCOMPARE(nextDue(fifthMonday, u"2026-03-30"_s, u"2026-03-30"_s), u"2026-06-29"_s);
        QCOMPARE(nextDue(secondTuesday, u"2026-10-01"_s, u"2026-10-01"_s), u"2026-10-13"_s);
    }

    void countingFromCompletion()
    {
        const RepeatRule every3 = daily(3, {}, {}, u"completion"_s);
        QCOMPARE(nextDue(every3, u"2026-10-02"_s, u"2026-10-22"_s), u"2026-10-25"_s);
        RepeatRule fromDue = every3;
        fromDue.from = u"due"_s;
        QCOMPARE(nextDue(fromDue, u"2026-10-02"_s, u"2026-10-22"_s), u"2026-10-23"_s);
        QCOMPARE(nextDue(every3, u"2026-10-30"_s, u"2026-10-22"_s), u"2026-10-25"_s);
        RepeatRule mondays = weekly({1});
        mondays.from = u"completion"_s;
        QCOMPARE(nextDue(mondays, u"2026-10-12"_s, u"2026-10-21"_s), u"2026-10-26"_s);
        QCOMPARE(nextDue(monthly(-1, {}, 1, u"completion"_s), u"2026-02-28"_s, u"2026-03-05"_s), u"2026-03-31"_s);
    }

    void countIsTheOccurrencesLeftAndDatesSkippedByALateCompletionUseItUp()
    {
        QCOMPARE(Recurrence::advance(daily(1, 3), u"2026-10-20"_s, u"2026-10-20"_s), (Recurrence::Next{u"2026-10-21"_s, daily(1, 2)}));
        QVERIFY(!Recurrence::advance(daily(1, 1), u"2026-10-20"_s, u"2026-10-20"_s));
        QVERIFY(!Recurrence::advance(daily(1, 3), u"2026-10-20"_s, u"2026-10-22"_s));
        QCOMPARE(Recurrence::advance(daily(1, 5), u"2026-10-20"_s, u"2026-10-22"_s), (Recurrence::Next{u"2026-10-23"_s, daily(1, 2)}));
    }

    void untilIsTheLastDateTheSeriesMayFallOn()
    {
        QCOMPARE(nextDue(daily(1, {}, u"2026-10-21"_s), u"2026-10-20"_s, u"2026-10-20"_s), u"2026-10-21"_s);
        QCOMPARE(nextDue(daily(1, {}, u"2026-10-21"_s), u"2026-10-21"_s, u"2026-10-21"_s), u"none"_s);
    }

    void occurrencesRespectCountUntilTheRangeAndTheLimit()
    {
        QCOMPARE(list(daily(3, 5), u"2026-10-22"_s),
                 (QStringList{u"2026-10-22"_s, u"2026-10-25"_s, u"2026-10-28"_s, u"2026-10-31"_s, u"2026-11-03"_s}));
        RepeatRule fridays = weekly({5});
        fridays.until = u"2026-11-13"_s;
        QCOMPARE(list(fridays, u"2026-10-23"_s), (QStringList{u"2026-10-23"_s, u"2026-10-30"_s, u"2026-11-06"_s, u"2026-11-13"_s}));
        QCOMPARE(list(daily(), u"2026-10-01"_s, 500, u"2026-10-30"_s, u"2026-11-02"_s),
                 (QStringList{u"2026-10-30"_s, u"2026-10-31"_s, u"2026-11-01"_s, u"2026-11-02"_s}));
        QCOMPARE(list(daily(), u"2026-10-01"_s, 2), (QStringList{u"2026-10-01"_s, u"2026-10-02"_s}));
    }

    void completingAtNightAcrossLondonsClockChangesCountsFromTheLondonDay()
    {
        const RepeatRule r = daily(1, {}, {}, u"completion"_s);
        const auto doneAt = [&r](const QString &iso) {
            const auto next = Recurrence::advance(r, std::nullopt, HelmDates::localDate(utc(iso), u"Europe/London"_s));
            return next ? next->dueDate : u"none"_s;
        };
        QCOMPARE(doneAt(u"2026-10-24T23:30"_s), u"2026-10-26"_s);
        QCOMPARE(doneAt(u"2026-10-25T23:30"_s), u"2026-10-26"_s);
        QCOMPARE(doneAt(u"2026-03-28T23:30"_s), u"2026-03-29"_s);
        QCOMPARE(doneAt(u"2026-03-29T23:30"_s), u"2026-03-31"_s);
        QCOMPARE(list(rule(RepeatEvery::Week), u"2026-10-18"_s, 3), (QStringList{u"2026-10-18"_s, u"2026-10-25"_s, u"2026-11-01"_s}));
        QCOMPARE(list(rule(RepeatEvery::Week), u"2026-03-22"_s, 3), (QStringList{u"2026-03-22"_s, u"2026-03-29"_s, u"2026-04-05"_s}));
    }

    void listingAheadGivesTheDatesCompletingOnTimeWouldCreate()
    {
        RepeatRule secondTuesdayUntil = monthly({}, WeekdayOfMonth{2, 2});
        secondTuesdayUntil.until = u"2027-06-30"_s;
        const QList<std::pair<RepeatRule, QString>> rules{
            {daily(), u"2026-01-31"_s},          {daily(3, 7), u"2026-01-31"_s},
            {weekly({1, 4}, 2), u"2026-10-19"_s}, {monthly(), u"2026-01-31"_s},
            {monthly(-1), u"2026-01-31"_s},      {secondTuesdayUntil, u"2026-10-13"_s},
            {rule(RepeatEvery::Year), u"2028-02-29"_s},
        };
        for (const auto &[r, start] : rules)
            QCOMPARE(list(r, start, 30, u"2026-01-01"_s, u"2099-12-31"_s), completeOnTime(r, start, 30));
    }

    void sameDatesAsAnRFC5545Implementation_data()
    {
        QFile file(QStringLiteral(DAYHAND_TEST_CASES_DIR "/recurrence.json"));
        if (!file.open(QIODevice::ReadOnly))
            qFatal("tests/cases/recurrence.json is missing");
        QTest::addColumn<QJsonValue>("rule");
        QTest::addColumn<QString>("start");
        QTest::addColumn<QStringList>("dates");
        const QJsonArray all = QJsonDocument::fromJson(file.readAll()).object()[u"cases"].toArray();
        for (const auto &item : all) {
            QStringList dates;
            for (const auto &date : item[u"dates"].toArray())
                dates.append(date.toString());
            QTest::newRow(item[u"rrule"].toString().toUtf8().constData()) << item[u"rule"] << item[u"start"].toString() << dates;
        }
    }

    void sameDatesAsAnRFC5545Implementation()
    {
        QFETCH(QJsonValue, rule);
        QFETCH(QString, start);
        QFETCH(QStringList, dates);
        QCOMPARE(list(ruleFromJson(rule), start, int(dates.size()), start, u"2030-12-31"_s), dates);
    }
};

QTEST_GUILESS_MAIN(RecurrenceTest)
#include "tst_recurrence.moc"
