// The Android app's SnapshotMergerTest, case for case as the macOS app carries it: last write wins per field.
#include "SnapshotMerger.h"
#include "SyncEngine.h"
#include "TestSupport.h"
#include "Json.h"

#include <QJsonArray>

#include <QTest>

using namespace dayhand;
using namespace dayhand::test;
using namespace Qt::StringLiterals;

namespace {

constexpr qint64 now = 1'000'000;

RemoteTask remote(const QString &id, qint64 updatedAt, const std::function<void(RemoteTask &)> &change = {})
{
    RemoteTask r;
    r.id = id;
    r.title = u"Server "_s + id;
    r.dueDate = u"2026-10-22"_s;
    r.createdAt = 1;
    r.updatedAt = updatedAt;
    if (change)
        change(r);
    return r;
}

TaskItem row(const QString &localId, std::optional<QString> serverId, std::optional<qint64> serverUpdatedAt,
             const std::function<void(TaskItem &)> &change = {})
{
    TaskItem t;
    t.localId = localId;
    t.serverId = serverId;
    t.clientId = localId;
    t.title = u"Local "_s + localId;
    t.dueDate = u"2026-10-22"_s;
    t.createdAt = 1;
    t.updatedAt = now;
    t.serverUpdatedAt = serverUpdatedAt;
    if (change)
        change(t);
    return t;
}

OutboxOp op(const QString &mutation, std::optional<QString> localId, const QString &args = u"{}"_s, const QString &opId = {})
{
    OutboxOp o;
    o.opId = opId.isEmpty() ? u"op-%1-%2"_s.arg(mutation, localId.value_or(QString())) : opId;
    o.mutation = mutation;
    o.argsJson = args;
    o.taskLocalId = localId;
    o.clientId = u"c"_s;
    return o;
}

TaskItem single(const MergePlan &plan)
{
    if (plan.upserts.size() != 1)
        qFatal("expected exactly one upsert");
    return plan.upserts.first();
}

} // namespace

class MergeTest : public QObject {
    Q_OBJECT

private slots:
    void settingsWithWaitingChangesSurviveSnapshots_data()
    {
        QTest::addColumn<bool>("summary");
        QTest::addColumn<bool>("minutes");
        QTest::newRow("summary only") << true << false;
        QTest::newRow("reminders only") << false << true;
        QTest::newRow("both fields") << true << true;
    }

    void settingsWithWaitingChangesSurviveSnapshots()
    {
        QFETCH(bool, summary);
        QFETCH(bool, minutes);
        auto db = Database::open(u":memory:"_s);
        TestIds ids;
        int changes = 0;
        TaskRepository repo(*db, {[] { return now; }, [&] { return ids.next(); },
                                  [] { return u"UTC"_s; }, [&] { ++changes; }});
        if (summary) {
            repo.setSummaryTime(u"06:00"_s);
            repo.setSummaryTime(u"06:45"_s); // Several edits keep the latest local choice.
            repo.setSummaryTime(u"06:45"_s); // An unchanged value adds no mutation.
        }
        if (minutes) {
            repo.setReminderMinutes({15, 0, 15});
            repo.setReminderMinutes({0, 15});
        }
        const int queued = (summary ? 2 : 0) + (minutes ? 1 : 0);
        QCOMPARE(repo.pendingCount(), queued);
        QCOMPARE(changes, queued);
        for (const OutboxOp &op : repo.pendingOps()) {
            QCOMPARE(op.mutation, u"app:updateSettings"_s);
            QVERIFY(!op.taskLocalId);
            const QJsonObject args = json::decode(op.argsJson).toObject();
            QVERIFY(!args.value(u"clientId").toString().isEmpty());
            QVERIFY(!args.contains(u"taskId"));
            QVERIFY(!args.contains(u"timezone"));
            QCOMPARE(args.size(), 2); // Only the edited field and the idempotency key.
        }

        class Sender final : public MutationSender {
        public:
            bool offline = true;
            QList<QJsonValue> sent;
            QStringList mutations;
            SendResult send(const QString &mutation, const QJsonValue &args) override
            {
                mutations.append(mutation);
                sent.append(args);
                return offline ? SendResult::failed(u"offline"_s) : SendResult::applied(QJsonObject());
            }
        } sender;
        class Source final : public SnapshotSource {
        public:
            Snapshot value{{}, {u"Europe/London"_s, u"07:30"_s, {10}}};
            Result snapshot() override { return {value, false, {}}; }
        } source;
        SyncEngine engine(repo, sender, source, [] { return now; });
        QCOMPARE(engine.round().kind, SyncStatus::Kind::Offline);
        const ReminderSettings expected{u"Europe/London"_s, summary ? u"06:45"_s : u"07:30"_s,
                                        minutes ? QList<int>{0, 15} : QList<int>{10}};
        QCOMPARE(repo.settings(), expected);
        QCOMPARE(repo.pendingCount(), queued);
        QCOMPARE(sender.sent.first(), json::decode(repo.pendingOps().first().argsJson));
        // A repeated snapshot does not roll either waiting field back.
        QCOMPARE(engine.round().kind, SyncStatus::Kind::Offline);
        QCOMPARE(repo.settings(), expected);

        sender.offline = false;
        source.value.settings = expected;
        QCOMPARE(engine.round().kind, SyncStatus::Kind::Synced);
        QCOMPARE(repo.pendingCount(), 0);
        for (const QString &mutation : sender.mutations)
            QCOMPARE(mutation, u"app:updateSettings"_s);
        QCOMPARE(sender.sent.at(0), sender.sent.at(1));
        QCOMPARE(sender.sent.at(0), sender.sent.at(2)); // Retries keep the clientId.
        if (minutes)
            QCOMPARE(sender.sent.last()[u"defaultReminderMinutes"], (QJsonValue(QJsonArray{0, 15})));

        // Once acknowledged, other clients' settings (including an empty list) win again.
        source.value.settings = {u"Asia/Tokyo"_s, u"08:15"_s, {}};
        QCOMPARE(engine.round().kind, SyncStatus::Kind::Synced);
        QCOMPARE(repo.settings(), source.value.settings);
    }

