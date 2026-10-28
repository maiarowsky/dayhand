#include "AppModel.h"

#include "Formatting.h"
#include "HelmDates.h"
#include "PairingInput.h"
#include "QuickAdd.h"
#include "TaskRules.h"
#include "Translations.h"

#include <QDir>
#include <QFutureWatcher>
#include <QStandardPaths>
#include <QSysInfo>
#include <QTimeZone>
#include <QUuid>
#include <QtConcurrent>

#include <algorithm>

using namespace Qt::StringLiterals;

namespace dayhand {

namespace {

const QString useOfflineKey = u"useOffline"_s;
const QString lastServerKey = u"lastServerUrl"_s;
const QString languageKey = u"language"_s;

QString upperFirst(const QString &text)
{
    return text.isEmpty() ? text : text.left(1).toUpper() + text.mid(1);
}

} // namespace

AppEnvironment AppEnvironment::standard()
{
    AppEnvironment environment;
    const QString custom = qEnvironmentVariable("DAYHAND_DATA_DIR");
    const QString dataDir = custom.isEmpty() ? QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) : custom;
    environment.databasePath = QDir(dataDir).filePath(u"dayhand.sqlite"_s);
    if (qEnvironmentVariable("DAYHAND_CREDENTIALS") == u"memory")
        environment.credentials = std::make_unique<MemoryCredentialStore>();
    else
        environment.credentials = std::make_unique<SecretServiceStore>();
    environment.preferences = custom.isEmpty()
        ? std::make_unique<QSettings>(u"dayhand"_s, u"dayhand-qt"_s)
        : std::make_unique<QSettings>(QDir(custom).filePath(u"dayhand-qt.conf"_s), QSettings::IniFormat);
    environment.clock = &nowMs;
    environment.localTimezone = [] { return QString::fromUtf8(QTimeZone::systemTimeZoneId()); };
    environment.deviceName = QSysInfo::machineHostName();
    return environment;
}

