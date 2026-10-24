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
([api.md](api.md)). An agent reads files from wherever it works and sends their text; Dayhand never
reads a disk itself.

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
| `id` | the task's `source`: `{ kind: "backlog-md", ref: "TASK-12" }`; a file without an id is known by its path |
| `title` | `title` |
| `status` | the nearest status: the project's first status is `todo`, its last is `done`, any between is `doing`. A status the project does not list is read by its words (`done`, `closed`, … → `done`; `progress`, `review`, … → `doing`; else `todo`) with a warning |
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
or a title, documents, decisions, milestones and archived drafts, and a second file with an id
already given in the same import. Header keys Dayhand has no field for (`assignee`, `priority`,
`milestone`, `parent_task_id` and the like) are counted in one warning; `ordinal`, the order on
the board, is ignored.

Decisions:

- **One source, one task.** The source is the same field any integration uses
  ([agent-work.md](agent-work.md#7-the-proposal-inbox)), so importing a folder again skips every
  file imported before, also one whose task was rejected or merged since; the report names the task
  each such file made. It never updates a task from a changed file: that would be sync.
- **Dependencies first.** Within one call, a task is created after the tasks it waits for, so
  `dependsOn` can point at them. A larger folder goes in several calls (at most 200 files and
  256 KiB each); `dayhand backlog import` orders the files the same way across calls, and an agent
  calling the tool should too. A dry run cannot see tasks that an earlier call of the same import
  would have made.
- **No new statuses.** Backlog.md lets a project name its own columns; Dayhand keeps `todo`,
  `doing` and `done` and maps each column to the nearest one.
- **An agent's import follows an agent's rules.** A finished task with criteria not all met, or
  without a final summary, is refused for an agent as `complete_task` would refuse it; the rest
  of the folder is imported.
- **The header is read, not executed.** The reader understands the part of YAML these headers
  use (plain and quoted values, lists, block text) and nothing else: no anchors, tags or nested
  maps.

## Export: what maps to what

| Dayhand | Backlog.md |
|---|---|
| a task from Backlog.md | its own id; any other task `<PREFIX>-<number>` (`TASK-12` for #12, `--prefix` changes the prefix), a proposal `DRAFT-<number>`; an id already taken gets the next free number |
| `status` | `To Do`, `In Progress` or `Done`, the statuses of the `config.yml` it writes |
| `labels`, `dependsOn` | `labels`, `dependencies` (dependencies on tasks not exported are left out, and counted) |
| `links` | `references` |
| `note`, then the checklist as `- [ ]` lines | Description |
| `acceptance` | Acceptance Criteria, ticked as in Dayhand |
| `plan` | Implementation Plan |
| resume note and blocked reason | Implementation Notes ("Resume: …", "Blocked: …") |
| `proof` (summary, links, checks) | Final Summary |
| `createdAt`, `updatedAt` | `created_date`, `updated_date`, in the user's time zone |
| a proposal, an archived task (`--archived`) | a file in `drafts/`, in `archive/tasks/` |

Due dates and times, repeat rules, reminders, the now task and claims have no place in the format;
the result's `notes` count what was left out. Tasks in the trash are not exported.
`dayhand backlog export <dir>` writes `config.yml` only when the folder has none (or with
`--force`), and refuses to overwrite a task file without `--force`.

An export imported into another Dayhand account keeps titles, statuses, labels, criteria, plan,
dependencies, links and proof; the note gains the checklist and the notes section as text. The
tests check that round trip on synthetic data (`backend/tests/backlog.test.ts`).
