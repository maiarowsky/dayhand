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
        QList<TaskItem> tasks = repository->allTasks();
        const ReminderSettings settings = repository->settings();
        const qint64 waiting = repository->pendingCount();
        const TodaySections next = dayhand::todaySections(tasks, clock(), settings.timezone);
        const bool tasksMoved = tasks != allTasks || settings != reminderSettings;
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
        if (tasksMoved)
            emit tasksChanged();
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

void AppModel::run(const std::function<void(TaskRepository &)> &action)
{
    try {
        action(*repository);
    } catch (const InvalidChange &error) {
        showAlert(upperFirst(QString::fromStdString(error.what())) + u'.');
    } catch (const StoreError &error) {
        showAlert(tr("The change could not be saved: %1").arg(QString::fromStdString(error.what())));
    }
    reload();
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
