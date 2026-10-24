# Changelog: dayhand

Versions before 0.13.0 are described in the commit history (`git log -- cli`).

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
