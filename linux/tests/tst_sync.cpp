// The outbox, the repository and sync against the fake server: offline first, in order, once. The macOS app's
// SyncTests (ConvexRemoteTests, RepositoryTests, SyncEngineTests), case for case where the Linux app has the action.
#include "ConvexRemote.h"
#include "FakeServer.h"
#include "Json.h"
#include "SyncEngine.h"
#include "SyncWorker.h"
#include "TaskRepository.h"
#include "TaskRules.h"

#include <QJsonArray>
#include "TestSupport.h"

#include <QSignalSpy>
#include <QSqlError>
#include <QSqlQuery>
#include <QTemporaryDir>
#include <QTest>

using namespace dayhand;
using namespace dayhand::test;
using namespace Qt::StringLiterals;

namespace {

/// A repository on a database in memory, a clock the test moves and ids `id-1`, `id-2`, …
struct Local {
    std::unique_ptr<Database> database = Database::open(u":memory:"_s);
    qint64 clock = utc(u"2026-10-22T09:00"_s);
    TestIds ids;
    int changes = 0;
    TaskRepository repo{*database,
                        {[this] { return clock; }, [this] { return ids.next(); }, [] { return u"Europe/Warsaw"_s; },
                         [this] { ++changes; }}};
};

/// The local side, the fake server and the engine between them.
struct World {
    Local local;
    FakeServer server;
    int revoked = 0;
    PairingApi api{server};
    DeviceTokens tokens{FakeServer::site, FakeServer::deviceToken, api, [this] { ++revoked; }, [this] { return local.clock; }};
    ConvexRemote remote{FakeServer::cloud, tokens, server};
    SyncEngine engine{local.repo, remote, remote, [this] { return local.clock; }};

    World() { server.clock = [this] { return local.clock; }; }
};

QStringList mutations(const QList<OutboxOp> &ops)
{
    QStringList out;
    for (const auto &op : ops)
        out.append(op.mutation);
    return out;
}

} // namespace

class SyncTest : public QObject {
    Q_OBJECT

private slots:
    void onlyAFunctionThatRanAndRefusedIsFinal()
    {
        const auto classify = [](int status, const QByteArray &body) { return ConvexRemote::classify({status, body, {}, {}}).kind; };
        using K = SendResult::Kind;
        QCOMPARE(classify(200, R"({"status":"success","value":{"id":"s1"}})"), K::Applied);
        QCOMPARE(classify(560, R"({"status":"error","errorMessage":"Task not found"})"), K::Rejected);
        QCOMPARE(classify(560, R"({"status":"error","errorMessage":"x","errorData":{"code":"unauthenticated"}})"), K::Unauthorized);
        QCOMPARE(classify(401, {}), K::Unauthorized);
        QCOMPARE(ConvexRemote::classify({502, {}, {}, {}}).message, u"HTTP 502"_s);
        QCOMPARE(ConvexRemote::classify({404, "<html>", {}, {}}).message, u"HTTP 404"_s);
        QCOMPARE(ConvexRemote::classify({200, "not json", {}, {}}).message, u"unreadable answer"_s);
    }

    void theRequestIsTheConvexHTTPAPIsShape()
    {
        const QByteArray body = ConvexRemote::requestBody(u"app:add"_s, QJsonObject{{u"title"_s, u"Milk"_s}, {u"interval"_s, 1}});
        QCOMPARE(body, QByteArray(R"({"args":[{"interval":1,"title":"Milk"}],"format":"convex_encoded_json","path":"app:add"})"));
    }

    void aRefusedTokenIsRefreshedAndTheCallTriedOnceMore()
    {
        World w;
        QCOMPARE(w.remote.send(Mutations::add, QJsonObject{{u"title"_s, u"First"_s}}).kind, SendResult::Kind::Applied);
        w.server.expireTokens();
        QCOMPARE(w.remote.send(Mutations::add, QJsonObject{{u"title"_s, u"Second"_s}}).kind, SendResult::Kind::Applied);
        QStringList bearers;
        for (const auto &request : w.server.requests) {
            if (request.path == u"/api/mutation")
                bearers.append(request.bearer);
        }
        QCOMPARE(bearers, (QStringList{u"jwt-1"_s, u"jwt-1"_s, u"jwt-2"_s}));
        QCOMPARE(w.server.allTasks().size(), 2);
    }

