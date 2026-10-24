// Today, the input rules and the reminders: the Android app's TodaySectionsTest, TaskRulesTest and
// ReminderRulesTest, case for case, as the macOS app's DomainTests carry them, and the reminder plan.
#include "ReminderPlanner.h"
#include "Reminders.h"
#include "TaskRules.h"
#include "TestSupport.h"
#include "Translations.h"
#include "TodaySections.h"

#include <QTest>

using namespace dayhand;
using namespace dayhand::test;
using namespace Qt::StringLiterals;

namespace {

const QString warsaw = u"Europe/Warsaw"_s;
const QString london = u"Europe/London"_s;

TaskItem timed(const QString &id, std::optional<QString> date, std::optional<QString> time,
               const std::function<void(TaskItem &)> &change = {})
{
    TaskItem item = task(id, date, time);
    item.title = u"Task "_s + id;
    if (change)
        change(item);
    return item;
}

QStringList labels(const QList<Reminder> &reminders)
{
    QStringList out;
    for (const auto &r : reminders)
        out.append(u"%1@%2"_s.arg(r.taskLocalId, r.minutesBefore ? QString::number(*r.minutesBefore) : u"nil"_s));
    return out;
}

ReminderSettings warsawSettings()
{
    return {warsaw, u"05:00"_s, {0, 30}};
}

} // namespace

class RulesTest : public QObject {
    Q_OBJECT

private slots:
    // English, whose translation file holds the plural forms of the texts.
    void initTestCase() { QVERIFY(Translations::install(u"en"_s)); }

    void sectionsInOrderWithBackendSorting()
    {
        const QList<TaskItem> tasks{
            task(u"old"_s, u"2026-10-19"_s, {}, TaskStatus::Todo, 1),
            task(u"yesterday-late"_s, u"2026-10-21"_s, u"18:00"_s, TaskStatus::Todo, 2),
            task(u"yesterday-untimed"_s, u"2026-10-21"_s, {}, TaskStatus::Todo, 3),
            task(u"untimed"_s, u"2026-10-22"_s, {}, TaskStatus::Todo, 4),
            task(u"at-13"_s, u"2026-10-22"_s, u"13:15"_s, TaskStatus::Todo, 5),
            task(u"at-09"_s, u"2026-10-22"_s, u"09:00"_s, TaskStatus::Todo, 6),
            task(u"tomorrow"_s, u"2026-10-23"_s, {}, TaskStatus::Todo, 7),
            task(u"no-date"_s, {}, {}, TaskStatus::Todo, 8),
        };
        const TodaySections s = todaySections(tasks, utc(u"2026-10-22T10:00"_s), london);
        QCOMPARE(s.date, u"2026-10-22"_s);
        QCOMPARE(ids(s.overdue), (QStringList{u"old"_s, u"yesterday-late"_s, u"yesterday-untimed"_s}));
        QCOMPARE(ids(s.today), (QStringList{u"at-09"_s, u"at-13"_s, u"untimed"_s}));
        QVERIFY(!s.now);
        QVERIFY(s.done.isEmpty());
        QVERIFY(!s.isEmpty());
    }

    void theNowTaskIsShownOnceInItsOwnSectionEvenWhenOverdue()
    {
        const QList<TaskItem> tasks{
            task(u"now"_s, u"2026-10-20"_s, {}, TaskStatus::Doing, 1, [](TaskItem &t) { t.isNow = true; t.resumeNote = u"page 3"_s; }),
            task(u"other"_s, u"2026-10-20"_s, {}, TaskStatus::Todo, 2),
            task(u"today"_s, u"2026-10-22"_s, {}, TaskStatus::Doing, 3),
        };
        const TodaySections s = todaySections(tasks, utc(u"2026-10-22T10:00"_s), london);
        QCOMPARE(s.now->localId, u"now"_s);
        QCOMPARE(ids(s.overdue), QStringList{u"other"_s});
        QCOMPARE(ids(s.today), QStringList{u"today"_s});
    }