AppModel::AppModel(AppEnvironment env, QObject *parent)
    : QObject(parent)
    , environment(std::move(env))
    , clock(environment.clock ? environment.clock : std::function<qint64()>(&nowMs))
{
    Translations::install(Translations::resolve(language()));
    db = Database::open(environment.databasePath);
    const auto timezone = environment.localTimezone;
    repository = std::make_unique<TaskRepository>(
        *db, TaskRepository::Hooks{clock, [] { return QUuid::createUuid().toString(QUuid::WithoutBraces); }, timezone,
                                   [this] {
                                       if (worker)
                                           worker->poke();
                                   }});
    connect(&clockTimer, &QTimer::timeout, this, &AppModel::reload);
    clockTimer.start(30'000);
    reload();
    const CredentialLoad loaded = environment.credentials->load();
    if (!loaded.error.isEmpty())
        showAlert(tr("The keyring could not be read (%1), so Dayhand starts without a server.").arg(loaded.error));
    credential = loaded.credential;
    if (credential)
        startSession(*credential);
}

AppModel::~AppModel()
{
    stopSession();
}

QVariantMap AppModel::nowTask() const
{
    return sections.now ? row(*sections.now, false) : QVariantMap();
}

QString AppModel::dateTitle() const
{
    return Formatting::dayName(sections.date);
}

QString AppModel::statusText() const
{
    return Formatting::status(status, pending, offlineMode()).value_or(QString());
}

bool AppModel::offlineMode() const
{
    return environment.preferences->value(useOfflineKey, false).toBool();
}

QString AppModel::serverUrl() const
{
    return credential ? credential->serverUrl : environment.preferences->value(lastServerKey).toString();
}

void AppModel::setOverdueColor(const QColor &color)
{
    if (!color.isValid() || color == overdueTint)
        return;
    overdueTint = color;
    emit themeChanged();
}

QVariantList AppModel::rows(const QList<TaskItem> &tasks, bool overdue) const
{
    QVariantList out;
    for (const TaskItem &task : tasks)
        out.append(row(task, overdue));
    return out;
}

QVariantList AppModel::trash() const
{
    QList<TaskItem> deleted;
    for (const TaskItem &task : allTasks)
        if (task.inTrash())
            deleted.append(task);
    std::sort(deleted.begin(), deleted.end(), [](const TaskItem &a, const TaskItem &b) {
        return a.deletedAt != b.deletedAt ? a.deletedAt > b.deletedAt : a.localId < b.localId;
    });
    QVariantList out;
    for (const TaskItem &task : deleted) {
        QVariantMap entry = row(task, false);
        entry.insert(u"expiry"_s, Formatting::trashExpiry(*task.deletedAt, sections.date, reminderSettings.timezone));
        out.append(entry);
    }
    return out;
}

QVariantList AppModel::defaultReminderMinutes() const
{
    QVariantList out;
    for (int minutes : reminderSettings.reminderMinutes)
        out.append(minutes);
    return out;
}

QVariantMap AppModel::selectedTask() const
{
    for (const TaskItem &task : allTasks) {
        if (task.localId != selectedId)
            continue;
        QVariantMap detail = row(task, false);
        QVariantList checklist;
        for (const ChecklistItem &item : task.checklist)
            checklist.append(QVariantMap{{u"id"_s, item.id}, {u"title"_s, item.title}, {u"done"_s, item.done}});
        QVariantList links;
        for (const TaskLink &link : task.links)
            links.append(QVariantMap{{u"url"_s, link.url}, {u"title"_s, link.title.value_or(link.url)}});
        detail.insert(u"status"_s, statusWire(task.status));
        detail.insert(u"note"_s, task.note.value_or(QString()));
        detail.insert(u"dueDate"_s, task.dueDate.value_or(QString()));
        detail.insert(u"dueTime"_s, task.dueTime.value_or(QString()));
        detail.insert(u"due"_s, Formatting::due(task, sections.date).value_or(tr("No day")));
        detail.insert(u"checklist"_s, checklist);
        detail.insert(u"repeat"_s, Formatting::repeat(task, sections.date));
        detail.insert(u"reminders"_s, Formatting::reminders(task, reminderSettings));
        detail.insert(u"links"_s, links);
        detail.insert(u"inTrash"_s, task.inTrash());
        detail.insert(u"archived"_s, task.archivedAt.has_value());
        return detail;
    }
    return {};
}

void AppModel::openDetails(const QString &id)
{
    if (id == selectedId)
        return;
    selectedId = id;
    emit selectedTaskChanged();
}

void AppModel::closeDetails()
{
    if (selectedId.isEmpty())
        return;
    selectedId.clear();
    emit selectedTaskChanged();
}

QVariantMap AppModel::row(const TaskItem &task, bool overdue) const
{
    return {{u"id"_s, task.localId},
            {u"title"_s, task.title},
            {u"detail"_s, Formatting::detailLine(task, sections.date, overdue)},
            {u"done"_s, task.status == TaskStatus::Done},
            {u"isNow"_s, task.isNow},
            {u"overdue"_s, overdue},
            {u"resumeNote"_s, task.resumeNote.value_or(QString())}};
}

void AppModel::reload()
{
    try {
        const QVariantMap previousDetail = selectedTask();
        const QVariantList previousTrash = trash();
        QList<TaskItem> tasks = repository->allTasks();
        const ReminderSettings settings = repository->settings();
        const qint64 waiting = repository->pendingCount();
        const TodaySections next = dayhand::todaySections(tasks, clock(), settings.timezone);
        const bool settingsMoved = settings != reminderSettings;
        const bool tasksMoved = tasks != allTasks || settingsMoved;
        allTasks = std::move(tasks);
        reminderSettings = settings;
        if (next != sections) {
            sections = next;
            emit sectionsChanged();
        }
        if (waiting != pending) {
            pending = waiting;
            emit statusChanged();
        }
        if (settingsMoved)
            emit reminderSettingsChanged();
        if (tasksMoved)
            emit tasksChanged();
        if (previousTrash != trash())
            emit trashChanged();
        if (previousDetail != selectedTask())
            emit selectedTaskChanged();
    } catch (const StoreError &error) {
        showAlert(tr("Reading tasks failed: %1").arg(QString::fromStdString(error.what())));
    }
}

bool AppModel::quickAdd(const QString &line, bool readPhrase)
{
    const QuickAddInput input = readPhrase ? QuickAdd::parse(line, clock(), reminderSettings.timezone)
                                           : QuickAddInput{line.trimmed(), std::nullopt, std::nullopt};
    if (!TaskRules::title(input.title))
        return false;
    const QString date = input.when ? input.when->date : sections.date;
    const std::optional<QString> time = input.when ? input.when->time : std::nullopt;
    run([&](TaskRepository &repo) { repo.add(input.title, date, time); });
    return true;
}

QVariantMap AppModel::preview(const QString &line, bool readPhrase) const
{
    const QString trimmed = line.trimmed();
    if (trimmed.isEmpty())
        return {};
    if (!readPhrase)
        return {{u"title"_s, trimmed}, {u"when"_s, tr("Today")}, {u"phrase"_s, QString()}};
    const QuickAddInput input = QuickAdd::parse(trimmed, clock(), reminderSettings.timezone);
    const QString when = input.when ? Formatting::when(*input.when, sections.date) : tr("Today");
    return {{u"title"_s, input.title}, {u"when"_s, when}, {u"phrase"_s, input.phrase.value_or(QString())}};
}

void AppModel::toggleDone(const QString &id)
{
    run([&id](TaskRepository &repo) {
        const auto task = repo.task(id);
        if (task && task->status == TaskStatus::Done)
            repo.reopen(id);
        else if (task)
            repo.complete(id);
    });
}

void AppModel::setNow(const QString &id)
{
    run([&id](TaskRepository &repo) { repo.setNow(id); });
}

void AppModel::clearNow()
{
    run([](TaskRepository &repo) { repo.clearNow(); });
}

void AppModel::moveToToday(const QString &id)
{
    const QString day = sections.date;
    run([&](TaskRepository &repo) { repo.reschedule(id, day); });
}

void AppModel::moveToTomorrow(const QString &id)
{
    const auto tomorrow = HelmDates::addDays(sections.date, 1);
    if (tomorrow)
        run([&](TaskRepository &repo) { repo.reschedule(id, *tomorrow); });
}

void AppModel::archive(const QString &id)
{
    run([&id](TaskRepository &repo) { repo.archive(id); });
}

void AppModel::moveToTrash(const QString &id)
{
    run([&id](TaskRepository &repo) { repo.moveToTrash(id); });
}

bool AppModel::rename(const QString &id, const QString &title)
{
    if (!TaskRules::title(title)) {
        showAlert(tr("Enter a title (up to 500 characters)."));
        return false;
    }
    return run([&](TaskRepository &repo) { repo.rename(id, title); });
}

void AppModel::setStatus(const QString &id, const QString &status)
{
    if (status != u"todo" && status != u"doing" && status != u"done")
        return;
    run([&](TaskRepository &repo) { repo.setStatus(id, statusFromWire(status)); });
}

void AppModel::setResumeNote(const QString &id, const QString &note)
{
    if (note.trimmed().size() > TaskRules::maxResumeNote) {
        showAlert(tr("Use up to 2000 characters for where you stopped."));
        return;
    }
    run([&](TaskRepository &repo) { repo.setResumeNote(id, note); });
}

bool AppModel::saveNote(const QString &id, const QString &note)
{
    return run([&](TaskRepository &repo) { repo.setNote(id, note); });
}

bool AppModel::addChecklistItem(const QString &id, const QString &title)
{
    if (!TaskRules::title(title))
        return false;
    return run([&](TaskRepository &repo) {
        if (const auto task = repo.task(id)) {
            QList<ChecklistItem> items = task->checklist;
            items.append({QUuid::createUuid().toString(QUuid::WithoutBraces), title, false});
            repo.setChecklist(id, items);
        }
    });
}

void AppModel::renameChecklistItem(const QString &id, const QString &itemId, const QString &title)
{
    if (!TaskRules::title(title)) {
        showAlert(tr("Enter a title (up to 500 characters)."));
        return;
    }
    run([&](TaskRepository &repo) {
        if (const auto task = repo.task(id)) {
            QList<ChecklistItem> items = task->checklist;
            for (ChecklistItem &item : items)
                if (item.id == itemId)
                    item.title = title;
            repo.setChecklist(id, items);
        }
    });
}

void AppModel::toggleChecklistItem(const QString &id, const QString &itemId)
{
    run([&](TaskRepository &repo) {
        if (const auto task = repo.task(id)) {
            QList<ChecklistItem> items = task->checklist;
            for (ChecklistItem &item : items)
                if (item.id == itemId)
                    item.done = !item.done;
            repo.setChecklist(id, items);
        }
    });
}

void AppModel::removeChecklistItem(const QString &id, const QString &itemId)
{
    run([&](TaskRepository &repo) {
        if (const auto task = repo.task(id)) {
            QList<ChecklistItem> items = task->checklist;
            items.removeIf([&](const ChecklistItem &item) { return item.id == itemId; });
            repo.setChecklist(id, items);
        }
    });
}

QVariantMap AppModel::previewDue(const QString &phrase) const
{
    const WhenResult result = WhenParser::parse(phrase, clock(), reminderSettings.timezone);
    return {{u"valid"_s, result.ok()},
            {u"text"_s, result.when ? Formatting::when(*result.when, sections.date)
                                   : tr("Date not understood. Try: tomorrow 9am, fri, 2026-10-30.")}};
}

bool AppModel::setDuePhrase(const QString &id, const QString &phrase)
{
    const WhenResult result = WhenParser::parse(phrase, clock(), reminderSettings.timezone);
    if (!result.when)
        return false;
    return run([&](TaskRepository &repo) { repo.setDue(id, result.when->date, result.when->time); });
}

void AppModel::clearDue(const QString &id)
{
    run([&](TaskRepository &repo) { repo.setDue(id, std::nullopt, std::nullopt); });
}

void AppModel::removeDueTime(const QString &id)
{
    run([&](TaskRepository &repo) {
        if (const auto task = repo.task(id))
            repo.setDue(id, task->dueDate, std::nullopt);
    });
}

void AppModel::restore(const QString &id)
{
    run([&](TaskRepository &repo) { repo.restore(id); });
}

bool AppModel::run(const std::function<void(TaskRepository &)> &action)
{
    bool saved = false;
    try {
        action(*repository);
        saved = true;
    } catch (const InvalidChange &error) {
        QString message = upperFirst(QString::fromStdString(error.what()));
        showAlert(message.endsWith(u'.') ? message : message + u'.');
    } catch (const StoreError &error) {
        showAlert(tr("The change could not be saved: %1").arg(QString::fromStdString(error.what())));
    }
    reload();
    return saved;
}

void AppModel::connectServer(const QString &address, const QString &code)
{
    if (connectInFlight)
        return;
    connectInFlight = true;
    emit connectingChanged();
    CredentialStore *store = environment.credentials.get();
    const QString name = environment.deviceName;
    auto *watcher = new QFutureWatcher<ConnectResult>(this);
    connect(watcher, &QFutureWatcher<ConnectResult>::finished, this, [this, watcher] {
        finishConnect(watcher->result());
        watcher->deleteLater();
    });
    // The pairing call waits for the network, so it runs off the UI thread with its own network access.
    watcher->setFuture(QtConcurrent::run([store, address, code, name] {
        NetworkTransport transport;
        return DevicePairing::connect(PairingApi(transport), *store, address, code, name);
    }));
}

void AppModel::finishConnect(const ConnectResult &result)
{
    connectInFlight = false;
    emit connectingChanged();
    if (result.error != ConnectError::None || !result.credential) {
        emit connectFinished(DevicePairing::message(result.error, result.retryAfterSeconds));
        return;
    }
    environment.preferences->setValue(lastServerKey, result.credential->serverUrl);
    environment.preferences->setValue(useOfflineKey, false);
    credential = result.credential;
    startSession(*credential);
    emit statusChanged();
    emit connectFinished(QString());
}

void AppModel::useOffline()
{
    environment.preferences->setValue(useOfflineKey, true);
    emit statusChanged();
}

void AppModel::disconnectServer()
{
    stopSession();
    const QString error = environment.credentials->remove();
    if (!error.isEmpty())
        showAlert(tr("The sign-in could not be removed from the keyring: %1").arg(error));
    credential.reset();
    status = {};
    emit statusChanged();
}

QString AppModel::language() const
{
    return environment.preferences->value(languageKey).toString();
}

QVariantList AppModel::languages() const
{
    QVariantList out{QVariantMap{
        {u"code"_s, QString()},
        {u"name"_s, tr("System (%1)").arg(Translations::nativeName(Translations::resolve(QString())))}}};
    for (const QString &code : Translations::available())
        out.append(QVariantMap{{u"code"_s, code}, {u"name"_s, Translations::nativeName(code)}});
    return out;
}

void AppModel::setLanguage(const QString &code)
{
    if (code == language())
        return;
    if (code.isEmpty())
        environment.preferences->remove(languageKey);
    else
        environment.preferences->setValue(languageKey, code);
    Translations::install(Translations::resolve(code));
    emit languageChanged();
    // The texts made here (dates, the status line) are read again in the new language.
    emit sectionsChanged();
    emit statusChanged();
    emit selectedTaskChanged();
    emit trashChanged();
}

void AppModel::setSummaryTime(const QString &time)
{
    run([&](TaskRepository &repo) { repo.setSummaryTime(time); });
}

void AppModel::setDefaultReminder(int minutes, bool enabled)
{
    if (minutes < 0 || minutes > 7 * 24 * 60)
        return;
    run([&](TaskRepository &repo) {
        QList<int> values = repo.settings().reminderMinutes;
        if (enabled && !values.contains(minutes))
            values.append(minutes);
        else if (!enabled)
            values.removeAll(minutes);
        repo.setReminderMinutes(values);
    });
}

void AppModel::syncNow()
{
    if (worker)
        worker->poke();
}

void AppModel::dismissAlert()
{
    showAlert(QString());
}

bool AppModel::openLink(const QString &url)
{
    const auto link = PairingInput::parseLink(url);
    if (!link)
        return false;
    emit connectRequested(link->serverUrl.value_or(serverUrl()), link->code.value_or(QString()));
    return true;
}

void AppModel::startSession(const DeviceCredential &paired)
{
    stopSession();
    if (!environment.sync)
        return;
    worker = std::make_unique<SyncWorker>(environment.databasePath, paired);
    connect(worker.get(), &SyncWorker::statusChanged, this, [this](int kind, qint64 at, const QString &reason) {
        status = {SyncStatus::Kind(kind), at, reason};
        emit statusChanged();
    });
    connect(worker.get(), &SyncWorker::databaseChanged, this, &AppModel::reload);
    connect(worker.get(), &SyncWorker::revoked, this, &AppModel::signedOut);
    worker->start();
}

void AppModel::stopSession()
{
    if (!worker)
        return;
    worker->disconnect(this);
    worker->stop();
    worker.reset();
}

void AppModel::signedOut()
{
    if (!credential)
        return;
    stopSession();
    environment.credentials->remove();
    credential.reset();
    status = {SyncStatus::Kind::SignedOut, 0, {}};
    emit statusChanged();
}

void AppModel::showAlert(const QString &text)
{
    if (text == alertText)
        return;
    alertText = text;
    emit alertChanged();
}

} // namespace dayhand