    void aSnapshotHasTheTasksTheTrashAndTheSettings()
    {
        World w;
        const QString kept = w.server.addElsewhere(u"Kept"_s, u"2026-10-22"_s);
        const QString trashed = w.server.addElsewhere(u"Trashed"_s);
        w.server.editElsewhere(trashed, {{u"deletedAt"_s, 5}});
        const auto read = w.remote.snapshot({});
        QVERIFY(read.snapshot);
        QCOMPARE(read.snapshot->tasks.size(), 2);
        QCOMPARE(read.snapshot->tasks[1].deletedAt, 5);
        QCOMPARE(read.snapshot->settings, (ReminderSettings{u"Europe/London"_s, u"05:00"_s, {0}}));
    }

    void remoteTasksAreReadWithNumbersAsDoubles()
    {
        // moc cannot read a raw string literal that spans lines, so this one is spelled out. The labels are what an
        // older server may still send; the app has no labels and reads the task without them.
        const QByteArray sample = "{\"id\":\"s1\",\"clientId\":\"c1\",\"title\":\"T\",\"status\":\"doing\",\"isNow\":true,"
                                  "\"createdAt\":1.0,\"updatedAt\":2.0,\"repeat\":{\"every\":\"month\",\"interval\":1.0,"
                                  "\"weekdayOfMonth\":{\"nth\":-1.0,\"weekday\":5.0}},"
                                  "\"reminders\":[{\"minutesBefore\":15.0},{\"time\":\"18:00\",\"daysBefore\":1.0}],"
                                  "\"checklist\":[{\"id\":\"a\",\"title\":\"Milk\",\"done\":true}],\"labels\":[\"home\"],"
                                  "\"links\":[{\"url\":\"https://a.pl\"}]}";
        const auto t = RemoteJson::task(json::decode(sample));
        QVERIFY(t);
        QCOMPARE(t->repeat->weekdayOfMonth, (WeekdayOfMonth{-1, 5}));
        QCOMPARE(t->reminders, (QList<TaskReminder>{TaskReminder::before(15), TaskReminder::at(u"18:00"_s, 1)}));
        QCOMPARE(t->updatedAt, 2);
        QCOMPARE(t->links.size(), 1);
        QVERIFY(t->isNow);
    }

    void aVersion1DatabaseLosesItsLabelsAndKeepsTheRest()
    {
        QTemporaryDir dir;
        const QString path = dir.filePath(u"dayhand.sqlite"_s);
        {
            // The schema and data as version 1 of the app left them, labels included.
            QSqlDatabase old = QSqlDatabase::addDatabase(u"QSQLITE"_s, u"version-1"_s);
            old.setDatabaseName(path);
            QVERIFY(old.open());
            QSqlQuery q(old);
            for (const QString &sql : {
                     u"CREATE TABLE task (localId TEXT PRIMARY KEY NOT NULL, serverId TEXT UNIQUE, clientId TEXT,"
                     " title TEXT NOT NULL, note TEXT, dueDate TEXT, dueTime TEXT, status TEXT NOT NULL,"
                     " isNow INTEGER NOT NULL DEFAULT 0, resumeNote TEXT, completedAt INTEGER, archivedAt INTEGER,"
                     " createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, serverUpdatedAt INTEGER, repeat TEXT,"
                     " labels TEXT NOT NULL DEFAULT '[]', links TEXT NOT NULL DEFAULT '[]', deletedAt INTEGER,"
                     " checklist TEXT NOT NULL DEFAULT '[]', reminders TEXT)"_s,
                     u"CREATE INDEX task_clientId ON task (clientId)"_s,
                     u"CREATE TABLE outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, opId TEXT NOT NULL UNIQUE,"
                     " mutation TEXT NOT NULL, argsJson TEXT NOT NULL, taskLocalId TEXT, clientId TEXT NOT NULL,"
                     " createdAt INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lastError TEXT)"_s,
                     u"CREATE INDEX outbox_taskLocalId ON outbox (taskLocalId)"_s,
                     u"CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)"_s,
                     u"INSERT INTO task (localId, serverId, title, status, createdAt, updatedAt, labels, links, checklist)"
                     " VALUES ('a', 's1', 'Water the plants', 'todo', 1, 2, '[\"home\"]',"
                     " '[{\"url\":\"https://example.com\"}]', '[{\"id\":\"c1\",\"title\":\"Can\",\"done\":false}]')"_s,
                     u"INSERT INTO outbox (opId, mutation, argsJson, taskLocalId, clientId, createdAt)"
                     " VALUES ('op1', 'app:update', '{\"labels\":[\"home\"]}', 'a', 'c', 3)"_s,
                     u"PRAGMA user_version = 1"_s})
                QVERIFY2(q.exec(sql), qPrintable(q.lastError().text()));
            q = QSqlQuery();
            old.close();
        }
        QSqlDatabase::removeDatabase(u"version-1"_s);

        auto database = Database::open(path);
        QSqlQuery q(database->handle());
        QVERIFY(q.exec(u"PRAGMA user_version"_s) && q.next());
        QCOMPARE(q.value(0).toInt(), Database::schemaVersion);
        QStringList columns;
        QVERIFY(q.exec(u"PRAGMA table_info(task)"_s));
        while (q.next())
            columns.append(q.value(1).toString());
        QVERIFY(!columns.contains(u"labels"_s));
        QVERIFY(columns.contains(u"links"_s));
        const auto task = database->task(u"a"_s);
        QVERIFY(task);
        QCOMPARE(task->title, u"Water the plants"_s);
        QCOMPARE(task->links, (QList<TaskLink>{TaskLink{u"https://example.com"_s, std::nullopt}}));
        QCOMPARE(task->checklist.size(), 1);
        // A change queued before the upgrade still waits; the server ignores its labels.
        QCOMPARE(database->pendingCount(), 1);
        database->save(*task);
        QCOMPARE(database->tasks().size(), 1);
    }

