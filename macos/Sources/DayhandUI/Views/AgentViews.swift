import DayhandCore
import DayhandLocalization
import SwiftUI

/// The plan health card above Today: one sentence in the report's colour, the most pressing first, with Review when
/// approval requests or proposals wait for the owner (the Android app's `HealthCard`). It shows the last report the
/// server sent, also offline, and goes with Disconnect.
struct HealthCard: View {
    @EnvironmentObject private var model: AppModel
    @State private var showInbox = false

    var body: some View {
        if let health = model.health {
            let items = HealthSummary.items(health)
            let color = AgentText.color(HealthSummary.tone(items), clear: items.isEmpty)
            HStack(spacing: 8) {
                Image(systemName: items.isEmpty ? "checkmark.circle" : "waveform.path.ecg")
                    .foregroundStyle(color)
                    .accessibilityHidden(true)
                // Wraps without fixedSize, as the status line (StatusLine).
                Text(AgentText.healthLine(items)).font(.callout)
                Spacer(minLength: 0)
                if HealthSummary.needsOwner(items) {
                    Button(tr("Review")) { showInbox = true }
                        .help(tr("The approval requests and proposals waiting for you, read-only"))
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 4)
            .sheet(isPresented: $showInbox) {
                AgentInboxView().environmentObject(model)
            }
        }
    }
}

/// The approval requests and proposals waiting for the owner, read from the server when the sheet opens. The Mac
/// only lists them; deciding stays on the phone and with `dayhand`.
struct AgentInboxView: View {
    enum Load: Equatable {
        case loading
        case loaded(AgentInbox)
        case failed(String)
    }

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var load: Load
    private let reads: Bool
    /// In the main window's Inbox, under its title, rather than in a sheet of its own.
    private let embedded: Bool

    /// [preview] shows a fixed state without asking the server (the snapshot tool).
    init(preview: Load? = nil, embedded: Bool = false) {
        _load = State(initialValue: preview ?? .loading)
        reads = preview == nil
        self.embedded = embedded
    }

    var body: some View {
        if embedded {
            VStack(spacing: 0) {
                content.frame(maxWidth: .infinity, maxHeight: .infinity)
                if reads {
                    HStack {
                        Spacer()
                        Button(tr("Try Again")) { Task { await read() } }.disabled(load == .loading)
                    }
                    .padding(.horizontal, Metrics.gutter)
                    .padding(.bottom, 12)
                }
            }
            .task { if reads { await read() } }
        } else {
            sheet
        }
    }

    private var sheet: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text(tr("Requests and proposals")).font(.title3).bold()
                Text(tr("Read-only on this Mac. Decide on the phone, or with dayhand approvals and dayhand proposals."))
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            .padding(16)
            Divider()
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            HStack {
                if reads {
                    Button(tr("Try Again")) { Task { await read() } }
                        .disabled(load == .loading)
                }
                Spacer()
                Button(tr("Close")) { dismiss() }.keyboardShortcut(.defaultAction)
            }
            .padding(12)
        }
        .frame(width: 480, height: 460)
        .task { if reads { await read() } }
    }

    @ViewBuilder private var content: some View {
        switch load {
        case .loading:
            ProgressView().controlSize(.small)
        case .failed(let message):
            Text(message).foregroundStyle(.secondary).padding(16).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        case .loaded(let inbox):
            List {
                Section(AgentText.approvalsHeading(shown: inbox.approvals.count, pending: model.health?.pendingApprovals ?? 0)) {
                    if inbox.approvals.isEmpty { Text(tr("No approval requests are waiting.")).foregroundStyle(.secondary) }
                    ForEach(inbox.approvals) { ApprovalRow(request: $0, today: model.today, timezone: model.settings.timezone) }
                }
                Section(tr("Proposals (\(inbox.proposals.count))")) {
                    if inbox.proposals.isEmpty { Text(tr("No proposals are waiting.")).foregroundStyle(.secondary) }
                    ForEach(inbox.proposals) { ProposalRow(proposal: $0, today: model.today) }
                }
            }
        }
    }

    private func read() async {
        load = .loading
        let result = await model.loadInbox()
        guard !Task.isCancelled else { return }
        switch result {
        case .success(let inbox): load = .loaded(inbox)
        case .failure(let error): load = .failed(AgentText.inboxError(error))
        }
    }
}