    void doneTodayOnlyNewestFirstArchivedAndOtherDaysLeftOut()
    {
        const auto doneAt = [](const QString &iso) { return [iso](TaskItem &t) { t.completedAt = utc(iso); }; };
        const QList<TaskItem> tasks{
            task(u"done-early"_s, u"2026-10-22"_s, {}, TaskStatus::Done, 0, doneAt(u"2026-10-22T07:00"_s)),
            task(u"done-late"_s, u"2026-10-20"_s, {}, TaskStatus::Done, 0, doneAt(u"2026-10-22T09:00"_s)),
            task(u"done-yesterday"_s, u"2026-10-21"_s, {}, TaskStatus::Done, 0, doneAt(u"2026-10-21T12:00"_s)),
            task(u"archived"_s, u"2026-10-20"_s, {}, TaskStatus::Todo, 0, [](TaskItem &t) { t.archivedAt = 1; }),
            task(u"archived-today"_s, u"2026-10-22"_s, {}, TaskStatus::Todo, 0, [](TaskItem &t) { t.archivedAt = 1; }),
        };
        const TodaySections s = todaySections(tasks, utc(u"2026-10-22T10:00"_s), london);
        QCOMPARE(ids(s.done), (QStringList{u"done-late"_s, u"done-early"_s}));
        QVERIFY(s.overdue.isEmpty());
        QVERIFY(s.today.isEmpty());
        QVERIFY(s.isEmpty());
    }

    void midnightInTheUsersZoneMovesTodaysTasksToOverdue()
    {
        const QList<TaskItem> tasks{task(u"a"_s, u"2026-10-22"_s)};
        const TodaySections before = todaySections(tasks, utc(u"2026-10-22T21:59"_s), warsaw);
        const TodaySections after = todaySections(tasks, utc(u"2026-10-22T22:00"_s), warsaw);
        QCOMPARE(ids(before.today), QStringList{u"a"_s});
        QVERIFY(before.overdue.isEmpty());
        QCOMPARE(after.date, u"2026-10-23"_s);
        QCOMPARE(ids(after.overdue), QStringList{u"a"_s});
        QVERIFY(after.today.isEmpty());
    }

    void doneIsCountedByTheCompletionDayInTheUsersZone()
    {
        const TaskItem done = task(u"d"_s, u"2026-10-21"_s, {}, TaskStatus::Done, 0,
                                   [](TaskItem &t) { t.completedAt = utc(u"2026-10-21T22:30"_s); });
        QCOMPARE(ids(todaySections({done}, utc(u"2026-10-22T10:00"_s), warsaw).done), QStringList{u"d"_s});
        QVERIFY(todaySections({done}, utc(u"2026-10-22T10:00"_s), u"America/New_York"_s).done.isEmpty());
    }

    void tasksInTheTrashAreNeitherOverdueNowTodayNorDone()
    {
        const auto trashed = [](TaskItem &t) { t.deletedAt = 1; };
        const QList<TaskItem> tasks{
            task(u"late"_s, u"2026-10-20"_s, {}, TaskStatus::Todo, 0, trashed),
            task(u"now"_s, u"2026-10-22"_s, {}, TaskStatus::Doing, 0, [](TaskItem &t) { t.isNow = true; t.deletedAt = 1; }),
            task(u"today"_s, u"2026-10-22"_s, {}, TaskStatus::Todo, 0, trashed),
            task(u"done"_s, u"2026-10-22"_s, {}, TaskStatus::Done, 0,
                 [](TaskItem &t) { t.completedAt = utc(u"2026-10-22T10:00"_s); t.deletedAt = 1; }),
        };
        const TodaySections s = todaySections(tasks, utc(u"2026-10-22T10:00"_s), london);
        QVERIFY(s.isEmpty());
        QVERIFY(s.done.isEmpty());
        QVERIFY(todaySections({}, utc(u"2026-10-22T10:00"_s), london).isEmpty());
    }

