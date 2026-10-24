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
                LabeledContent(tr("Morning summary"), value: DateText.time(model.settings.summaryTime))
                LabeledContent(tr("Default reminders"), value: model.settings.reminderMinutes.isEmpty ? tr("None") : model.settings.reminderMinutes.map(Formatting.minutes).joined(separator: DateText.listSeparator))
                LabeledContent(tr("Time zone"), value: model.settings.timezone)
                Text(tr("These come from the server's settings, so the phone, the agent and this Mac agree. Change them on the phone or with dayhand."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
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
                        Button(tr("Sync Now")) { model.syncNow() }
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