    void withoutAServerTheDayFollowsThisComputersZoneUntilTheServerSendsItsSettings()
    {
        Local l;
        QCOMPARE(l.repo.settings().timezone, u"Europe/Warsaw"_s);
        l.repo.apply({{}, {u"America/New_York"_s, u"05:00"_s, {0}}});
        QCOMPARE(l.repo.settings().timezone, u"America/New_York"_s);
        l.repo.eraseAll();
        QCOMPARE(l.repo.settings().timezone, u"Europe/Warsaw"_s);
    }

    void addingWritesTheRowAndQueuesAddWithItsClientId()
    {
        Local l;
        const TaskItem added = l.repo.add(u"  Call the accountant "_s, u"2026-10-23"_s, u"14:00"_s);
        QCOMPARE(added.localId, u"id-1"_s);
        QCOMPARE(added.title, u"Call the accountant"_s);
        const auto ops = l.repo.pendingOps();
        QCOMPARE(mutations(ops), QStringList{Mutations::add});
        QCOMPARE(json::decode(ops[0].argsJson),
                 QJsonValue(QJsonObject{{u"title"_s, u"Call the accountant"_s}, {u"dueDate"_s, u"2026-10-23"_s},
                                        {u"dueTime"_s, u"14:00"_s}, {u"clientId"_s, u"id-1"_s}}));
        QCOMPARE(l.repo.task(u"id-1"_s), added);
        QCOMPARE(l.changes, 1);
    }

    void aTimeWithoutADayIsDroppedAndBadInputIsRefused()
    {
        Local l;
        const TaskItem added = l.repo.add(u"Untimed"_s, std::nullopt, u"14:00"_s);
        QVERIFY(!added.dueTime);
        QVERIFY_THROWS_EXCEPTION(InvalidChange, l.repo.add(u"   "_s, std::nullopt, std::nullopt));
        QVERIFY_THROWS_EXCEPTION(InvalidChange, l.repo.setDue(added.localId, u"2026-02-30"_s, std::nullopt));
        QCOMPARE(l.repo.pendingCount(), 1);
    }

    void editsChangeTheRowAndQueueInOrder()
    {
        Local l;
        const TaskItem t = l.repo.add(u"Task"_s, u"2026-10-22"_s, std::nullopt);
        l.repo.rename(t.localId, u"Renamed"_s);
        l.repo.setDue(t.localId, u"2026-10-24"_s, u"09:30"_s);
        l.repo.reschedule(t.localId, u"2026-10-25"_s);
        l.repo.complete(t.localId);
        const TaskItem row = *l.repo.task(t.localId);
        QCOMPARE(row.title, u"Renamed"_s);
        QCOMPARE(row.dueDate, u"2026-10-25"_s);
        QCOMPARE(row.dueTime, u"09:30"_s);
        QCOMPARE(row.status, TaskStatus::Done);
        QCOMPARE(row.completedAt, l.clock);
        const auto ops = l.repo.pendingOps();
        QCOMPARE(mutations(ops), (QStringList{Mutations::add, Mutations::update, Mutations::update, Mutations::reschedule, Mutations::complete}));
        QCOMPARE(json::decode(ops[2].argsJson)[u"dueTime"].toString(), u"09:30"_s);
        QSet<QString> clientIds;
        for (const auto &op : ops)
            clientIds.insert(op.clientId);
        QCOMPARE(clientIds.size(), ops.size());
    }

