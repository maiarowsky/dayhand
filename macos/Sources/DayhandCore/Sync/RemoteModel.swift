import Foundation

/// A task as the app layer returns it (`toTask` in `backend/convex/lib/core.ts`).
public struct RemoteTask: Hashable, Sendable {
    public var id: String
    public var clientId: String?
    public var title: String
    public var note: String?
    public var dueDate: String?
    public var dueTime: String?
    public var status: String
    public var isNow: Bool
    public var resumeNote: String?
    public var completedAt: Int64?
    public var archivedAt: Int64?
    public var createdAt: Int64
    public var updatedAt: Int64
    public var `repeat`: RepeatRule?
    public var labels: [String]
    public var links: [TaskLink]
    public var deletedAt: Int64?
    public var checklist: [ChecklistItem]
    /// Nil: the default reminders from the settings.
    public var reminders: [TaskReminder]?
    public var ref: Int?
    /// Agent work, as `TaskItem` holds it; the claim holder only by name.
    public var acceptance: [AcceptanceItem]
    public var plan: String?
    public var proof: TaskProof?
    public var dependsOn: [String]
    public var blockedReason: String?
    public var claimedBy: String?
    public var claimExpiresAt: Int64?
    /// The server id of the task's project (backend 0.13.0); nil = no project, or a server without projects.
    public var projectId: String?

    public init(
        id: String, clientId: String? = nil, title: String, note: String? = nil, dueDate: String? = nil,
        dueTime: String? = nil, status: String = "todo", isNow: Bool = false, resumeNote: String? = nil,
        completedAt: Int64? = nil, archivedAt: Int64? = nil, createdAt: Int64, updatedAt: Int64,
        repeat: RepeatRule? = nil, labels: [String] = [], links: [TaskLink] = [], deletedAt: Int64? = nil,
        checklist: [ChecklistItem] = [], reminders: [TaskReminder]? = nil, ref: Int? = nil,
        acceptance: [AcceptanceItem] = [], plan: String? = nil, proof: TaskProof? = nil, dependsOn: [String] = [],
        blockedReason: String? = nil, claimedBy: String? = nil, claimExpiresAt: Int64? = nil, projectId: String? = nil
    ) {
        self.id = id
        self.clientId = clientId
        self.title = title
        self.note = note
        self.dueDate = dueDate
        self.dueTime = dueTime
        self.status = status
        self.isNow = isNow
        self.resumeNote = resumeNote
        self.completedAt = completedAt
        self.archivedAt = archivedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.repeat = `repeat`
        self.labels = labels
        self.links = links
        self.deletedAt = deletedAt
        self.checklist = checklist
        self.reminders = reminders
        self.ref = ref
        self.acceptance = acceptance
        self.plan = plan
        self.proof = proof
        self.dependsOn = dependsOn
        self.blockedReason = blockedReason
        self.claimedBy = claimedBy
        self.claimExpiresAt = claimExpiresAt
        self.projectId = projectId
    }
}

/**
 * Every task (the trash included), the settings and the projects, as one poll of the server sees them. [projects] is
 * nil for a server without projects (backend 0.12.x and earlier), and every project there is, archived ones
 * included, for one with them.
 */
public struct Snapshot: Hashable, Sendable {
    public var tasks: [RemoteTask]
    public var settings: ReminderSettings
    public var projects: [RemoteProject]?

    public init(tasks: [RemoteTask], settings: ReminderSettings = ReminderSettings(), projects: [RemoteProject]? = nil) {
        self.tasks = tasks
        self.settings = settings
        self.projects = projects
    }
}

public enum SendResult: Hashable, Sendable {
    /// The server applied the mutation (or had already applied it: same `clientId`).
    case applied(JSONValue)
    /// The server's function refused it for good (bad argument, task gone); resending cannot help.
    case rejected(String)
    /// The token is missing, wrong or expired; keep the change until the user fixes it.
    case unauthorized
    /// No answer or a transient server problem; try again later.
    case failed(String)
}

/// Parsing of the app layer's JSON. Convex sends `v.number()` fields as JSON doubles.
public enum RemoteJSON {
    public static let queryTasks = "app:listAll"
    public static let querySettings = "app:getSettings"
    public static let queryTrash = "app:listTrash"
    public static let queryTask = "app:getTask"
    public static let queryPlanHealth = "app:planHealth"
    public static let queryApprovals = "app:listApprovals"
    public static let queryProposals = "app:listProposals"
    /// Since backend 0.13.0: every project, archived ones included, without counts.
    public static let queryProjects = "app:listProjects"

    /// Arguments of [queryTasks]: everything except the trash, done and archived included.
    public static let tasksArgs: JSONValue = ["includeArchived": true, "includeDone": true]

    public static func tasks(_ value: JSONValue) -> [RemoteTask] {
        (value.array ?? []).compactMap(task)
    }

    /**
     * A snapshot from the results of [queryTasks], [queryTrash] and [querySettings]; missing settings take the
     * backend defaults. A task is in only one of the two lists.
     */
    public static func snapshot(tasks active: JSONValue, trash: JSONValue, settings: JSONValue, projects: JSONValue? = nil) -> Snapshot {
        Snapshot(tasks: tasks(active) + tasks(trash), settings: Self.settings(settings), projects: projects.map(Self.projects))
    }

    public static func projects(_ value: JSONValue) -> [RemoteProject] {
        (value.array ?? []).compactMap(project)
    }