    void aTaskCreatedElsewhereIsInsertedUnderItsServerId()
    {
        const TaskItem t = single(SnapshotMerger::merge({}, {}, {remote(u"s1"_s, 10)}, now));
        QCOMPARE(t.localId, u"s1"_s);
        QCOMPARE(t.serverId, u"s1"_s);
        QCOMPARE(t.serverUpdatedAt, 10);
    }

    void aTaskCreatedHereIsMatchedByItsClientIdBeforeTheAddWasAcknowledged()
    {
        const RemoteTask server = remote(u"s9"_s, 10, [](RemoteTask &r) { r.clientId = u"local-1"_s; r.title = u"Local local-1"_s; });
        const MergePlan plan = SnapshotMerger::merge({row(u"local-1"_s, {}, {})}, {op(Mutations::add, u"local-1"_s)}, {server}, now);
        const TaskItem merged = single(plan);
        QCOMPARE(merged.localId, u"local-1"_s);
        QCOMPARE(merged.serverId, u"s9"_s);
        QVERIFY(plan.deletes.isEmpty());
    }

    void fieldsWithAChangeStillWaitingKeepTheLocalValue()
    {
        const TaskItem local = row(u"a"_s, u"s1"_s, 10, [](TaskItem &t) { t.status = TaskStatus::Done; t.completedAt = 500; });
        const RemoteTask server = remote(u"s1"_s, 20, [](RemoteTask &r) { r.title = u"Renamed by the agent"_s; r.dueDate = u"2026-10-24"_s; });
        const TaskItem merged = single(SnapshotMerger::merge({local}, {op(Mutations::complete, u"a"_s)}, {server}, now));
        QCOMPARE(merged.status, TaskStatus::Done);
        QCOMPARE(merged.completedAt, 500);
        QCOMPARE(merged.title, u"Renamed by the agent"_s);
        QCOMPARE(merged.dueDate, u"2026-10-24"_s);
        QCOMPARE(merged.serverUpdatedAt, 20);
    }

    void withoutWaitingChangesTheNewerServerCopyWins()
    {
        const TaskItem local = row(u"a"_s, u"s1"_s, 10, [](TaskItem &t) { t.dueDate = u"2026-10-23"_s; });
        const TaskItem merged = single(SnapshotMerger::merge({local}, {}, {remote(u"s1"_s, 30)}, now));
        QCOMPARE(merged.dueDate, u"2026-10-22"_s);
        QCOMPARE(merged.title, u"Server s1"_s);
    }

    void anOlderOrRepeatedSnapshotNeverUndoesANewerState()
    {
        const TaskItem local = row(u"a"_s, u"s1"_s, 30, [](TaskItem &t) { t.title = u"Newest"_s; });
        const MergePlan plan = SnapshotMerger::merge({local}, {}, {remote(u"s1"_s, 20)}, now);
        QVERIFY(plan.upserts.isEmpty());
        QVERIFY(plan.deletes.isEmpty());
    }

    void aWaitingSetNowKeepsTheNowFlagOfEveryTask()
    {
        const TaskItem target = row(u"a"_s, u"s1"_s, 10, [](TaskItem &t) { t.isNow = true; t.status = TaskStatus::Doing; });
        const TaskItem previous = row(u"b"_s, u"s2"_s, 10);
        const QList<RemoteTask> server{remote(u"s1"_s, 10),
                                       remote(u"s2"_s, 20, [](RemoteTask &r) { r.isNow = true; r.title = u"Agent edit"_s; })};
        const MergePlan plan = SnapshotMerger::merge({target, previous}, {op(Mutations::setNow, u"a"_s)}, server, now);
        const auto b = std::find_if(plan.upserts.begin(), plan.upserts.end(), [](const TaskItem &t) { return t.localId == u"b"; });
        QVERIFY(b != plan.upserts.end());
        QCOMPARE(b->isNow, false);
        QCOMPARE(b->title, u"Agent edit"_s);
    }