    void detailEditsWaitInTheOutboxAndReachTheFakeServer()
    {
        World w;
        const QString id = w.server.addElsewhere(u"Synthetic task"_s, u"2026-10-22"_s);
        QCOMPARE(w.engine.round().kind, SyncStatus::Kind::Synced);
        w.server.offline = true;
        TaskRepository &repo = w.local.repo;
        repo.rename(id, u"Synthetic edited task"_s);
        repo.setChecklist(id, {{u"stable-1"_s, u" Build "_s, false}});
        repo.setChecklist(id, {{u"stable-1"_s, u"Verify build"_s, true}, {u"stable-2"_s, u"Ship"_s, false}});
        repo.setChecklist(id, {{u"stable-1"_s, u"Verify build"_s, true}});
        repo.setNote(id, u"A note saved explicitly\nwith a second line"_s);
        repo.setStatus(id, TaskStatus::Doing);
        repo.setNow(id);
        repo.setResumeNote(id, u"Next: verify package"_s);
        repo.setDue(id, u"2026-10-24"_s, u"09:00"_s);
        repo.setDue(id, u"2026-10-24"_s, std::nullopt);
        repo.setDue(id, std::nullopt, std::nullopt);
        const QStringList expected{Mutations::update, Mutations::update, Mutations::update, Mutations::update,
                                   Mutations::update, Mutations::setStatus, Mutations::setNow, Mutations::update,
                                   Mutations::update, Mutations::update, Mutations::update};
        QCOMPARE(mutations(repo.pendingOps()), expected);
        const TaskItem edited = *repo.task(id);
        QCOMPARE(edited.title, u"Synthetic edited task"_s);
        QCOMPARE(edited.checklist, (QList<ChecklistItem>{{u"stable-1"_s, u"Verify build"_s, true}}));
        QVERIFY(edited.isNow);
        QCOMPARE(edited.status, TaskStatus::Doing);
        QVERIFY(!edited.dueDate);
        QVERIFY(!edited.dueTime);
        const auto pending = repo.pendingOps();
        QCOMPARE(json::decode(pending[3].argsJson)[u"checklist"][0][u"id"].toString(), u"stable-1"_s);
        for (const auto &op : pending)
            QVERIFY2(!json::decode(op.argsJson).toObject().contains(u"labels"), qPrintable(op.argsJson));
        QVERIFY(json::decode(pending.last().argsJson)[u"dueDate"].isNull());
        QVERIFY(json::decode(pending.last().argsJson)[u"dueTime"].isNull());
        QCOMPARE(w.engine.round().kind, SyncStatus::Kind::Offline);
        QCOMPARE(repo.pendingCount(), expected.size());
        QCOMPARE(w.server.taskTitled(u"Synthetic task"_s)->value(u"title"), QJsonValue(u"Synthetic task"_s));
        w.server.offline = false;
        // A failed send still reads a snapshot; dirty detail fields must survive it.
        w.local.clock += 1000;
        w.server.editElsewhere(id, {{u"title"_s, u"Remote old title"_s}, {u"updatedAt"_s, w.local.clock}});
        w.server.failNextMutation = true;
        QCOMPARE(w.engine.round().kind, SyncStatus::Kind::Offline);
        QCOMPARE(repo.task(id)->title, edited.title);
        QCOMPARE(repo.task(id)->checklist, edited.checklist);
        QCOMPARE(repo.task(id)->note, edited.note);
        QCOMPARE(w.engine.round().kind, SyncStatus::Kind::Synced);
        QCOMPARE(repo.pendingCount(), 0);
        QCOMPARE(w.server.mutationsSent().last(expected.size()), expected);
        const auto onServer = w.server.taskTitled(edited.title);
        QVERIFY(onServer);
        QVERIFY(!onServer->contains(u"labels"));
        QCOMPARE((*onServer)[u"checklist"], QJsonValue(QJsonArray{edited.checklist.first().wire()}));
        QCOMPARE((*onServer)[u"note"].toString(), *edited.note);
        QCOMPARE((*onServer)[u"resumeNote"].toString(), *edited.resumeNote);
        QCOMPARE((*onServer)[u"status"].toString(), u"doing"_s);
        QVERIFY((*onServer)[u"isNow"].toBool());
        QVERIFY(!onServer->contains(u"dueDate"));
        QVERIFY(!onServer->contains(u"dueTime"));
        QCOMPARE(repo.task(id)->checklist, edited.checklist);

        repo.setStatus(id, TaskStatus::Done);
        QCOMPARE(repo.pendingOps().last().mutation, Mutations::complete);
        QVERIFY(!repo.task(id)->isNow);
        QVERIFY(repo.task(id)->completedAt);
        repo.setStatus(id, TaskStatus::Todo);
        QVERIFY(!repo.task(id)->completedAt);
        repo.setNote(id, QString());
        repo.setChecklist(id, {});
        QCOMPARE(w.engine.round().kind, SyncStatus::Kind::Synced);
        const auto cleared = w.server.taskTitled(edited.title);
        QVERIFY(cleared);
        QVERIFY(!cleared->contains(u"note"));
        QVERIFY((*cleared)[u"checklist"].toArray().isEmpty());
        QCOMPARE((*cleared)[u"status"].toString(), u"todo"_s);
    }

