# Changelog: dayhand

Versions before 0.13.0 are described in the commit history (`git log -- cli`).

## 0.15.0 (2026-10-31)

Projects need backend 0.13.0 or later; other features keep their previous minimum versions.

### Added

- `dayhand project` / `project list`, `add`, `edit`, `archive`, `unarchive`, `rm` and `assign`:
  metadata, menu order, label-to-project conversion with `--dry-run`, and explicit destinations
  when deleting a project with tasks. Assigning several tasks requires confirmation.
- `-p, --project` on add, edit, list, board and today; `edit --clear-project`.
- `--project` on imports and Backlog.md import/export. Backlog import creates a missing named
  project only when explicitly requested.
- `--fields project,projectId`, human `+Project` markers and project-name completion.
- `dayhand ui` quick add recognizes `+project` (hyphens may replace spaces); unknown tokens stay
  in the title. The `/` filter accepts an exact `+project` token in any case.

### Changed

- `dayhand ui` footer hints show `x done` instead of the `␣` space symbol; Space still marks a
  task done.

### Fixed

- `dayhand ui`: marking a task done (Space or `x`) keeps the cursor in place instead of following
  the task to the end of the list. In Today it stays among the open tasks (on the previous one
  after the last).
- `dayhand login`: the hidden API key prompt disables terminal echo before showing the prompt,
  so the key is not displayed when pasted immediately.
- The Herdr plugin launcher finds Node.js and `dayhand` with a minimal `PATH`, including fnm's
  default Node version and Homebrew installations.

### Unchanged

- Default `--plain` task columns and default JSON output are unchanged, apart from the backend's
  additive `projectId`. Resolved project names are printed only for humans or explicit `--fields`.
- The global minimum backend stays 0.3.0. Project commands explain their 0.13.0 requirement on
  older servers; `--color` before `project` controls the terminal, while project add/edit's
  `--color` chooses the project token.

## 0.14.0 (2026-10-24)

Needs backend 0.12.0 for Backlog.md and the new agent brief; other features work with older servers as before.

### Added

- **Plan health above Today**: a single red, yellow or green line summarizes overdue and
  blocked tasks, expired claims, pending approvals, proposals and completions without proof,
  using the same counts as `dayhand health`.
- **Agents view (`5`)**: `p` pauses or resumes agents; Enter opens an approval request,
  `1`–`4` chooses an option and a separate Enter confirms it.
  `A` accepts a proposal into the plan; `X` rejects it with a required reason.
- Task details show who claimed the work, acceptance criteria (`[x]` / `[ ]`), the plan,
  proof, dependencies and the blocked reason.
  All new screen text and key help is available in the same eight languages.
- `dayhand help ui` and the in-app help (`?`) include the agent keys.

- **`dayhand backlog import <dir>`**: a [Backlog.md](https://github.com/MrLesk/Backlog.md) folder
  (Markdown task files with a YAML header) becomes tasks with `import_backlog`: statuses map to
  the nearest of todo, doing and done, criteria, plan, dependencies and the final summary carry
  over, drafts become proposals, and a folder imported again brings only new files. The files go
  in one call per invocation; only the backend orders dependencies first: at most 200 files and
  200 KiB of file JSON, otherwise import by subdirectories. Files without an id are skipped. `--dry-run`
  shows the report without storing anything; `--json` prints it
  ([backlog-import](../docs/schemas/backlog-import.schema.json)). Under an `ask` policy, an approval
  binds exactly that call and is consumed once, just like other approval-gated tools.
- **`dayhand backlog export [dir]`**: the plan as task files and a `config.yml` with
  `export_backlog` (`--prefix`, `--archived`, `--force`); without a folder, `--json` prints the
  files. The destination must be missing or empty unless `--force` explicitly confirms writing
  into an existing folder and replacing exported files, including `config.yml`. Symlink
  destinations, task directories and files are refused. Archived proposals go to `archive/drafts/`.
  Export notes warn when flattened fields exceed Dayhand import limits; text is not truncated.

### Changed

- **`dayhand prime`** prints the agent brief after Today: whether agents are paused, the agent's
  tool policies, claims in force and those that ran out, approvals waiting and decided, ready
  work, and next steps. `dayhand prime --json` prints `agent_brief`, which has every field of
  `list_today` it printed before plus the new ones
  ([agent-brief](../docs/schemas/agent-brief.schema.json)); with a backend before 0.12.0 it prints
  `list_today` as before.
- The agent rules and the generated skill mention `dayhand prime --json` and the phase guides
  `dayhand://workflow/intake`, `/execution` and `/finalization`.

### Unchanged

- The terminal UI additions leave JSON output, field names, error codes and MCP contracts unchanged.
  The new screens use the existing backend tools (backend 0.11.0 or later).

## 0.13.0 (2026-10-24)

### Added

- **`dayhand ui` in eight languages**: English (the source and the default), Polish, German,
  Spanish, French, Brazilian Portuguese, Japanese and Simplified Chinese. The views, the keys help
  (`?`), the hints, the edit form, the status and the messages after a change follow each
  language's plural forms; days and months come from the language (`pt., 30 paź`), times stay
  HH:MM.
- The language comes from `--lang <language>`, then `DAYHAND_LANG`, then the locale (`LC_ALL`,
  `LC_MESSAGES`, `LANG`), else English. Any Portuguese is Brazilian Portuguese; Traditional Chinese
  and `C`/`POSIX` fall back to English.

### Unchanged

- Everything else the CLI prints stays English, and so does every contract agents and scripts read:
  `--json`, field names, error codes, exit codes and the MCP tools. `dayhand help ui` and the
  generated pages keep the English key map.
- Date phrases (`fri 2pm`, `tomorrow`, `none`) are English in every language; the hints say so.
