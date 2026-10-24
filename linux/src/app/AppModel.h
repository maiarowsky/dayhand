#pragma once

#include "Credentials.h"
#include "Database.h"
#include "Reminders.h"
#include "SyncEngine.h"
#include "SyncWorker.h"
#include "TaskRepository.h"
#include "TodaySections.h"

#include <QColor>
#include <QObject>
#include <QSettings>
#include <QTimer>
#include <QVariantList>
#include <QVariantMap>

#include <functional>
#include <memory>

namespace dayhand {

/// Where the model keeps things and what it may start; the app's own, or a test's.
struct AppEnvironment {
    QString databasePath;
    std::unique_ptr<CredentialStore> credentials;
    std::unique_ptr<QSettings> preferences;
    std::function<qint64()> clock;
    std::function<QString()> localTimezone;
    /// Off in tests and screen snapshots: no sync worker, no network.
    bool sync = true;
    QString deviceName;

    /**
     * The app's own: `$XDG_DATA_HOME/dayhand/dayhand.sqlite`, the Secret Service keyring and
     * `$XDG_CONFIG_HOME/dayhand/dayhand-qt.conf`. `DAYHAND_DATA_DIR` names another folder for the database and the
     * preferences, and `DAYHAND_CREDENTIALS=memory` keeps the sign-in in memory only (gone when the app quits).
     */
    static AppEnvironment standard();
};

/**
 * The app's state on the UI thread: the tasks from the local database (the only source the screens read), the Today
 * sections computed from them, the server connection and the user's actions. Every action goes through
 * [TaskRepository], which changes the row and queues the server mutation together, so nothing waits for the
 * network. The sync worker writes to the same database on its own thread and says when to read it again.
 */
class AppModel final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantList overdue READ overdue NOTIFY sectionsChanged)
    Q_PROPERTY(QVariantMap nowTask READ nowTask NOTIFY sectionsChanged)
    Q_PROPERTY(QVariantList today READ today NOTIFY sectionsChanged)
    Q_PROPERTY(QVariantList done READ done NOTIFY sectionsChanged)
    Q_PROPERTY(bool planEmpty READ planEmpty NOTIFY sectionsChanged)
    Q_PROPERTY(int openCount READ openCount NOTIFY sectionsChanged)
    Q_PROPERTY(int overdueCount READ overdueCount NOTIFY sectionsChanged)
    Q_PROPERTY(QString dateTitle READ dateTitle NOTIFY sectionsChanged)
    Q_PROPERTY(QString statusText READ statusText NOTIFY statusChanged)
    Q_PROPERTY(bool connected READ connected NOTIFY statusChanged)
    Q_PROPERTY(bool offlineMode READ offlineMode NOTIFY statusChanged)
    Q_PROPERTY(int pendingCount READ pendingCount NOTIFY statusChanged)
    Q_PROPERTY(QString serverUrl READ serverUrl NOTIFY statusChanged)
    Q_PROPERTY(QString deviceId READ deviceId NOTIFY statusChanged)
    Q_PROPERTY(bool connecting READ connecting NOTIFY connectingChanged)
    Q_PROPERTY(QString alert READ alert NOTIFY alertChanged)
    Q_PROPERTY(QColor overdueColor READ overdueColor NOTIFY themeChanged)
    Q_PROPERTY(QString language READ language NOTIFY languageChanged)
    Q_PROPERTY(QVariantList languages READ languages NOTIFY languageChanged)
    Q_PROPERTY(QVariantMap selectedTask READ selectedTask NOTIFY selectedTaskChanged)