    void invalidDetailEditsNeverEnterTheOutbox()
    {
        Local l;
        const TaskItem task = l.repo.add(u"Synthetic"_s, std::nullopt, std::nullopt);
        QVERIFY_THROWS_EXCEPTION(InvalidChange, l.repo.setNote(task.localId, QString(TaskRules::maxNote + 1, u'x')));
        QVERIFY_THROWS_EXCEPTION(InvalidChange,
                                l.repo.setChecklist(task.localId, {{u"same"_s, u"A"_s, false}, {u"same"_s, u"B"_s, false}}));
        QList<ChecklistItem> items;
        for (int n = 0; n <= TaskRules::maxChecklist; ++n)
            items.append({QString::number(n), u"Item"_s, false});
        QVERIFY_THROWS_EXCEPTION(InvalidChange, l.repo.setChecklist(task.localId, items));
        QCOMPARE(l.repo.pendingCount(), 1);
        QCOMPARE(l.repo.task(task.localId), task);
    }

    void oneNowTaskAtATime()
    {
        Local l;
        const TaskItem a = l.repo.add(u"A"_s, std::nullopt, std::nullopt);
        const TaskItem b = l.repo.add(u"B"_s, std::nullopt, std::nullopt);
        l.repo.setNow(a.localId);
        l.repo.setNow(b.localId);
        QCOMPARE(l.repo.task(a.localId)->isNow, false);
        QCOMPARE(l.repo.task(b.localId)->isNow, true);
        QCOMPARE(l.repo.task(b.localId)->status, TaskStatus::Doing);
        l.repo.clearNow();
        for (const auto &task : l.repo.allTasks())
            QVERIFY(!task.isNow);
        const OutboxOp last = l.repo.pendingOps().last();
        QVERIFY(!last.taskLocalId);
        QVERIFY(json::decode(last.argsJson)[u"taskId"].isNull());
    }

    void aTaskInTheTrashTakesNoChangeButRestore()
    {
        Local l;
        const TaskItem t = l.repo.add(u"T"_s, std::nullopt, std::nullopt);
        l.repo.moveToTrash(t.localId);
        l.repo.rename(t.localId, u"Ignored"_s);
        l.repo.setNote(t.localId, u"Ignored"_s);
        l.repo.setChecklist(t.localId, {{u"item"_s, u"Ignored"_s, false}});
        l.repo.setStatus(t.localId, TaskStatus::Doing);
        l.repo.setNow(t.localId);
        l.repo.setDue(t.localId, u"2026-10-25"_s, u"09:00"_s);
        l.repo.setResumeNote(t.localId, u"Ignored"_s);
        QCOMPARE(l.repo.task(t.localId)->title, u"T"_s);
        QVERIFY(!l.repo.task(t.localId)->note);
        QVERIFY(l.repo.task(t.localId)->checklist.isEmpty());
        QCOMPARE(l.repo.task(t.localId)->status, TaskStatus::Todo);
        QVERIFY(!l.repo.task(t.localId)->isNow);
        QVERIFY(!l.repo.task(t.localId)->dueDate);
        QVERIFY(!l.repo.task(t.localId)->resumeNote);
        l.repo.restore(t.localId);
        QVERIFY(!l.repo.task(t.localId)->deletedAt);
        QCOMPARE(mutations(l.repo.pendingOps()), (QStringList{Mutations::add, Mutations::softDelete, Mutations::restore}));
    }

