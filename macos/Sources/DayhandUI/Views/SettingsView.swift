import DayhandCore
import DayhandLocalization
import KeyboardShortcuts
import SwiftUI
import UserNotifications

/// Settings: the language, the quick add shortcut, notifications, the server connection, updates and the licenses.
struct SettingsView: View {
    var body: some View {
        TabView {
            GeneralSettings().tabItem { Label(tr("General"), systemImage: "gearshape") }
            ConnectionSettings().tabItem { Label(tr("Connection"), systemImage: "network") }
            UpdateSettings().tabItem { Label(tr("Updates"), systemImage: "arrow.down.circle") }
            AboutSettings().tabItem { Label(tr("About"), systemImage: "info.circle") }
        }
        .frame(width: 520, height: 420)
    }
}

struct GeneralSettings: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Form {
            LanguageSettings()
            Section(tr("Quick add")) {
                KeyboardShortcuts.Recorder(tr("Shortcut from any app:"), name: .quickAdd)
                Text(tr("Type a title and, at its end, a day or time in English: “Call the accountant fri 2pm”, “Pay rent the 1st”, “Plan next week”."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section(tr("Notifications")) {
                if let notifications = model.notifications {
                    NotificationStatus(scheduler: notifications)
                } else {
                    Text(tr("Notifications need the app bundle (scripts/build-app.sh); swift run has none."))
                        .foregroundStyle(.secondary)
                }
                ReminderSettingsEditor(settings: model.settings)
                LabeledContent(tr("Time zone"), value: model.settings.timezone)
                Text(tr("Shared through the server with the phone, dayhand and agents. A change made here waits on this Mac until the server has it."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}

/**
 * The morning summary time and the default reminders (minutes before the due time of a task without its own), as on
 * the phone. A change shows at once, plans the notifications again and goes to the server through the outbox
 * (`app:updateSettings`); a sync while it waits does not undo it. The time is sent once it has stayed the same for a
 * moment, so stepping through minutes is one change.
 */
struct ReminderSettingsEditor: View {
    @EnvironmentObject private var model: AppModel
    let settings: ReminderSettings

    @State private var summary: Date

    init(settings: ReminderSettings) {
        self.settings = settings
        _summary = State(initialValue: PickerDates.time(settings.summaryTime))
    }

    private let columns = Array(repeating: GridItem(.flexible(), alignment: .leading), count: 3)

    var body: some View {
        DatePicker(tr("Morning summary"), selection: $summary, displayedComponents: .hourAndMinute)
            .environment(\.timeZone, PickerDates.zone)
            .onChange(of: settings.summaryTime) { summary = PickerDates.time($0) }
            .task(id: summary) {
                let time = PickerDates.hhmm(summary)
                guard time != settings.summaryTime else { return }
                try? await Task.sleep(nanoseconds: 800_000_000)
                guard !Task.isCancelled else { return }
                model.setSummaryTime(time)
            }
        VStack(alignment: .leading, spacing: 6) {
            Text(tr("Default reminders"))
            LazyVGrid(columns: columns, alignment: .leading, spacing: 4) {
                ForEach(Self.choices(settings.reminderMinutes), id: \.self) { minutes in
                    Toggle(Formatting.minutes(minutes), isOn: Binding(
                        get: { settings.reminderMinutes.contains(minutes) },
                        set: { on in model.setDefaultReminders(Self.toggled(settings.reminderMinutes, minutes, on: on)) }
                    ))
                    .toggleStyle(.checkbox)
                }
            }
            if settings.reminderMinutes.isEmpty {
                Text(tr("No reminders unless a task has its own.")).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    /// The usual choices and any other the settings already have (set on the phone or with dayhand).
    static func choices(_ current: [Int]) -> [Int] { Set(ReminderDraft.beforeOptions).union(current).sorted() }

    static func toggled(_ current: [Int], _ minutes: Int, on: Bool) -> [Int] {
        var set = Set(current)
        if on { set.insert(minutes) } else { set.remove(minutes) }
        return set.sorted()
    }
}

/// The language: the Mac's, or one of the eight. Dayhand's own texts change at once; the menus that come with macOS
/// follow at the next start, so a restart is offered.
struct LanguageSettings: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Section(tr("Language")) {
            Picker(tr("Language"), selection: Binding(get: { model.languageChoice }, set: { model.chooseLanguage($0) })) {
                Text(tr("System (\(Localization(language: model.systemLanguage).nativeName))")).tag(AppModel.systemLanguageChoice)
                ForEach(Localization.supported, id: \.self) { language in
                    Text(verbatim: Localization(language: language).nativeName).tag(language)
                }
            }
            if model.languageNeedsRestart {
                HStack {
                    Text(tr("Menus that come with macOS change language when Dayhand restarts."))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    if model.canRelaunch {
                        Button(tr("Restart Dayhand")) { model.relaunch() }
                    }
                }
            }
        }
    }
}

struct NotificationStatus: View {
    @ObservedObject var scheduler: NotificationScheduler

    var body: some View {
        HStack {
            switch scheduler.authorization {
            case .authorized, .provisional:
                Label(tr("Reminders and the morning summary are on."), systemImage: "bell")
            case .denied:
                Label(tr("Notifications are off for Dayhand."), systemImage: "bell.slash")
                Spacer()
                Button(tr("Open System Settings")) {
                    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension")!)
                }
            default:
                Label(tr("Dayhand has not asked yet."), systemImage: "bell.badge")
                Spacer()
                Button(tr("Allow Notifications")) { Task { await scheduler.requestAuthorization() } }
            }
        }
        .task { await scheduler.refreshAuthorization() }
    }
}

struct ConnectionSettings: View {
    @EnvironmentObject private var model: AppModel
    @State private var confirmDisconnect = false

    var body: some View {
        Form {
            if let credential = model.credential {
                Section(tr("Server")) {
                    LabeledContent(tr("Address"), value: credential.serverUrl)
                    LabeledContent(tr("This Mac"), value: credential.deviceName)
                    LabeledContent(tr("Status"), value: Formatting.status(model.status, pending: model.pending, useOffline: false) ?? tr("Connected"))
                    LabeledContent(tr("Changes waiting"), value: "\(model.pending)")
                    HStack {
                        Button(tr("Sync Now")) { Task { await model.syncNow() } }
                        Spacer()
                        Button(tr("Disconnect…"), role: .destructive) { confirmDisconnect = true }
                    }
                }
            } else {
                Section(tr("Server")) {
                    Text(Formatting.status(model.status, pending: model.pending, useOffline: model.useOffline) ?? tr("No server connected."))
                    LabeledContent(tr("Changes waiting"), value: "\(model.pending)")
                    Button(tr("Connect to Server…")) {
                        model.showConnect = true
                        model.showMainWindow()
                    }
                }
            }
        }
        .formStyle(.grouped)
        .confirmationDialog(tr("Disconnect this Mac?"), isPresented: $confirmDisconnect) {
            Button(tr("Disconnect"), role: .destructive) { model.disconnect() }
        } message: {
            Text(tr("Dayhand forgets the sign-in on this Mac; your tasks stay here. To end it on the server too, run: dayhand revoke \(model.credential?.deviceId ?? "<deviceId>")"))
        }
    }
}

struct AboutSettings: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: "Dayhand").font(.title2).bold()
            Text(tr("Version \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? tr("development"))"))
                .foregroundStyle(.secondary)
            Text(tr("Your day plan, offline first. Licensed under the Apache License 2.0."))
            Text(tr("Built with GRDB.swift (MIT), KeyboardShortcuts (MIT) and Sparkle (MIT)."))
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