    void titlesAreTrimmedAndMustBe1To500Characters()
    {
        QCOMPARE(TaskRules::title(u"  Call "_s), u"Call"_s);
        QVERIFY(!TaskRules::title(u"   "_s));
        QCOMPARE(TaskRules::title(QString(500, u'x'))->size(), 500);
        QVERIFY(!TaskRules::title(QString(501, u'x')));
        // The server counts UTF-16 units: 250 emoji are 500 units, 251 are too many.
        QVERIFY(TaskRules::title(u"😀"_s.repeated(250)));
        QVERIFY(!TaskRules::title(u"😀"_s.repeated(251)));
    }

    void labelsLinksRepeatChecklistAndRemindersFollowTheBackend()
    {
        QCOMPARE(TaskRules::labels({u" home"_s, u"work"_s, u"home "_s, u" "_s}), (QStringList{u"home"_s, u"work"_s}));
        QVERIFY(!TaskRules::labels({QString(51, u'x')}));
        QVERIFY(TaskRules::isLinkURL(u"https://example.com/a?b=1"_s));
        QVERIFY(TaskRules::isLinkURL(u"http://10.0.2.2:3210"_s));
        for (const QString &bad : {u"example.com"_s, u"ftp://example.com"_s, u"javascript:alert(1)"_s, u"https://"_s,
                                   u"https://example.com/"_s + QString(2048, u'a')})
            QVERIFY2(!TaskRules::isLinkURL(bad), qPrintable(bad.left(40)));
        QCOMPARE(TaskRules::link(u" https://a.pl "_s, u" Docs "_s), (TaskLink{u"https://a.pl"_s, u"Docs"_s}));
        QCOMPARE(TaskRules::link(u"https://a.pl"_s, u"  "_s), (TaskLink{u"https://a.pl"_s, std::nullopt}));
        RepeatRule week;
        week.every = RepeatEvery::Week;
        week.weekdays = QList<int>{1, 1};
        QVERIFY(!TaskRules::isValid(week));
        week.weekdays = QList<int>{1, 3};
        QVERIFY(TaskRules::isValid(week));
        RepeatRule both;
        both.until = u"2026-12-31"_s;
        both.count = 3;
        QVERIFY(!TaskRules::isValid(both));
        QCOMPARE(TaskRules::reminders({TaskReminder::before(15), TaskReminder::before(15)}), QList<TaskReminder>{TaskReminder::before(15)});
        QVERIFY(!TaskRules::isValid(TaskReminder::at(u"09:00"_s, 31)));
        QVERIFY(!TaskRules::isValid(TaskReminder{5, u"09:00"_s, std::nullopt}));
        QCOMPARE(TaskRules::checklist({{u"a"_s, u" Milk "_s, false}, {u"b"_s, u"  "_s, false}}),
                 (QList<ChecklistItem>{{u"a"_s, u"Milk"_s, false}}));
        QVERIFY(!TaskRules::checklist({{u"a"_s, u"x"_s, false}, {u"a"_s, u"y"_s, false}}));
    }

    void dueTimeIsReadInTheUsersZoneAndASkippedTimeMovesForward()
    {
        QCOMPARE(ReminderRules::dueAt(timed(u"a"_s, u"2026-10-22"_s, u"13:15"_s), warsaw), utc(u"2026-10-22T11:15"_s));
        QCOMPARE(ReminderRules::dueAt(timed(u"a"_s, u"2026-10-22"_s, u"13:15"_s), london), utc(u"2026-10-22T12:15"_s));
        QVERIFY(!ReminderRules::dueAt(timed(u"a"_s, u"2026-10-22"_s, {}), warsaw));
        QCOMPARE(ReminderRules::dueAt(timed(u"a"_s, u"2026-03-29"_s, u"02:30"_s), warsaw), utc(u"2026-03-29T01:30"_s));
    }

