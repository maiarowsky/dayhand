// Dates, the date phrase grammar and quick add: the cases of the CLI (cli/tests/when.unit.test.ts), the Android
// app's HelmDatesTest and the macOS app's WhenTests, read from tests/cases/when.json where they are a list.
#include "Formatting.h"
#include "HelmDates.h"
#include "QuickAdd.h"
#include "TestSupport.h"
#include "WhenParser.h"

#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTest>

using namespace dayhand;
using namespace dayhand::test;
using namespace Qt::StringLiterals;

namespace {

const QString london = u"Europe/London"_s;

QJsonObject cases()
{
    QFile file(QStringLiteral(DAYHAND_TEST_CASES_DIR "/when.json"));
    if (!file.open(QIODevice::ReadOnly))
        qFatal("tests/cases/when.json is missing");
    return QJsonDocument::fromJson(file.readAll()).object();
}

QString when(const QString &text, qint64 now, const QString &timezone = london)
{
    const WhenResult result = WhenParser::parse(text, now, timezone);
    if (!result.ok())
        return u"error: "_s + result.error;
    QStringList parts{result.when->date};
    if (result.when->time)
        parts.append(*result.when->time);
    if (result.when->shiftedFrom)
        parts.append(*result.when->shiftedFrom);
    return parts.join(u' ');
}

} // namespace

class DatesTest : public QObject {
    Q_OBJECT

private slots:
    void sharedPhrases_data()
    {
        QTest::addColumn<QString>("text");
        QTest::addColumn<qint64>("now");
        QTest::addColumn<QString>("expected");
        for (const auto &group : cases()[u"groups"].toArray()) {
            const qint64 now = utc(group[u"now"].toString());
            for (const auto &item : group[u"cases"].toArray()) {
                const QString text = item[0].toString();
                const QByteArray name = (group[u"now"].toString() + u" | "_s + text).toUtf8();
                QTest::newRow(name.constData()) << text << now << item[1].toString();
            }
        }
    }

    void sharedPhrases()
    {
        QFETCH(QString, text);
        QFETCH(qint64, now);
        QFETCH(QString, expected);
        QCOMPARE(when(text, now), expected);
    }

    void sharedRejected_data()
    {
        QTest::addColumn<QString>("text");
        for (const auto &text : cases()[u"rejected"][u"phrases"].toArray())
            QTest::newRow(text.toString().toUtf8().constData()) << text.toString();
    }

    void sharedRejected()
    {
        QFETCH(QString, text);
        QVERIFY(!WhenParser::parse(text, utc(u"2026-10-22T09:00"_s), london).ok());
    }

    void theErrorDoesNotRepeatThePhrase()
    {
        const WhenResult result = WhenParser::parse(u"secret-ish words"_s, utc(u"2026-10-22T09:00"_s), london);
        QVERIFY(result.error.startsWith(u"Not a date Dayhand understands; try e.g. tomorrow"_s));
        QVERIFY(!result.error.contains(u"secret"_s));
    }

    void halfPastOneHappensTwiceAndTheEarlierOneIsMeant()
    {
        QCOMPARE(HelmDates::instantOf({day(u"2026-10-25"_s), {1, 30}}, london), utc(u"2026-10-25T00:30"_s));
    }

    void theUsersZoneDecidesNotTheComputersOrUTC()
    {
        const qint64 late = utc(u"2026-10-22T23:30"_s);
        QCOMPARE(when(u"today"_s, late), u"2026-10-23"_s);
        QCOMPARE(when(u"fri"_s, late), u"2026-10-30"_s);
        QCOMPARE(when(u"today"_s, utc(u"2026-10-22T09:00"_s), u"America/New_York"_s), u"2026-10-22"_s);
        QCOMPARE(when(u"in 2 hours"_s, utc(u"2026-10-22T09:00"_s), u"America/New_York"_s), u"2026-10-22 07:00"_s);
        QCOMPARE(when(u"tomorrow"_s, utc(u"2026-10-22T11:30"_s), u"Pacific/Auckland"_s), u"2026-10-24"_s);
        QCOMPARE(when(u"in 3 hours"_s, utc(u"2026-10-22T09:00"_s), u"Pacific/Auckland"_s), u"2026-10-23 01:00"_s);
    }

    void monthsClampToTheLastDay()
    {
        QCOMPARE(day(u"2026-01-31"_s).addingMonths(1), day(u"2026-02-28"_s));
        QCOMPARE(day(u"2028-01-31"_s).addingMonths(1), day(u"2028-02-29"_s));
        QCOMPARE(day(u"2026-12-15"_s).addingMonths(1), day(u"2027-01-15"_s));
        QCOMPARE(day(u"2026-03-31"_s).addingMonths(-1), day(u"2026-02-28"_s));
    }