    void aRefusedAddTakesTheTaskAndItsLaterChangesAwayAndAnAcknowledgedOneGetsItsServerId()
    {
        Local l;
        const TaskItem t = l.repo.add(u"T"_s, std::nullopt, std::nullopt);
        l.repo.complete(t.localId);
        l.repo.reject(*l.repo.next());
        QVERIFY(!l.repo.task(t.localId));
        QCOMPARE(l.repo.pendingCount(), 0);
        const TaskItem u = l.repo.add(u"U"_s, std::nullopt, std::nullopt);
        l.repo.acknowledge(*l.repo.next(), QJsonObject{{u"id"_s, u"srv1"_s}});
        QCOMPARE(l.repo.serverIdOf(u.localId), u"srv1"_s);
        QVERIFY(!l.repo.next());
    }

    void changesMadeOfflineReachTheServerInOrderWhenItIsBack()
    {
        World w;
        w.server.offline = true;
        const TaskItem t = w.local.repo.add(u"Written on a plane"_s, u"2026-10-22"_s, std::nullopt);
        w.local.repo.rename(t.localId, u"Written on a plane, renamed"_s);
        w.local.repo.complete(t.localId);
        QCOMPARE(w.engine.round().kind, SyncStatus::Kind::Offline);
        QCOMPARE(w.local.repo.pendingCount(), 3);
        w.server.offline = false;
        QCOMPARE(w.engine.round().kind, SyncStatus::Kind::Synced);
        QCOMPARE(w.local.repo.pendingCount(), 0);
        QCOMPARE(w.server.mutationsSent().mid(w.server.mutationsSent().size() - 3),
                 (QStringList{Mutations::add, Mutations::update, Mutations::complete}));
        const auto onServer = w.server.taskTitled(u"Written on a plane, renamed"_s);
        QVERIFY(onServer);
        QCOMPARE((*onServer)[u"status"].toString(), u"done"_s);
        QCOMPARE((*onServer)[u"clientId"].toString(), t.localId);
        const TaskItem row = *w.local.repo.task(t.localId);
        QCOMPARE(row.serverId, (*onServer)[u"id"].toString());
        QVERIFY(row.serverUpdatedAt);
    }

    void aChangeWhoseAnswerWasLostIsResentAndAppliedOnce()
    {
        World w;
        w.local.repo.add(u"Once"_s, std::nullopt, std::nullopt);
        w.server.loseNextAnswer = true;
        QCOMPARE(w.engine.round().kind, SyncStatus::Kind::Offline);
        QCOMPARE(w.local.repo.pendingCount(), 1);
        w.engine.round();
        int onServer = 0;
        for (const auto &task : w.server.allTasks())
            onServer += task[u"title"].toString() == u"Once" ? 1 : 0;
        QCOMPARE(onServer, 1);
        QCOMPARE(w.local.repo.allTasks().size(), 1);
    }

    void tasksAddedElsewhereArriveAndEditsElsewhereWinWhereNothingWaits()
    {
        World w;
        const QString id = w.server.addElsewhere(u"From the agent"_s, u"2026-10-22"_s);
        w.engine.round();
        QCOMPARE(w.local.repo.task(id)->title, u"From the agent"_s);
        w.local.clock += 1000;
        w.server.editElsewhere(id, {{u"title"_s, u"Renamed by the agent"_s}, {u"updatedAt"_s, w.local.clock}});
        w.engine.round();
        QCOMPARE(w.local.repo.task(id)->title, u"Renamed by the agent"_s);
    }

