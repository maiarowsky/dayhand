import DayhandCore
import KeyboardShortcuts
import SwiftUI
import UserNotifications

/// Settings: the quick add shortcut, notifications, the server connection, updates and the licenses.
struct SettingsView: View {
    var body: some View {
        TabView {
            GeneralSettings().tabItem { Label("General", systemImage: "gearshape") }
            ConnectionSettings().tabItem { Label("Connection", systemImage: "network") }
            UpdateSettings().tabItem { Label("Updates", systemImage: "arrow.down.circle") }
            AboutSettings().tabItem { Label("About", systemImage: "info.circle") }
        }
        .frame(width: 520, height: 360)
    }
}

struct GeneralSettings: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Form {
            Section("Quick add") {
                KeyboardShortcuts.Recorder("Shortcut from any app:", name: .quickAdd)
                Text("Type a title and, at its end, a day or time: “Call the accountant fri 2pm”, “Pay rent the 1st”, “Plan next week”.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Notifications") {
                if let notifications = model.notifications {
                    NotificationStatus(scheduler: notifications)
                } else {
                    Text("Notifications need the app bundle (scripts/build-app.sh); `swift run` has none.")
                        .foregroundStyle(.secondary)
                }
                LabeledContent("Morning summary", value: model.settings.summaryTime)
                LabeledContent("Default reminders", value: model.settings.reminderMinutes.isEmpty ? "None" : model.settings.reminderMinutes.map(Formatting.minutes).joined(separator: ", "))
                LabeledContent("Time zone", value: model.settings.timezone)
                Text("These come from the server's settings, so the phone, the agent and this Mac agree. Change them on the phone or with dayhand.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}

struct NotificationStatus: View {
    @ObservedObject var scheduler: NotificationScheduler

    var body: some View {
        HStack {
            switch scheduler.authorization {
            case .authorized, .provisional:
                Label("Reminders and the morning summary are on.", systemImage: "bell")
            case .denied:
                Label("Notifications are off for Dayhand.", systemImage: "bell.slash")
                Spacer()
                Button("Open System Settings") {
                    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension")!)
                }
            default:
                Label("Dayhand has not asked yet.", systemImage: "bell.badge")
                Spacer()
                Button("Allow Notifications") { Task { await scheduler.requestAuthorization() } }
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
                Section("Server") {
                    LabeledContent("Address", value: credential.serverUrl)
                    LabeledContent("This Mac", value: credential.deviceName)
                    LabeledContent("Status", value: Formatting.status(model.status, pending: model.pending, useOffline: false) ?? "Connected")
                    LabeledContent("Changes waiting", value: "\(model.pending)")
                    HStack {
                        Button("Sync Now") { model.syncNow() }
                        Spacer()
                        Button("Disconnect…", role: .destructive) { confirmDisconnect = true }
                    }
                }
            } else {
                Section("Server") {
                    Text(Formatting.status(model.status, pending: model.pending, useOffline: model.useOffline) ?? "No server connected.")
                    LabeledContent("Changes waiting", value: "\(model.pending)")
                    Button("Connect to Server…") {
                        model.showConnect = true
                        model.showMainWindow()
                    }
                }
            }
        }
        .formStyle(.grouped)
        .confirmationDialog("Disconnect this Mac?", isPresented: $confirmDisconnect) {
            Button("Disconnect", role: .destructive) { model.disconnect() }
        } message: {
            Text("Dayhand forgets the sign-in on this Mac; your tasks stay here. To end it on the server too, run: dayhand revoke \(model.credential?.deviceId ?? "<deviceId>")")
        }
    }
}

struct AboutSettings: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Dayhand").font(.title2).bold()
            Text("Version \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "development")")
                .foregroundStyle(.secondary)
            Text("Your day plan, offline first. Licensed under the Apache License 2.0.")
            Text("Built with GRDB.swift (MIT), KeyboardShortcuts (MIT) and Sparkle (MIT).")
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
