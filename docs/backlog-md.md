# Backlog.md import and export

Since backend 0.12.0 (CLI 0.14.0), Dayhand reads and writes the task files of
[Backlog.md](https://github.com/MrLesk/Backlog.md), a Markdown task board for people and AI agents
that keeps each task as one file in a `backlog/` folder of a Git repository. Import brings such a
folder into the plan; export writes the plan as such a folder. Both are one-way copies: there is no
sync, and a change made on one side after the copy stays there.

**The format and its author.** Backlog.md is made by Alex Gavrilescu
([MrLesk](https://github.com/MrLesk)) and released under the
[MIT License](https://github.com/MrLesk/Backlog.md/blob/main/LICENSE) ("Copyright (c) 2025
Backlog.md"). Dayhand implements the file format as the project's public documentation and
sample files describe it; it contains no Backlog.md code and does not depend on Backlog.md being
installed. Backlog.md is a separate project, and its files may change in ways this page does not
know about yet.

## Using it

```sh
dayhand backlog import backlog --dry-run     # what would be created and skipped, nothing stored
dayhand backlog import backlog               # the folder's tasks become Dayhand tasks
dayhand backlog import backlog --json        # the report as JSON (schemas/backlog-import.schema.json)
dayhand backlog export backlog-out           # the plan as task files and a config.yml
dayhand backlog export --json                # the files as JSON, nothing written
```

The same through MCP is `import_backlog` (a change, so it takes `dryRun`, obeys the owner's pause
and tool policies, and counts against the limit of changes) and `export_backlog` (a read); through
the REST API, `POST /api/v1/import/backlog` and `GET /api/v1/export/backlog`
([api.md](api.md)). An agent reads files from wherever it works and sends their text; the server
never reads the agent's disk. A selected directory holding `config.yml` or `backlog.config.yml` is the root.
Otherwise, the CLI walks up only while directory names are reserved: `tasks`, `completed`, `drafts`,
`docs`, `decisions`, `milestones` or `archive`. The first non-reserved directory is the root; the
CLI reads only its config and never searches above it. A non-reserved selected subdirectory is
therefore its own root, not a subset inferred from higher ancestors. Classification belongs to the
top-level folder under the root: selecting `backlog/tasks/docs` keeps it under `tasks/docs/`, and
selecting `backlog/archive/tasks` keeps it under `archive/tasks/`. Select the enclosing reserved
folder to retain this context when task files are grouped in other, non-reserved subdirectories.
Relative file paths ignore `.` and empty segments before classification, so `./drafts/task.md`
and `drafts/task.md` have the same proposal state.

Since backend 0.13.0, MCP and REST also accept an optional `projectId`: in the `import_backlog`
arguments or `POST /api/v1/import/backlog` body, it assigns every new task to that destination
using the [task project selector rules](mcp.md#projects). Tasks imported before are skipped and
stay where they are. `export_backlog` arguments and `GET /api/v1/export/backlog` query parameters
are `prefix`, `includeArchived` and `projectId`; the last selects one project by id or name,
including an archived project, and sets `config.yml`'s `project_name` to its name. Dependencies on
tasks outside the selected project are left out and counted in `notes`. Without `projectId`,
export includes the whole plan and uses `Dayhand export` as the configuration's project name.
A configuration's `project_name` never selects or creates a Dayhand project on import.
CLI selection and project creation are described in [backlog import](cli.md#dayhand-backlog-import)
and [backlog export](cli.md#dayhand-backlog-export). MCP and REST callers create the destination
with the [project tools](mcp.md#projects) or [project routes](api.md#projects) before selecting it.
For example, MCP `export_backlog {"projectId":"Bakery site"}` exports only that project;
REST `GET /api/v1/export/backlog?projectId=Bakery%20site` does the same. On import, send
`{"files":[{"path":"tasks/task-1 - Menu.md","content":"…"}],"projectId":"Bakery site"}` to
`import_backlog` or `POST /api/v1/import/backlog`. `"none"` imports without a project;
selecting an archived destination fails. The result's `tasks` include the stored `projectId`.
See [project tools and permissions](mcp.md#projects) and [client availability](architecture.md#projects).

## The file format

A task file is Markdown with a YAML header between two `---` lines:

```markdown
---
id: TASK-12
title: Renew the domain
status: In Progress
assignee: []
created_date: '2026-10-01 09:00'
updated_date: '2026-10-02 10:30'
labels:
  - ops
dependencies:
  - TASK-3
references:
  - 'https://registrar.example.com/renew'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Before it lapses.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Paid until 2027
- [ ] #2 DNS still resolves
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Pay, then check.
<!-- SECTION:PLAN:END -->
```

The folder says what a file is: `tasks/` holds tasks, `completed/` finished ones, `drafts/` ideas
not on the board yet, `archive/tasks/` and `archive/drafts/` what was taken off it, and `docs/`,
`decisions/` and `milestones/` other records. `config.yml` (or `backlog.config.yml`) lists the
project's statuses in order, `["To Do", "In Progress", "Done"]` unless set.

## Import: what maps to what

| Backlog.md | Dayhand |
|---|---|
| `id` | the task's `source`: `{ kind: "backlog-md", ref: "TASK-12" }`, normalized to uppercase for case-insensitive identity; a file without an id is skipped with a reason |
| `title` | `title` |
| `status` | the nearest status: the project's first status is `todo`, its last is `done`, any between is `doing`. A status the project does not list is read by affirmative whole words (`done`, `completed`, `closed`, … → `done`; `progress`, `review`, … → `doing`). Embedded words and negated labels such as `Incomplete`, `Unfinished` or `Not Started` stay `todo`; all unrecognized labels carry a warning |
| `labels` | `labels` |
| `dependencies` | `dependsOn`: the tasks the same import made, or an earlier one (by source). A dependency found in neither is left out with a warning |
| `references` | web addresses become `links` (up to 20); the rest go to the end of the note under "References:" |
| Description, and text before the first section | `note` |
| Acceptance Criteria and Definition of Done (`- [ ]` / `- [x]`) | `acceptance`, ticked as in the file |
| Implementation Plan | `plan` |
| Final Summary of a finished task | `proof.summary` |
| Implementation Notes and every other section | the end of the note, with its heading |
| `updated_date` (else `created_date`) of a finished task | `completedAt` (a date without a zone is in the user's time zone) |
| a file in `completed/` | a `done` task |
| a file in `drafts/` | a [proposal](agent-work.md#7-the-proposal-inbox): it waits in the owner's inbox |
| a file in `archive/tasks/` | an archived task |

Left out, with the reason in the report: files that are not Markdown, files without a YAML header
or an id or title, documents, decisions, milestones and archived drafts, and a second file with an id
already given in the same import. Header keys Dayhand has no field for (`assignee`, `priority`,
`milestone`, `parent_task_id` and the like) are counted in one warning; `ordinal`, the order on
the board, is ignored.

Decisions:

- **One source, one task.** A file whose source already belongs to a task is skipped, and the
  report names that task. Source lifetime, including merges and trash purging, follows the shared
  [source identity rules](agent-work.md#7-the-proposal-inbox). Import never updates a task from a
  changed file: that would be sync.
- **One import call per invocation, dependencies first.** `dayhand backlog import` sends one import call,
  including its config: at most 200 files, 200 KiB of file JSON (leaving room within the server's
  256 KiB request limit), and 100,000 characters per file. A larger folder fails before anything
  is sent; import it by subdirectories. The CLI forwards collected files unchanged; within the call,
  only the backend orders task creation after prerequisites.
  If importing subdirectories separately, import prerequisites first; a dry run cannot see tasks
  that a different dry run would have made. More than 50 resolved dependencies fails the task
  instead of losing edges.
- **One approval, one call.** Under an `ask` policy, repeat the unchanged call with
  `--approval <id>` after the owner allows it. The approval binds the exact arguments and is used
  once, just like every other approval-gated tool. A lost response does not make a used approval
  reusable; obtain a new approval if needed. Source identity still skips files imported before.
- **No new statuses.** Backlog.md lets a project name its own columns; Dayhand keeps `todo`,
  `doing` and `done` and maps each column to the nearest one.
- **An agent's import follows an agent's rules.** A finished task must satisfy the same
  [completion requirements](agent-work.md#2-acceptance-criteria-plan-and-proof) as `complete_task`;
  a task that fails them is refused, while the rest of the folder is imported.
- **The header is read, not executed.** The reader understands the part of YAML these headers
  use (plain and quoted values, lists, block text) and nothing else: no anchors, tags or nested
  maps.

## Export: what maps to what

| Dayhand | Backlog.md |
|---|---|
| a task from Backlog.md with an id matching `PREFIX-number` (optional dotted subnumbers), where the prefix starts with a letter and contains only letters and digits | its own id; otherwise `<PREFIX>-<number>` (`TASK-12` for #12, `--prefix` changes the prefix), a proposal `DRAFT-<number>`; an id already taken gets the next free number |
| `status` | `To Do`, `In Progress` or `Done`, the statuses of the `config.yml` it writes |
| `labels`, `dependsOn` | `labels`, `dependencies` (dependencies on tasks not exported are left out, and counted) |
| `links` | `references` |
| `note`, then the checklist as `- [ ]` lines | Description |
| `acceptance` | Acceptance Criteria, ticked as in Dayhand |
| `plan` | Implementation Plan |
| resume note and blocked reason | Implementation Notes ("Resume: …", "Blocked: …") |
| `proof` (summary, links, checks) | Final Summary |
| `createdAt`, `updatedAt` | `created_date`, `updated_date`, in the user's time zone |
| a proposal, an archived task, an archived proposal (`--archived`) | a file in `drafts/`, `archive/tasks/`, `archive/drafts/` respectively; archived drafts are skipped on import |

Due dates and times, repeat rules, reminders, the now task and claims are not exported. The
result's `notes` count omitted scheduling fields and tasks with dependencies left out; they do
not count the now task or claims. Tasks in the trash are not exported.
`dayhand backlog export <dir>` requires a missing or empty destination and always writes its
own `config.yml`. `--force` explicitly confirms writing into a non-empty folder and replacing
exported files, including `config.yml`; it does not reconcile another project's configuration
or delete unrelated files. Destination, task-directory and file symlinks are refused, including
dangling file symlinks.

An export imported into another Dayhand account keeps titles, statuses, labels, criteria, plan,
dependencies and link URLs when the flattened fields fit the import limits. Proof links and check
results become text in the final summary, not structured proof fields; the note gains the checklist
and the notes section as text. Export never truncates that text: its `notes` identify
any task whose resulting note exceeds 20,000 characters or finished task's final summary exceeds
4,000 characters, including contributions from checklists, resume notes, blocked reasons, proof
links and checks. It also warns when any serialized task file or the aggregated `config.yml`
exceeds the 100,000-character file limit, preserving the complete content. File names fit a
255-byte UTF-8 component budget including the ID and extension; only the filename slug is
shortened, not the title in the file. The CLI prints warnings with or without a destination folder. The tests
check the round trip and overflow warnings on synthetic data (`backend/tests/backlog.test.ts`).