public:
    explicit AppModel(AppEnvironment environment, QObject *parent = nullptr);
    ~AppModel() override;

    QVariantList overdue() const { return rows(sections.overdue, true); }
    QVariantMap nowTask() const;
    QVariantList today() const { return rows(sections.today, false); }
    QVariantList done() const { return rows(sections.done, false); }
    bool planEmpty() const { return sections.isEmpty(); }
    int openCount() const { return int(sections.openCount()); }
    int overdueCount() const { return int(sections.overdue.size()); }
    QString dateTitle() const;
    QString statusText() const;
    bool connected() const { return credential.has_value(); }
    bool offlineMode() const;
    int pendingCount() const { return int(pending); }
    QString serverUrl() const;
    QString deviceId() const { return credential ? credential->deviceId : QString(); }
    bool connecting() const { return connectInFlight; }
    QString alert() const { return alertText; }
    QColor overdueColor() const { return overdueTint; }
    /// The chosen language (`pl`, `pt_BR`, …), empty for the system's.
    QString language() const;
    /// The language menu: `code` (empty for the system's) and `name` in that language.
    QVariantList languages() const;
    /// The selected local row, including tasks no longer on Today; empty after closing or a server purge.
    QVariantMap selectedTask() const;

    const QList<TaskItem> &tasks() const { return allTasks; }
    const TodaySections &todaySections() const { return sections; }
    ReminderSettings settings() const { return reminderSettings; }
    Database &database() { return *db; }
    qint64 now() const { return clock(); }
    void setOverdueColor(const QColor &color);

    /// Adds a task from one line of quick add: a date phrase at its end sets the day and time, otherwise today.
    Q_INVOKABLE bool quickAdd(const QString &line, bool readPhrase = true);
    /// What quick add will make of [line]: `title`, `when` and the `phrase` read as the date (empty when none).
    Q_INVOKABLE QVariantMap preview(const QString &line, bool readPhrase = true) const;
    Q_INVOKABLE void toggleDone(const QString &id);
    Q_INVOKABLE void setNow(const QString &id);
    Q_INVOKABLE void clearNow();
    Q_INVOKABLE void moveToToday(const QString &id);
    Q_INVOKABLE void moveToTomorrow(const QString &id);
    Q_INVOKABLE void archive(const QString &id);
    Q_INVOKABLE void moveToTrash(const QString &id);
    Q_INVOKABLE void openDetails(const QString &id);
    Q_INVOKABLE void closeDetails();
    Q_INVOKABLE bool rename(const QString &id, const QString &title);
    Q_INVOKABLE void setStatus(const QString &id, const QString &status);
    Q_INVOKABLE void setResumeNote(const QString &id, const QString &note);
    Q_INVOKABLE bool saveNote(const QString &id, const QString &note);
    Q_INVOKABLE bool setLabels(const QString &id, const QString &commaSeparated);
    Q_INVOKABLE bool addChecklistItem(const QString &id, const QString &title);
    Q_INVOKABLE void renameChecklistItem(const QString &id, const QString &itemId, const QString &title);
    Q_INVOKABLE void toggleChecklistItem(const QString &id, const QString &itemId);
    Q_INVOKABLE void removeChecklistItem(const QString &id, const QString &itemId);
    /// Date phrases use the same grammar and server timezone as quick add; invalid input changes nothing.
    Q_INVOKABLE QVariantMap previewDue(const QString &phrase) const;
    Q_INVOKABLE bool setDuePhrase(const QString &id, const QString &phrase);
    Q_INVOKABLE void clearDue(const QString &id);
    Q_INVOKABLE void removeDueTime(const QString &id);
    Q_INVOKABLE void restore(const QString &id);
    /// Pairs with a server; the answer comes as [connectFinished] (an empty message on success).
    Q_INVOKABLE void connectServer(const QString &address, const QString &code);
    Q_INVOKABLE void useOffline();
    /// Forgets the sign-in on this computer. Tasks and waiting changes stay; `dayhand revoke` ends it on the server.
    Q_INVOKABLE void disconnectServer();
    Q_INVOKABLE void syncNow();
    Q_INVOKABLE void dismissAlert();
    /// Switches the language at once and keeps the choice; empty follows the system.
    Q_INVOKABLE void setLanguage(const QString &code);
    /// A `dayhand://pair` or `helm://pair` link: opens Connect filled in. False when it is not one.
    Q_INVOKABLE bool openLink(const QString &url);
    /// Reads the database again and recomputes Today (after a sync round, and every 30 seconds for midnight).
    Q_INVOKABLE void reload();

signals:
    void sectionsChanged();
    void statusChanged();
    void connectingChanged();
    void alertChanged();
    void themeChanged();
    void languageChanged();
    void selectedTaskChanged();
    void connectFinished(const QString &error);
    /// Connect should open, filled in from a pairing link (either may be empty).
    void connectRequested(const QString &serverUrl, const QString &code);
    /// Tasks or settings changed: reminders and the tray follow.
    void tasksChanged();

private:
    QVariantList rows(const QList<TaskItem> &tasks, bool overdue) const;
    QVariantMap row(const TaskItem &task, bool overdue) const;
    bool run(const std::function<void(TaskRepository &)> &action);
    void startSession(const DeviceCredential &credential);
    void stopSession();
    void signedOut();
    void showAlert(const QString &text);
    void finishConnect(const ConnectResult &result);

    AppEnvironment environment;
    std::function<qint64()> clock;
    std::unique_ptr<Database> db;
    std::unique_ptr<TaskRepository> repository;
    std::unique_ptr<SyncWorker> worker;
    QList<TaskItem> allTasks;
    TodaySections sections;
    ReminderSettings reminderSettings;
    std::optional<DeviceCredential> credential;
    SyncStatus status;
    qint64 pending = 0;
    bool connectInFlight = false;
    QString alertText;
    QString selectedId;
    QColor overdueTint{0xd0, 0x3a, 0x3a};
    QTimer clockTimer;
};

} // namespace dayhand