private struct ApprovalRow: View {
    let request: ApprovalRequest
    let today: String
    let timezone: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(request.action).font(.body.weight(.semibold))
            if let task = AgentText.taskName(ref: request.taskRef, title: request.taskTitle) {
                Text(verbatim: task).font(.callout)
            }
            if let detail = request.detail { Text(detail).font(.callout).foregroundStyle(.secondary) }
            if !request.options.isEmpty {
                Text(tr("Options: \(request.options.joined(separator: DateText.listSeparator))")).font(.caption)
            }
            Text(AgentText.asked(request, today: today, timezone: timezone)).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

private struct ProposalRow: View {
    let proposal: Proposal
    let today: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: AgentText.taskName(ref: proposal.ref, title: proposal.title) ?? proposal.title)
            let task = TaskItem(localId: proposal.id, title: proposal.title, dueDate: proposal.dueDate, dueTime: proposal.dueTime, createdAt: 0, updatedAt: 0)
            let details = [Formatting.due(task, today: today), proposal.requestedBy.map { tr("From \($0)") }].compactMap { $0 }
            if !details.isEmpty {
                Text(verbatim: details.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// How the agent texts read, in the current language.
enum AgentText {
    /// "Plan: 2 overdue · 1 approval request", or that nothing needs a look.
    static func healthLine(_ items: [HealthItem]) -> String {
        if items.isEmpty { return tr("Plan: nothing needs a look.") }
        return tr("Plan: \(items.map(item).joined(separator: " · "))")
    }

    static func item(_ item: HealthItem) -> String {
        let n = item.count
        switch item.kind {
        case .paused: return tr("agents paused")
        case .overdue: return tr("\(n) overdue")
        case .expiredClaims: return tr("\(n) claims ran out")
        case .approvals: return tr("\(n) approval requests")
        case .blocked: return tr("\(n) blocked")
        case .proposals: return tr("\(n) proposals")
        case .withoutProof: return tr("\(n) done without proof")
        case .dueToday: return tr("\(n) due today")
        case .inProgress: return tr("\(n) in progress")
        case .doneToday: return tr("\(n) done today")
        case .oldestOpen: return tr("oldest open task \(n) days old")
        }
    }

    /// Red when something is late or agents are paused, orange when the owner is asked, green when all is clear.
    static func color(_ tone: HealthTone, clear: Bool) -> Color {
        switch tone {
        case .act: return .red
        case .look: return .orange
        case .calm: return clear ? .green : .accentColor
        }
    }

    /// "#12 Send the invoice": the number is the same in every language.
    static func taskName(ref: Int?, title: String?) -> String? {
        guard let title else { return nil }
        return ref.map { "#\($0) \(title)" } ?? title
    }

    /// "Asked by claude · expires Today, 14:30".
    static func asked(_ request: ApprovalRequest, today: String, timezone: String) -> String {
        let by = tr("Asked by \(request.requestedBy)")
        guard let expires = request.expiresAt else { return by }
        return "\(by) · " + tr("expires \(HistoryText.time(expires, today: today, timezone: timezone))")
    }

    static func approvalsHeading(shown: Int, pending: Int) -> String {
        pending > shown ? tr("Approval requests (newest \(shown))") : tr("Approval requests (\(shown))")
    }

    static func inboxError(_ error: AgentInbox.LoadError) -> String {
        switch error {
        case .noServer: return tr("Connect to a server to see the requests and proposals.")
        case .unauthorized: return tr("The server signed this Mac out. Connect again with a new code; your tasks stay here.")
        case .failed(let reason): return tr("They could not be read: \(reason)")
        }
    }
}
