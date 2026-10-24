import DayhandLocalization
import DayhandUpdates
import SwiftUI

extension Updater {
    /// What the app's updater is built from; the snapshot tool replaces it before the first use.
    static var make: () -> Updater = { Updater() }
    static let shared = make()
}

/**
 * The corner at the bottom left of the main window (under the sidebar's Today and Trash, where Codex keeps its update button above the
 * profile): a round blue button with a download arrow while a newer version is known, or while the update window is
 * open from Check for Updates. It opens the update window as a popover.
 */
struct UpdateCorner: View {
    @EnvironmentObject private var updater: Updater

    var body: some View {
        if updater.state.hasUpdate || updater.isPresented {
            HStack {
                UpdateButton()
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
    }
}

struct UpdateButton: View {
    @EnvironmentObject private var updater: Updater

    var body: some View {
        Button { updater.showWindow() } label: {
            Image(systemName: "arrow.down.to.line")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(Circle().fill(Color.blue))
        }
        .buttonStyle(.plain)
        .help(UpdateText.buttonHelp(updater.state))
        .accessibilityLabel(UpdateText.buttonHelp(updater.state))
        .popover(isPresented: Binding(get: { updater.isPresented }, set: { if !$0 { updater.dismiss() } }), arrowEdge: .trailing) {
            UpdateWindow()
                .environmentObject(updater)
        }
    }
}

/// The small update window: what was found, the download, the result, and what the user can do next.
struct UpdateWindow: View {
    @EnvironmentObject private var updater: Updater

    var body: some View {
        let state = updater.state
        VStack(alignment: .leading, spacing: 10) {
            Text(UpdateText.title(state, version: updater.version)).font(.headline)
            content(state)
            if let lastInstall = updater.lastInstall, case .notInstalled = lastInstall {
                Label(lastInstall.message, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            buttons(state)
        }
        .padding(16)
        .frame(width: 320, alignment: .leading)
    }

    @ViewBuilder
    private func content(_ state: UpdateState) -> some View {
        switch state.activity {
        case .unavailable(let reason):
            Text(reason.message).fixedSize(horizontal: false, vertical: true)
        case .checking:
            ProgressView().controlSize(.small)
        case .upToDate:
            Text(tr("Version \(updater.version) is the newest.")).foregroundStyle(.secondary)
        case .available:
            if let offer = state.offer {
                Text(tr("You have \(updater.version).")).foregroundStyle(.secondary)
                if let notes = offer.notes {
                    ScrollView {
                        Text(notes)
                            .font(.callout)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                    }
                    .frame(maxHeight: 150)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
        case .downloading:
            if let progress = state.downloadProgress {
                ProgressView(value: progress)
            } else {
                ProgressView().progressViewStyle(.linear)
            }
            Text(UpdateText.downloaded(state)).font(.caption).foregroundStyle(.secondary)
        case .extracting(let progress):
            ProgressView(value: progress ?? 0).progressViewStyle(.linear)
            Text(tr("Checking the download’s signature.")).font(.caption).foregroundStyle(.secondary)
        case .readyToInstall, .installing:
            ProgressView().progressViewStyle(.linear)
            Text(tr("Dayhand will quit and open again in a moment.")).font(.caption).foregroundStyle(.secondary)
        case .failed(let failure):
            Text(failure.message).fixedSize(horizontal: false, vertical: true)
        case .idle:
            Text(tr("Version \(updater.version).")).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func buttons(_ state: UpdateState) -> some View {
        HStack {
            Spacer()
            switch state.activity {
            case .available:
                Button(tr("Later")) { updater.dismiss() }
                Button(tr("Update and Relaunch")) { updater.install() }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
            case .downloading:
                Button(tr("Cancel")) { updater.cancelDownloading() }
            case .failed:
                Button(state.hasUpdate ? tr("Later") : tr("OK")) { updater.dismiss() }
                Button(tr("Try Again")) { state.hasUpdate ? updater.install() : updater.checkForUpdates() }
                    .keyboardShortcut(.defaultAction)
            case .idle:
                Button(tr("Close")) { updater.dismiss() }
                Button(tr("Check for Updates")) { updater.checkForUpdates() }
                    .keyboardShortcut(.defaultAction)
            case .unavailable, .upToDate:
                Button(tr("OK")) { updater.dismiss() }
                    .keyboardShortcut(.defaultAction)
            case .checking, .extracting, .readyToInstall, .installing:
                EmptyView()
            }
        }
    }
}

/// Settings → Updates: the version, the automatic check, the preview channel, Check for Updates, and why a build
/// cannot update when it cannot.
struct UpdateSettings: View {
    @EnvironmentObject private var updater: Updater

    var body: some View {
        Form {
            Section {
                LabeledContent(tr("This version"), value: updater.build.isEmpty ? updater.version : "\(updater.version) (\(updater.build))")
                if case .unavailable(let reason) = updater.state.activity {
                    Label(reason.message, systemImage: "exclamationmark.circle")
                        .fixedSize(horizontal: false, vertical: true)
                    Text(tr("Released builds are signed and can update themselves; a copy built on this Mac cannot."))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Toggle(tr("Check for updates automatically"), isOn: Binding(get: { updater.automaticallyChecks }, set: { updater.automaticallyChecks = $0 }))
                    .disabled(!updater.isAvailable)
                Toggle(tr("Include preview versions"), isOn: Binding(get: { updater.includesPreviews }, set: { updater.includesPreviews = $0 }))
                    .disabled(!updater.isAvailable)
                Text(tr("Previews come before a release and may have rough edges."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack {
                    Text(UpdateText.status(updater.state) ?? lastCheckText)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Button(tr("Check for Updates")) { updater.checkForUpdates() }
                        .disabled(!updater.isAvailable || updater.state.isWorking)
                }
                if let lastInstall = updater.lastInstall {
                    Text(lastInstall.message).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
    }

    private var lastCheckText: String {
        guard let date = updater.lastCheck else { return tr("Not checked yet.") }
        let when = date.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened).locale(Localization.current.locale))
        return tr("Last checked \(when).")
    }
}

/// The update texts, in one place for the button, the window and Settings.
enum UpdateText {
    static func buttonHelp(_ state: UpdateState) -> String {
        guard let offer = state.offer else { return tr("Updates") }
        return tr("Dayhand \(offer.version) is available")
    }

    static func title(_ state: UpdateState, version: String) -> String {
        switch state.activity {
        case .unavailable: return tr("Updates")
        case .idle: return "Dayhand"
        case .checking: return tr("Checking for updates…")
        case .upToDate: return tr("Dayhand is up to date")
        case .available:
            let version = state.offer?.version ?? ""
            return state.offer?.isPreview == true ? tr("Dayhand \(version) (preview) is available") : tr("Dayhand \(version) is available")
        case .downloading: return tr("Downloading Dayhand \(state.offer?.version ?? "")…")
        case .extracting: return tr("Preparing the update…")
        case .readyToInstall, .installing: return tr("Installing Dayhand \(state.offer?.version ?? "")…")
        case .failed: return tr("The update did not finish")
        }
    }

    /// A line for Settings, or nil when there is nothing going on.
    static func status(_ state: UpdateState) -> String? {
        switch state.activity {
        case .unavailable, .idle: return nil
        case .checking: return tr("Checking…")
        case .upToDate: return tr("Dayhand is up to date.")
        case .available: return tr("Dayhand \(state.offer?.version ?? "") is available.")
        case .downloading: return state.downloadProgress.map { progress in tr("Downloading… \(Int(progress * 100))%") } ?? tr("Downloading…")
        case .extracting: return tr("Preparing the update…")
        case .readyToInstall, .installing: return tr("Installing…")
        case .failed(let failure): return failure.message
        }
    }

    /// "4.2 MB of 12 MB", or just what has arrived when the size is unknown.
    static func downloaded(_ state: UpdateState) -> String {
        guard case .downloading(let received, let expected) = state.activity else { return "" }
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        let got = formatter.string(fromByteCount: Int64(clamping: received))
        guard let expected else { return got }
        return tr("\(got) of \(formatter.string(fromByteCount: Int64(clamping: expected)))")
    }
}
