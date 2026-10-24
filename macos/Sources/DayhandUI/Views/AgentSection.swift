import DayhandCore
import DayhandLocalization
import SwiftUI

/**
 * The details' read-only Agent section: who holds the task's claim and until when, the acceptance
 * criteria with ticks, the plan, the proof of completion, the tasks it waits for and why it is blocked. Agents and
 * `dayhand` set these; the snapshot brings them and the database keeps them offline.
 */
struct AgentSection: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem
    let today: String

    var body: some View {
        if task.hasAgentWork {
            Section(tr("Agent")) {
                if let claim = AgentSectionText.claim(task, now: Clock.nowMs(), today: today, timezone: model.settings.timezone) {
                    Label(claim, systemImage: "person.badge.clock").foregroundStyle(Color.orange)
                }
                if let reason = task.blockedReason {
                    Label(tr("Blocked: \(reason)"), systemImage: "nosign").foregroundStyle(Color.overdue)
                }
                if !task.acceptance.isEmpty { criteria }
                if let plan = task.plan {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(tr("Plan")).font(.subheadline.weight(.semibold))
                        Text(plan).textSelection(.enabled)
                    }
                }
                if !task.dependsOn.isEmpty { waitingFor }
                if let proof = task.proof { ProofView(proof: proof) }
                Text(tr("Agents set these with dayhand or through MCP; this Mac shows them read-only."))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var criteria: some View {
        VStack(alignment: .leading, spacing: 4) {
            let met = task.acceptance.filter(\.met).count
            Text(verbatim: "\(tr("Acceptance criteria")) · \(tr("\(met) of \(task.acceptance.count) met"))")
                .font(.subheadline.weight(.semibold))
            ForEach(task.acceptance) { item in
                Label {
                    Text(item.text)
                } icon: {
                    Image(systemName: item.met ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(item.met ? Color.green : Color.secondary)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(item.met ? tr("Met: \(item.text)") : tr("Not met: \(item.text)"))
            }
        }
    }

    private var waitingFor: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(tr("Waiting for")).font(.subheadline.weight(.semibold))
            ForEach(task.dependsOn, id: \.self) { serverId in
                Text(verbatim: AgentSectionText.dependency(model.tasks.first { $0.serverId == serverId }))
            }
        }
    }
}

/// The proof the last completion was given: a summary, links and checks that passed or failed.
private struct ProofView: View {
    let proof: TaskProof

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(tr("Proof of completion")).font(.subheadline.weight(.semibold))
            if proof.isEmpty { Text(tr("No details given")).foregroundStyle(.secondary) }
            if let summary = proof.summary, !summary.isEmpty { Text(summary).textSelection(.enabled) }
            ForEach(proof.checks, id: \.self) { check in
                HStack(spacing: 4) {
                    Image(systemName: check.passed ? "checkmark.seal" : "xmark.seal")
                        .foregroundStyle(check.passed ? Color.green : Color.overdue)
                        .accessibilityHidden(true)
                    let text = "\(check.name): \(check.passed ? tr("pass") : tr("fail"))"
                    if let url = check.url.flatMap(URL.init(string:)) {
                        Link(text, destination: url)
                    } else {
                        Text(verbatim: text)
                    }
                }
            }
            ForEach(proof.links, id: \.url) { link in
                if let url = URL(string: link.url) { Link(link.title ?? link.url, destination: url) }
            }
        }
    }
}

/// How the Agent section's lines read, in the current language.
enum AgentSectionText {
    /// "Agent claude works on it until Today, 14:30", or when that claim ran out; nil without a claim.
    static func claim(_ task: TaskItem, now: Int64, today: String, timezone: String) -> String? {
        guard let name = task.claimedBy else { return nil }
        guard let expires = task.claimExpiresAt else { return tr("Agent \(name) works on it") }
        let time = HistoryText.time(expires, today: today, timezone: timezone)
        return expires > now ? tr("Agent \(name) works on it until \(time)") : tr("The claim of \(name) ran out: \(time)")
    }

    /// "#12 Send the invoice (done)"; a task the Mac does not have is said so.
    static func dependency(_ task: TaskItem?) -> String {
        guard let task else { return tr("A task not on this Mac") }
        let name = AgentText.taskName(ref: task.ref, title: task.title) ?? task.title
        if task.inTrash { return tr("\(name) (in the trash)") }
        return task.status == .done ? tr("\(name) (done)") : name
    }
}
