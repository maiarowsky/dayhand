# Changelog: dayhand

Versions before 0.13.0 are described in the commit history (`git log -- cli`).

## 0.14.0 (2026-10-24)

Needs backend 0.12.0 for the new parts; everything else works with older servers as before.

### Added

- **`dayhand backlog import <dir>`**: a [Backlog.md](https://github.com/MrLesk/Backlog.md) folder
  (Markdown task files with a YAML header) becomes tasks with `import_backlog`: statuses map to
  the nearest of todo, doing and done, criteria, plan, dependencies and the final summary carry
  over, drafts become proposals, and a folder imported again brings only new files. The files go
  in calls of up to 200, the tasks others depend on first. `--dry-run` shows the report without
  storing anything; `--json` prints it ([backlog-import](../docs/schemas/backlog-import.schema.json)).
  Under an `ask` policy, one approval covers the whole import and its file count; retrying the
  unchanged folder with `--approval` imports every batch and skips previously imported files.
- **`dayhand backlog export [dir]`**: the plan as task files and a `config.yml` with
  `export_backlog` (`--prefix`, `--archived`, `--force`); without a folder, `--json` prints the
  files. The destination must be missing or empty unless `--force` explicitly confirms writing
  into an existing folder and replacing exported files, including `config.yml`. Symlink
  destinations, task directories and files are refused.

### Changed

- **`dayhand prime`** prints the agent brief after Today: whether agents are paused, the agent's
  tool policies, claims in force and those that ran out, approvals waiting and decided, ready
  work, and next steps. `dayhand prime --json` prints `agent_brief`, which has every field of
  `list_today` it printed before plus the new ones
  ([agent-brief](../docs/schemas/agent-brief.schema.json)); with a backend before 0.12.0 it prints
  `list_today` as before.
- The agent rules and the generated skill mention `dayhand prime --json` and the phase guides
  `dayhand://workflow/intake`, `/execution` and `/finalization`.

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