    public static func project(_ o: JSONValue) -> RemoteProject? {
        guard let id = o["id"]?.string, let name = o["name"]?.string else { return nil }
        return RemoteProject(
            id: id,
            clientId: o["clientId"]?.string,
            name: name,
            color: o["color"]?.string.flatMap(ProjectColor.init(rawValue:)),
            icon: o["icon"]?.string,
            note: o["note"]?.string,
            position: o["position"]?.double ?? 0,
            archivedAt: o["archivedAt"]?.int64,
            createdAt: o["createdAt"]?.int64 ?? 0,
            updatedAt: o["updatedAt"]?.int64 ?? 0
        )
    }

    /**
     * The server does not have the function at all: Convex answers a call to a function it does not know with an
     * error of the function ("Could not find public function for 'app:listProjects'"), so an app layer older than
     * the call (projects need backend 0.13.0) is told apart from a refused call by the message.
     */
    public static func isMissingFunction(_ message: String) -> Bool {
        message.contains("Could not find public function")
    }

    /// A server without projects refused a task change for its `projectId` argument (Convex's argument validator).
    public static func refusesProjectField(_ message: String) -> Bool {
        message.contains("extra field `projectId`")
    }

    /// Why a project change was not sent: the server has no projects (what `isMissingFunction` also reads as such).
    public static let noProjectsReason = "Could not find public function: the server has no projects"

    /**
     * The server refused a task change for its project: archived meanwhile ("Project \"Web\" is archived; restore it
     * first") or gone ("Project \"Web\" not found"), as `projectTarget` in `convex/lib/projectOps.ts` words it.
     */
    public static func refusesProject(_ message: String) -> Bool {
        message.contains("is archived; restore it first") || (message.contains("Project \"") && message.contains("\" not found"))
    }

    /// `addProject` was refused because a project that is not archived has the name (`checkNameFree`).
    public static func nameTakenByActiveProject(_ message: String) -> Bool {
        message.contains("already exists") && !message.contains("already exists (archived)")
    }

    public static func settings(_ value: JSONValue) -> ReminderSettings {
        let timezone = value["timezone"]?.string.flatMap { HelmDates.isTimezone($0) ? $0 : nil }
        return ReminderSettings(
            timezone: timezone ?? HelmDates.defaultTimezone,
            summaryTime: value["summaryTime"]?.string ?? ReminderRules.defaultSummaryTime,
            reminderMinutes: value["defaultReminderMinutes"]?.array?.compactMap(\.int) ?? ReminderRules.defaultReminderMinutes
        )
    }

    public static func task(_ o: JSONValue) -> RemoteTask? {
        guard let id = o["id"]?.string else { return nil }
        return RemoteTask(
            id: id,
            clientId: o["clientId"]?.string,
            title: o["title"]?.string ?? "",
            note: o["note"]?.string,
            dueDate: o["dueDate"]?.string,
            dueTime: o["dueTime"]?.string,
            status: o["status"]?.string ?? "todo",
            isNow: o["isNow"]?.bool ?? false,
            resumeNote: o["resumeNote"]?.string,
            completedAt: o["completedAt"]?.int64,
            archivedAt: o["archivedAt"]?.int64,
            createdAt: o["createdAt"]?.int64 ?? 0,
            updatedAt: o["updatedAt"]?.int64 ?? 0,
            repeat: RepeatRule.parse(o["repeat"]),
            labels: o["labels"]?.array?.compactMap(\.string) ?? [],
            links: o["links"]?.array?.compactMap(TaskLink.parse) ?? [],
            deletedAt: o["deletedAt"]?.int64,
            checklist: o["checklist"]?.array?.compactMap(ChecklistItem.parse) ?? [],
            reminders: o["reminders"]?.array?.compactMap(TaskReminder.parse),
            ref: o["ref"]?.int,
            acceptance: o["acceptance"]?.array?.compactMap(AcceptanceItem.parse) ?? [],
            plan: o["plan"]?.string,
            proof: TaskProof.parse(o["proof"]),
            dependsOn: o["dependsOn"]?.array?.compactMap(\.string) ?? [],
            blockedReason: o["blockedReason"]?.string,
            claimedBy: o["claimedBy"]?["name"]?.string,
            claimExpiresAt: o["claimExpiresAt"]?.int64,
            projectId: o["projectId"]?.string
        )
    }

    /// The change history of task [serverId] from [queryTask] (`{task, history}`, oldest first), newest first; of two
    /// changes in the same millisecond the later one comes first.
    public static func history(_ value: JSONValue, serverId: String) -> [TaskEvent] {
        (value["history"]?.array ?? [])
            .reversed()
            .compactMap { e -> TaskEvent? in
                guard e.object != nil else { return nil }
                return TaskEvent(
                    taskServerId: serverId,
                    at: e["at"]?.int64 ?? 0,
                    actor: e["actor"]?.string ?? "app",
                    actorName: e["actorName"]?.string,
                    action: e["action"]?.string ?? "update",
                    beforeJson: e["before"].flatMap { $0.object == nil ? nil : $0.encoded() },
                    afterJson: e["after"].flatMap { $0.object == nil ? nil : $0.encoded() }
                )
            }
            .enumerated()
            .sorted { $0.element.at != $1.element.at ? $0.element.at > $1.element.at : $0.offset < $1.offset }
            .map(\.element)
    }

    /// The `{code}` a ConvexError carries in its data, e.g. `unauthenticated`.
    public static func errorCode(_ data: JSONValue?) -> String? { data?["code"]?.string }
}