    void everyTimedOpenTaskRingsOncePerConfiguredOffsetEarliestFirst()
    {
        const QList<TaskItem> tasks{
            timed(u"a"_s, u"2026-10-22"_s, u"13:15"_s),
            timed(u"b"_s, u"2026-10-22"_s, u"09:00"_s),
            timed(u"untimed"_s, u"2026-10-22"_s, {}),
            timed(u"nodate"_s, {}, {}),
            timed(u"done"_s, u"2026-10-22"_s, u"10:00"_s, [](TaskItem &t) { t.status = TaskStatus::Done; t.completedAt = 1; }),
            timed(u"archived"_s, u"2026-10-22"_s, u"10:00"_s, [](TaskItem &t) { t.archivedAt = 1; }),
            timed(u"trashed"_s, u"2026-10-22"_s, u"10:00"_s, [](TaskItem &t) { t.deletedAt = 1; }),
        };
        const QList<Reminder> reminders = ReminderRules::reminders(tasks, {0, 30}, warsaw);
        QCOMPARE(labels(reminders), (QStringList{u"b@30"_s, u"b@0"_s, u"a@30"_s, u"a@0"_s}));
        QCOMPARE(reminders.first().at, utc(u"2026-10-22T06:30"_s));
        QVERIFY(ReminderRules::reminders({timed(u"a"_s, u"2026-10-22"_s, u"13:15"_s)}, {}, warsaw).isEmpty());
    }

    void aReminderWhoseMomentHadPassedWhenTheTaskWasSetDoesNotRing()
    {
        const TaskItem t = timed(u"a"_s, u"2026-10-22"_s, u"13:15"_s, [](TaskItem &x) { x.updatedAt = utc(u"2026-10-22T11:10"_s); });
        QCOMPARE(labels(ReminderRules::reminders({t}, {0, 10}, warsaw)), QStringList{u"a@0"_s});
    }

    void nextAlarmIsTheFirstReminderAfterWhatWasHandledAndNotTooLate()
    {
        const auto reminders = ReminderRules::reminders(
            {timed(u"a"_s, u"2026-10-22"_s, u"09:00"_s), timed(u"b"_s, u"2026-10-22"_s, u"13:15"_s)}, {0}, warsaw);
        const qint64 nine = utc(u"2026-10-22T07:00"_s);
        const qint64 quarterPastOne = utc(u"2026-10-22T11:15"_s);
        const qint64 minute = 60'000;
        QCOMPARE(ReminderRules::nextAlarm(reminders, utc(u"2026-10-22T06:00"_s), 0), nine);
        QCOMPARE(ReminderRules::nextAlarm(reminders, nine, nine), quarterPastOne);
        QCOMPARE(ReminderRules::nextAlarm(reminders, nine + 5 * minute, 0), nine);
        QCOMPARE(ReminderRules::nextAlarm(reminders, nine + 20 * minute, 0), quarterPastOne);
        QVERIFY(!ReminderRules::nextAlarm(reminders, quarterPastOne, quarterPastOne));
    }

    void dueRemindersAreThoseSinceTheLastCheckOnePerTaskNeverOverdueOnes()
    {
        const auto reminders = ReminderRules::reminders(
            {timed(u"a"_s, u"2026-10-22"_s, u"09:00"_s), timed(u"b"_s, u"2026-10-22"_s, u"09:05"_s),
             timed(u"c"_s, u"2026-10-22"_s, u"13:15"_s), timed(u"late"_s, u"2026-10-21"_s, u"23:55"_s)},
            {0, 5}, warsaw);
        const auto due = ReminderRules::due(reminders, utc(u"2026-10-22T07:06"_s), utc(u"2026-10-22T06:30"_s), warsaw);
        QCOMPARE(labels(due), (QStringList{u"a@0"_s, u"b@0"_s}));
        QVERIFY(ReminderRules::due(reminders, utc(u"2026-10-21T22:02"_s), 0, warsaw).isEmpty());
    }

