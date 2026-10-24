# Changelog: dayhand

Versions before 0.13.0 are described in the commit history (`git log -- cli`).

## 0.14.0 (2026-10-24)

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

### Unchanged

- JSON output, field names, error codes and MCP contracts are unchanged.
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