    void anUpdateKeepsOnlyItsOwnFieldsLocal()
    {
        const TaskItem local = row(u"a"_s, u"s1"_s, 10, [](TaskItem &t) { t.resumeNote = u"page 4"_s; t.labels = {u"mine"_s}; });
        const RemoteTask server = remote(u"s1"_s, 20, [](RemoteTask &r) {
            r.resumeNote = u"page 3"_s;
            r.title = u"New title"_s;
            r.labels = {u"agent"_s};
            r.note = u"agent note"_s;
        });
        const QList<OutboxOp> pending{op(Mutations::update, u"a"_s, uR"({"resumeNote":"page 4","clientId":"c"})"_s),
                                      op(Mutations::update, u"a"_s, uR"({"labels":["mine"],"clientId":"d"})"_s, u"op2"_s)};
        const TaskItem merged = single(SnapshotMerger::merge({local}, pending, {server}, now));
        QCOMPARE(merged.resumeNote, u"page 4"_s);
        QCOMPARE(merged.labels, QStringList{u"mine"_s});
        QCOMPARE(merged.title, u"New title"_s);
        QCOMPARE(merged.note, u"agent note"_s);
    }

    void aTaskGoneFromTheServerIsDeletedUnlessItHasWaitingChangesOrIsTooFresh()
    {
        const TaskItem gone = row(u"gone"_s, u"s1"_s, 10);
        const TaskItem waiting = row(u"waiting"_s, u"s2"_s, 10);
        const TaskItem fresh = row(u"fresh"_s, u"s3"_s, {}, [](TaskItem &t) { t.updatedAt = now - 1'000; });
        const TaskItem orphan = row(u"orphan"_s, {}, {}, [](TaskItem &t) { t.updatedAt = now - SnapshotMerger::unseenGraceMs - 1; });
        MergePlan plan = SnapshotMerger::merge({gone, waiting, fresh, orphan}, {op(Mutations::archive, u"waiting"_s)}, {}, now);
        std::sort(plan.deletes.begin(), plan.deletes.end());
        QCOMPARE(plan.deletes, (QStringList{u"gone"_s, u"orphan"_s}));
    }

    void repeatLabelsLinksChecklistRemindersAndTheTrashComeFromTheServer()
    {
        const RemoteTask server = remote(u"s1"_s, 10, [](RemoteTask &r) {
            RepeatRule rule;
            rule.every = RepeatEvery::Week;
            rule.weekdays = QList<int>{1, 4};
            r.repeat = rule;
            r.labels = {u"home"_s, u"Helm"_s};
            r.links = {TaskLink{u"https://example.com"_s, u"Spec"_s}};
            r.checklist = {ChecklistItem{u"c1"_s, u"Milk"_s, false}};
            r.deletedAt = 7;
        });
        const TaskItem t = single(SnapshotMerger::merge({}, {}, {server}, now));
        QCOMPARE(t.repeat->weekdays, (QList<int>{1, 4}));
        QCOMPARE(t.labels, (QStringList{u"home"_s, u"Helm"_s}));
        QCOMPARE(t.links.first().title, u"Spec"_s);
        QCOMPARE(t.checklist.size(), 1);
        QCOMPARE(t.deletedAt, 7);
    }

    void theTrashFollowsWaitingChangesAndOtherwiseTheServer()
    {
        const TaskItem trashedHere = row(u"a"_s, u"s1"_s, 10, [](TaskItem &t) { t.deletedAt = 500; });
        QCOMPARE(single(SnapshotMerger::merge({trashedHere}, {op(Mutations::softDelete, u"a"_s)}, {remote(u"s1"_s, 20)}, now)).deletedAt, 500);
        const RemoteTask stillTrashed = remote(u"s1"_s, 20, [](RemoteTask &r) { r.deletedAt = 400; r.title = u"Agent edit"_s; });
        const TaskItem restored = single(SnapshotMerger::merge({row(u"a"_s, u"s1"_s, 10)}, {op(Mutations::restore, u"a"_s)}, {stillTrashed}, now));
        QVERIFY(!restored.deletedAt);
        QCOMPARE(restored.title, u"Agent edit"_s);
        const MergePlan byAgent = SnapshotMerger::merge({row(u"a"_s, u"s1"_s, 10)}, {}, {remote(u"s1"_s, 20, [](RemoteTask &r) { r.deletedAt = 15; })}, now);
        QCOMPARE(single(byAgent).deletedAt, 15);
        QVERIFY(byAgent.deletes.isEmpty());
    }
};

QTEST_GUILESS_MAIN(MergeTest)
#include "tst_merge.moc"