    void summaryIsTheNextOccurrenceOfItsTimeInTheUsersZone()
    {
        QCOMPARE(ReminderRules::nextSummaryAt(utc(u"2026-10-22T02:59"_s), u"05:00"_s, warsaw), utc(u"2026-10-22T03:00"_s));
        QCOMPARE(ReminderRules::nextSummaryAt(utc(u"2026-10-22T03:00"_s), u"05:00"_s, warsaw), utc(u"2026-10-23T03:00"_s));
        QCOMPARE(ReminderRules::nextSummaryAt(utc(u"2026-10-24T03:30"_s), u"05:00"_s, warsaw), utc(u"2026-10-25T04:00"_s));
    }

    void morningSummaryCountsTodayAndOverdueAndSaysWhereToStart()
    {
        const qint64 now = utc(u"2026-10-22T03:00"_s);
        QList<TaskItem> tasks{timed(u"t1"_s, u"2026-10-22"_s, u"09:00"_s), timed(u"t2"_s, u"2026-10-22"_s, {}),
                              timed(u"o1"_s, u"2026-10-20"_s, {}), timed(u"tomorrow"_s, u"2026-10-23"_s, {})};
        QCOMPARE(morningSummary(tasks, now, warsaw), (MorningSummary{2, 1, u"Task o1"_s}));
        tasks.append(timed(u"n"_s, u"2026-10-22"_s, {}, [](TaskItem &t) { t.isNow = true; t.status = TaskStatus::Doing; }));
        QCOMPARE(morningSummary(tasks, now, warsaw), (MorningSummary{3, 1, u"Task n"_s}));
        QCOMPARE(morningSummary({}, now, warsaw), (MorningSummary{0, 0, std::nullopt}));
    }

    void aTasksOwnRemindersReplaceTheDefaultsAndATimeOfDayRingsWithoutADueTime()
    {
        const TaskItem own = timed(u"own"_s, u"2026-10-22"_s, u"13:15"_s, [](TaskItem &t) { t.reminders = QList{TaskReminder::before(60)}; });
        const TaskItem silent = timed(u"silent"_s, u"2026-10-22"_s, u"13:30"_s, [](TaskItem &t) { t.reminders = QList<TaskReminder>{}; });
        const TaskItem plain = timed(u"default"_s, u"2026-10-22"_s, u"14:00"_s);
        QCOMPARE(labels(ReminderRules::reminders({own, silent, plain}, {0, 30}, warsaw)),
                 (QStringList{u"own@60"_s, u"default@30"_s, u"default@0"_s}));
        const TaskItem untimed = timed(u"u"_s, u"2026-10-22"_s, {}, [](TaskItem &t) {
            t.reminders = QList{TaskReminder::at(u"09:00"_s), TaskReminder::at(u"18:00"_s, 1), TaskReminder::before(15)};
        });
        const auto rung = ReminderRules::reminders({untimed}, {0}, warsaw);
        QCOMPARE(rung.size(), 2);
        QCOMPARE(rung[0].at, utc(u"2026-10-21T16:00"_s));
        QCOMPARE(rung[1].at, utc(u"2026-10-22T07:00"_s));
        QCOMPARE(rung[0].daysBefore, 1);
    }

    void aTimeOfDayInLondonFollowsItsClockChanges()
    {
        const auto at = [](const QString &date, const QString &time) {
            const TaskItem t = timed(u"a"_s, date, {}, [&time](TaskItem &x) { x.reminders = QList{TaskReminder::at(time)}; });
            return ReminderRules::reminders({t}, {}, london).first().at;
        };
        QCOMPARE(at(u"2026-10-24"_s, u"09:00"_s), utc(u"2026-10-24T08:00"_s));
        QCOMPARE(at(u"2026-10-26"_s, u"09:00"_s), utc(u"2026-10-26T09:00"_s));
        QCOMPARE(at(u"2026-03-29"_s, u"01:30"_s), utc(u"2026-03-29T01:30"_s));
        QCOMPARE(at(u"2026-10-25"_s, u"01:30"_s), utc(u"2026-10-25T00:30"_s));
    }

    // The plan Dayhand rings from: the macOS app's ReminderPlannerTests, and what is due when the clock wakes.