    void aWaitingLocalChangeKeepsItsFieldAgainstTheSnapshot()
    {
        World w;
        const QString id = w.server.addElsewhere(u"Shared"_s, u"2026-10-22"_s);
        w.engine.round();
        w.local.repo.rename(id, u"Mine"_s);
        w.local.clock += 1000;
        w.server.editElsewhere(id, {{u"note"_s, u"agent note"_s}, {u"updatedAt"_s, w.local.clock}});
        // Sending fails, but the snapshot read in the same round must not undo the waiting rename.
        w.server.failNextMutation = true;
        QCOMPARE(w.engine.round().kind, SyncStatus::Kind::Offline);
        QVERIFY(!w.server.taskTitled(u"Mine"_s));
        QCOMPARE(w.local.repo.task(id)->title, u"Mine"_s);
        QCOMPARE(w.local.repo.task(id)->note, u"agent note"_s);
        w.engine.round();
        QVERIFY(w.server.taskTitled(u"Mine"_s));
    }

    void aRevokedDeviceStopsWithChangesKept()
    {
        World w;
        w.local.repo.add(u"Kept"_s, std::nullopt, std::nullopt);
        w.server.revoked = true;
        QCOMPARE(w.engine.round().kind, SyncStatus::Kind::SignedOut);
        QCOMPARE(w.revoked, 1);
        QCOMPARE(w.local.repo.pendingCount(), 1);
    }

    void aChangeTheServerRefusesIsDroppedAndTheNextSnapshotRepairsTheRow()
    {
        World w;
        const QString id = w.server.addElsewhere(u"Exists"_s, u"2026-10-22"_s);
        w.engine.round();
        w.server.editElsewhere(id, {{u"deletedAt"_s, w.local.clock}});
        w.local.repo.rename(id, u"Too late"_s);
        w.engine.round();
        QCOMPARE(w.local.repo.pendingCount(), 0);
        QCOMPARE(w.local.repo.task(id)->title, u"Exists"_s);
        QVERIFY(w.local.repo.task(id)->inTrash());
    }

    void aTaskRestoredBetweenTheTwoListsStays()
    {
        World w;
        const QString id = w.server.addElsewhere(u"Restored"_s, u"2026-10-22"_s);
        w.server.editElsewhere(id, {{u"deletedAt"_s, w.local.clock}});
        w.engine.round();
        QVERIFY(w.local.repo.task(id)->inTrash());
        w.local.clock += 1000;
        // Restored elsewhere after the active list was read and before the trash was: in neither list.
        w.server.restoreAfterNextActiveQuery = id;
        QCOMPARE(w.engine.round().kind, SyncStatus::Kind::Synced);
        QVERIFY(w.local.repo.task(id));
        QVERIFY(!w.local.repo.task(id)->inTrash());
    }

    void aTaskPurgedFromTheServerLeavesThisComputer()
    {
        World w;
        const QString id = w.server.addElsewhere(u"Purged"_s, u"2026-10-22"_s);
        w.server.editElsewhere(id, {{u"deletedAt"_s, w.local.clock}});
        w.engine.round();
        QVERIFY(w.local.repo.task(id));
        w.server.purge(id);
        QCOMPARE(w.engine.round().kind, SyncStatus::Kind::Synced);
        QVERIFY(!w.local.repo.task(id));
    }

    void theWorkerSyncsOnItsOwnThreadAndAgainWhenPoked()
    {
        // A real worker needs a reachable server; without one it reports Offline and keeps the change waiting.
        QTemporaryDir dir;
        const QString path = dir.filePath(u"dayhand.sqlite"_s);
        {
            auto database = Database::open(path);
            TaskRepository repo(*database, {[] { return qint64(1); }, [] { return u"local-1"_s; }, [] { return u"UTC"_s; }, {}});
            repo.add(u"Waiting"_s, std::nullopt, std::nullopt);
        }
        SyncWorker worker(path, {u"http://127.0.0.1:9"_s, u"http://127.0.0.1:9"_s, u"d"_s, u"Linux"_s, u"t"_s});
        QSignalSpy status(&worker, &SyncWorker::statusChanged);
        worker.start();
        QTRY_VERIFY_WITH_TIMEOUT(status.size() >= 2, 20'000);
        QCOMPARE(status[0][0].toInt(), int(SyncStatus::Kind::Connecting));
        QCOMPARE(status[1][0].toInt(), int(SyncStatus::Kind::Offline));
        worker.poke();
        QTRY_VERIFY_WITH_TIMEOUT(status.size() >= 3, 20'000);
        worker.stop();
        auto database = Database::open(path);
        QCOMPARE(database->pendingCount(), 1);
    }
};

QTEST_GUILESS_MAIN(SyncTest)
#include "tst_sync.moc"