    void localWallClockAndRelativeDayWords()
    {
        QCOMPARE(HelmDates::localAt(utc(u"2026-07-01T12:00"_s), london), (LocalMoment{day(u"2026-07-01"_s), {13, 0}}));
        QCOMPARE(WhenParser::relativeDay(u"2026-10-22"_s, u"2026-10-22"_s), u"today"_s);
        QCOMPARE(WhenParser::relativeDay(u"2026-10-23"_s, u"2026-10-22"_s), u"tomorrow"_s);
        QCOMPARE(WhenParser::relativeDay(u"2026-10-21"_s, u"2026-10-22"_s), u"yesterday"_s);
        QCOMPARE(WhenParser::relativeDay(u"2026-10-27"_s, u"2026-10-22"_s), u"in 5 days"_s);
        QCOMPARE(WhenParser::relativeDay(u"2026-10-19"_s, u"2026-10-22"_s), u"3 days ago"_s);
        QCOMPARE(WhenParser::relativeDay(u"2026-03-30"_s, u"2026-03-28"_s), u"in 2 days"_s);
    }

    // The Android app's HelmDatesTest, case for case.

    void londonMidnightInSummerAndWinterTime()
    {
        QCOMPARE(HelmDates::localDate(utc(u"2026-10-22T22:59"_s), london), u"2026-10-22"_s);
        QCOMPARE(HelmDates::localDate(utc(u"2026-10-22T23:00"_s), london), u"2026-10-23"_s);
        QCOMPARE(HelmDates::localDate(utc(u"2026-12-01T23:59"_s), london), u"2026-12-01"_s);
        QCOMPARE(HelmDates::localDate(utc(u"2026-12-02T00:00"_s), london), u"2026-12-02"_s);
    }

    void warsawAndNewYork()
    {
        QCOMPARE(HelmDates::localDate(utc(u"2026-10-22T21:59"_s), u"Europe/Warsaw"_s), u"2026-10-22"_s);
        QCOMPARE(HelmDates::localDate(utc(u"2026-10-22T22:00"_s), u"Europe/Warsaw"_s), u"2026-10-23"_s);
        QCOMPARE(HelmDates::localDate(utc(u"2026-10-23T03:00"_s), u"America/New_York"_s), u"2026-10-22"_s);
    }

    void lastMillisecondBeforeMidnightAndMidnightItself()
    {
        const qint64 midnight = utc(u"2026-10-22T22:00"_s);
        QCOMPARE(HelmDates::localDate(midnight - 1, u"Europe/Warsaw"_s), u"2026-10-22"_s);
        QCOMPARE(HelmDates::localDate(midnight, u"Europe/Warsaw"_s), u"2026-10-23"_s);
    }

    void dayWhenClocksGoBackStillHasOneMidnight()
    {
        QCOMPARE(HelmDates::localDate(utc(u"2026-10-25T22:59"_s), u"Europe/Warsaw"_s), u"2026-10-25"_s);
        QCOMPARE(HelmDates::localDate(utc(u"2026-10-25T23:00"_s), u"Europe/Warsaw"_s), u"2026-10-26"_s);
        QCOMPARE(HelmDates::nextMidnight(utc(u"2026-10-25T12:00"_s), u"Europe/Warsaw"_s), utc(u"2026-10-25T23:00"_s));
    }

    void unknownOrMissingZoneFallsBackToTheBackendDefault()
    {
        QCOMPARE(HelmDates::localDate(utc(u"2026-10-22T23:00"_s), u"Mars/Base"_s), u"2026-10-23"_s);
        QCOMPARE(HelmDates::localDate(utc(u"2026-10-22T23:00"_s), QString()), u"2026-10-23"_s);
    }

    void nextMidnight()
    {
        QCOMPARE(HelmDates::nextMidnight(utc(u"2026-10-22T10:00"_s), london), utc(u"2026-10-22T23:00"_s));
        QCOMPARE(HelmDates::nextMidnight(utc(u"2026-10-22T23:00"_s), london), utc(u"2026-10-23T23:00"_s));
    }

    void overdueRulesMatchTheBackend()
    {
        const TaskItem base = task(u"a"_s, u"2026-10-21"_s);
        QVERIFY(HelmDates::isOverdue(base, u"2026-10-22"_s));
        QVERIFY(!HelmDates::isOverdue(base, u"2026-10-21"_s));
        QVERIFY(!HelmDates::isOverdue(task(u"a"_s, u"2026-10-21"_s, {}, TaskStatus::Done), u"2026-10-22"_s));
        QVERIFY(!HelmDates::isOverdue(task(u"a"_s, u"2026-10-21"_s, {}, TaskStatus::Todo, 0, [](TaskItem &t) { t.archivedAt = 1; }),
                                      u"2026-10-22"_s));
        QVERIFY(!HelmDates::isOverdue(task(u"a"_s), u"2026-10-22"_s));
        QVERIFY(HelmDates::isOverdue(task(u"a"_s, u"2026-10-21"_s, {}, TaskStatus::Doing), u"2026-10-22"_s));
    }