    void remindersAheadAndSevenSummariesWithTheirOwnText()
    {
        const qint64 now = utc(u"2026-10-22T06:00"_s);
        const QList<TaskItem> tasks{task(u"a"_s, u"2026-10-22"_s, u"09:00"_s), task(u"b"_s, u"2026-10-23"_s, u"10:00"_s),
                                    task(u"late"_s, u"2026-10-20"_s, u"09:00"_s)};
        const auto plan = ReminderPlanner::plan(tasks, warsawSettings(), now);
        QList<qint64> ringsAt;
        QStringList bodies;
        QList<PlannedNotification> summaries;
        for (const auto &ring : plan) {
            if (ring.kind == PlannedNotification::Kind::Reminder) {
                ringsAt.append(ring.at);
                bodies.append(ring.body);
            } else {
                summaries.append(ring);
            }
        }
        QCOMPARE(ringsAt, (QList<qint64>{utc(u"2026-10-22T06:30"_s), utc(u"2026-10-22T07:00"_s), utc(u"2026-10-23T07:30"_s),
                                          utc(u"2026-10-23T08:00"_s)}));
        QCOMPARE(bodies, (QStringList{u"Today at 09:00"_s, u"Now, 09:00"_s, u"Today at 10:00"_s, u"Now, 10:00"_s}));
        QCOMPARE(summaries.size(), 7);
        QCOMPARE(summaries.first().id, u"dayhand.summary.2026-10-23"_s);
        QCOMPARE(summaries.first().title, u"1 task today, 2 overdue"_s);
        QCOMPARE(summaries.first().body, u"Start with: late"_s);
    }

    void overdueTasksNeverRingAndIdsStayTheSame()
    {
        const auto onlySummaries = ReminderPlanner::plan({task(u"a"_s, u"2026-10-22"_s, u"09:00"_s)}, warsawSettings(),
                                                         utc(u"2026-10-22T08:00"_s));
        for (const auto &ring : onlySummaries)
            QCOMPARE(ring.kind, PlannedNotification::Kind::Summary);
        const QList<TaskItem> tasks{task(u"a"_s, u"2026-10-22"_s, u"09:00"_s)};
        const qint64 now = utc(u"2026-10-22T06:00"_s);
        const auto first = ReminderPlanner::plan(tasks, warsawSettings(), now);
        const auto again = ReminderPlanner::plan(tasks, warsawSettings(), now + 1000);
        QCOMPARE(first.size(), again.size());
        for (qsizetype i = 0; i < first.size(); ++i)
            QCOMPARE(first[i].id, again[i].id);
    }

    void dueRingsAreTheLatestPerTaskAndNotTooLate()
    {
        const QList<TaskItem> tasks{task(u"a"_s, u"2026-10-22"_s, u"09:00"_s), task(u"b"_s, u"2026-10-22"_s, u"09:10"_s)};
        const qint64 since = utc(u"2026-10-22T06:00"_s);
        const auto plan = ReminderPlanner::plan(tasks, warsawSettings(), since);
        // At 09:12 Warsaw the 30-minute rings (08:30, 08:40) are over 15 min late and dropped; a@0 and b@0 are due.
        const auto due = ReminderPlanner::due(plan, utc(u"2026-10-22T07:12"_s), since);
        QCOMPARE(due.size(), 2);
        QCOMPARE(due[0].body, u"Now, 09:00"_s);
        QCOMPARE(due[1].body, u"Now, 09:10"_s);
        QCOMPARE(ReminderPlanner::nextRing(plan, utc(u"2026-10-22T07:12"_s), utc(u"2026-10-22T07:12"_s)),
                 utc(u"2026-10-23T03:00"_s));
        QVERIFY(ReminderPlanner::due(plan, utc(u"2026-10-22T07:12"_s), utc(u"2026-10-22T07:12"_s)).isEmpty());
    }
};

QTEST_GUILESS_MAIN(RulesTest)
#include "tst_rules.moc"