    void addDaysCrossesMonthAndYear()
    {
        QCOMPARE(HelmDates::addDays(u"2026-12-31"_s, 1), u"2027-01-01"_s);
        QCOMPARE(HelmDates::addDays(u"2026-03-01"_s, -1), u"2026-02-28"_s);
    }

    void civilDatesRoundTripAndKnowTheirWeekday()
    {
        for (qint64 number = -800'000; number <= 800'000; number += 997)
            QCOMPARE(CivilDate::fromDayNumber(number).dayNumber(), number);
        QCOMPARE(day(u"2026-10-22"_s).weekday(), 4);
        QCOMPARE(day(u"2026-10-25"_s).weekday(), 7);
        QCOMPARE(day(u"1970-01-01"_s).dayNumber(), 0);
        QVERIFY(!CivilDate::parse(u"2026-02-29"_s));
        QVERIFY(CivilDate::parse(u"2028-02-29"_s));
        QVERIFY(!CivilDate::parse(u"2026-1-01"_s));
        QVERIFY(!ClockTime::parse(u"24:00"_s));
        QVERIFY(!ClockTime::parse(u"9:00"_s));
    }

    // Quick add: the title, and a date phrase read from the end of the line (macOS QuickAddTests).

    void aPhraseAtTheEndIsTheDayAndTime()
    {
        const QuickAddInput input = QuickAdd::parse(u"Call the accountant fri 2pm"_s, utc(u"2026-10-22T09:00"_s), london);
        QCOMPARE(input.title, u"Call the accountant"_s);
        QCOMPARE(input.when, (When{u"2026-10-23"_s, u"14:00"_s, std::nullopt}));
        QCOMPARE(input.phrase, u"fri 2pm"_s);
    }

    void theLongestWholePhraseWins()
    {
        const auto parse = [](const QString &line) { return QuickAdd::parse(line, utc(u"2026-10-22T09:00"_s), london); };
        QCOMPARE(parse(u"Buy milk tomorrow at 9am"_s).when, (When{u"2026-10-23"_s, u"09:00"_s, std::nullopt}));
        QCOMPARE(parse(u"Buy milk tomorrow at 9am"_s).title, u"Buy milk"_s);
        QCOMPARE(parse(u"Plan next week"_s).title, u"Plan"_s);
        QCOMPARE(parse(u"Plan next week"_s).when->date, u"2026-10-26"_s);
        QCOMPARE(parse(u"Release v2 on oct 23"_s).title, u"Release v2"_s);
        QCOMPARE(parse(u"Pay rent the 1st"_s).when->date, u"2026-11-01"_s);
    }

    void withoutAPhraseTheLineIsTheTitle()
    {
        const auto parse = [](const QString &line) { return QuickAdd::parse(line, utc(u"2026-10-22T09:00"_s), london); };
        QCOMPARE(parse(u"Buy 2 apples"_s), (QuickAddInput{u"Buy 2 apples"_s, std::nullopt, std::nullopt}));
        QVERIFY(!parse(u"Read chapter 9"_s).when);
        QCOMPARE(parse(u"  Water the plants  "_s).title, u"Water the plants"_s);
        QCOMPARE(parse(u"tomorrow"_s), (QuickAddInput{u"tomorrow"_s, std::nullopt, std::nullopt}));
        QVERIFY(!parse(u"Pay 31 feb"_s).when);
        QCOMPARE(parse(u"Pay 31 feb"_s).title, u"Pay 31 feb"_s);
    }

    void daysReadAsWordsOnScreen()
    {
        QCOMPARE(Formatting::day(u"2026-10-22"_s, u"2026-10-22"_s), u"Today"_s);
        QCOMPARE(Formatting::day(u"2026-10-23"_s, u"2026-10-22"_s), u"Tomorrow"_s);
        QCOMPARE(Formatting::day(u"2026-10-21"_s, u"2026-10-22"_s), u"Yesterday"_s);
        QCOMPARE(Formatting::day(u"2026-10-30"_s, u"2026-10-22"_s), u"Fri 30 Oct"_s);
        QCOMPARE(Formatting::day(u"2027-01-04"_s, u"2026-10-22"_s), u"Mon 4 Jan 2027"_s);
        QCOMPARE(Formatting::when(When{u"2026-03-29"_s, u"02:30"_s, u"01:30"_s}, u"2026-03-28"_s),
                 u"Tomorrow, 02:30 (01:30 does not exist that day)"_s);
    }
};

QTEST_GUILESS_MAIN(DatesTest)
#include "tst_dates.moc"
