# Changelog: Dayhand for Android

Versions before 0.8.4 are described in the commit history (`git log -- android`). The app was
called Helm until 0.9.0.

## 0.13.3 (unreleased)

### Changed

- The note is edited on a whole screen instead of a narrow dialog: the text runs across the phone's width in
  the reading font and size the details show it in (on a 360 dp phone the field is 328 dp wide, was 272 dp,
  and a long note in the monospaced app font takes 19 lines instead of 33). **Cancel** and **Save** stay on top
  above the keyboard, where the dialog's buttons were hidden behind it; Back still cancels.
- Task details are more compact: the status has no separate heading, the proof of completion is a short line
  under it instead of its own card further down, the due day, **Add a time** and a cross for no due day share
  one row, and the project is one row. From the status to the project the card is a third lower on a 360 dp
  phone (213 dp, was 319 dp), so the start of the note is on the first screen. The note has a small gap
  between paragraphs and folds after about eight lines with **Show the whole note**. Cards and sections sit
  closer together.

## 0.13.2 (unreleased)

### Fixed

- The project picker on an account without projects showed only **No project** and a plain
  **New project** text, which read as if an existing task could not be put into a project. It now
  says there are no projects yet, and **New project** is a full button; the project made there is
  assigned to the task at once (task details, quick add and the task menus share the picker).
- **Projects** mixed labels into the list under "Labels and projects", so labels looked like
  projects. The tab now lists only projects, with a sentence and **New project** when there are
  none; labels moved to **⋮ → Labels** (filtering by a label and making a project from it work as
  before). The details section is called **Labels**.

### Changed

- Task details are easier to read on a phone: a two-line title with **Show the whole title**, one
  card with status, due day, project and the task's labels (when it has any) at the top, the note
  under it, and folded sections for repeat and reminders, an empty checklist, labels when there
  are none, links and history. Field names are
  smaller and muted, values larger; values and notes use the phone's sans-serif when the app font
  is monospaced. The chosen status is filled with the accent, and actions (pick a day, add a label,
  move to the trash) are filled pills with an icon whose text keeps 4.5:1 in all sixteen palettes.

## 0.13.1 (unreleased)

### Removed

- The Threads view (the label `wątek` is a normal label again).

## 0.12.0 (unreleased)

### Added

- A fourth bottom-bar tab, **Projects**: projects and labels with open/overdue counts, No project,
  an archive and Trash. Projects have a unique name, one of twelve colours, an optional emoji
  and a note; edit, reorder (drag or accessible up/down controls), archive and delete with a task
  destination. Labels can become projects on request, without moving already assigned tasks.
- Each project has **List / Board**, and its add button preselects the project. One searchable
  picker serves quick add, task details, Today and Board menus and the calendar day sheet.
  `+Project-name` in quick add recognizes existing active projects; unknown tokens stay text.
- Project dots on Today and Board, contrast-tested across all sixteen palettes. All project
  strings are in the eight app languages; the sample plan now has projects instead of project-like labels.
- Room schema 6 with AutoMigration(5,6), project snapshots and server-confirmed task project ids.
  Project management is online-only: create/edit, archive, delete/move, order and label conversion
  execute on the server; without a connection (also unpaired) a translated message explains why.
  Only task/settings edits enter the append-only outbox, including offline assignments to confirmed
  projects. A refused assignment keeps the task and later edits and removes only that assignment
  and its dependent repeat proof; a refused move leaves the task in its previous server project.
  There is no name-conflict linking or automatic project reopening.
- Repeating tasks made on the phone inherit their project; backend 0.13.2 confirms their parent
  completion so an archived project stays archived. A local occurrence whose proof the server
  refuses is sent as an ordinary task (an older backend keeps it queued), never losing its row and
  edits. **Deploy backend 0.13.2 before Android 0.12.0.** Backup files
  read tasks/projects in one transaction; restore preflights combined project capacity and needs
  a connection for project management. Restoring never reopens an archived project: tasks of a
  project archived on the server or in the file are restored without a project. Switching servers
  also detects and clears project-only plans.
- Project markers retain both dot and optional emoji, including Today’s Done rows. Labels and
  No project offer List only. Cross-project dependencies stay visible in project scopes; ordering
  handles tied/exhausted positions, and hiding project search clears its filter.
- JVM/Robolectric coverage for the real Room migration, Compose screens/pickers and task-assignment
  outbox; opt-in real-local-backend integration tests, shared quick-add project cases and
  `scripts/e2e-projects.py` for one emulator run with light/dark screenshots.

## 0.11.0 (unreleased)

### Added

- Date phrases in quick add, as on the Mac, on Linux and in `dayhand ui`: a phrase at the end of
  the title sets the day and time, so "Call the accountant fri 2pm" is "Call the accountant" on
  the coming Friday at 14:00. The grammar of `dayhand` (English phrases such as `tomorrow 9am`,
  `next mon`, `in 3 days`, `23 oct`), read in the server's time zone, or the phone's on this phone
  only. A grey line under the title says what was understood ("Friday 23 Oct, 14:00 · from
  “fri 2pm”", or "No date phrase: today"), **Keep in title** keeps the words as text, and a day or
  time picked under "More options" wins over the phrase. Quick add on the board reads them too.
- `WhenParserTest` runs every case of `linux/tests/cases/when.json`, the phrases shared with the
  CLI, macOS and Linux; `QuickAddPhraseTest` types a phrase and checks the row in Today.
- Task details have an **Agent** card (backend 0.10.0): "agent: \<name\> works until \<time\>"
  while a claim lasts, the blocked reason in red ("Blocked: the client has not answered"), the
  tasks it waits for, each with its number and how far it is ("#12 Send the invoice (done)"), and
  the plan, all read-only as an agent or `dayhand edit` set them.
- **End the claim** under a live claim takes the task over from the agent after a confirmation:
  the claim ends on the phone at once and `app:release` goes through the outbox, offline too. The
  history calls it "Claim ended".
- Blocked marks on Today and the board, with reasons for screen readers; the rules and phone-only
  dependency lookup limits are in [Screens](README.md#screens).
- Room version 5 keeps the task's number, plan, dependencies and blocked reason (auto-migration 4
  to 5, with `MigrationTest`; the next snapshot fills them in).
- Tool policies can be edited in Settings → Agents; choices, server responses and retry behaviour
  are described in [Screens](README.md#screens).
- `AgentsScreenTest` opens a rule, checks the three choices and sends another one;
  `AgentsViewModelTest` and `AgentControlTest` check what goes to `app:setToolPolicy` and the
  words for each refusal; `scripts/e2e-tool-policy.py` sets a rule on the phone and reads it back
  with `dayhand policy` on a local backend.

### Fixed

- Fixed stale rule and pause states in Settings → Agents after overlapping refreshes. See
  [Screens](README.md#screens) for the controls and [Tests](README.md#tests) for regression coverage.

## 0.10.1 (2026-10-24)

### Added

- Eight languages: English (the source and the default), Polski, Deutsch, Español, Français,
  Português (Brasil), 日本語 and 简体中文. Settings → Language offers the phone's language or any
  of the eight, each in its own name; Android 13+ also lists them under the system's App
  languages. Older phones follow the phone's language, as before. The new translations were
  written by a language model and wait for review by native speakers.
- Lint fails on missing or extra translations, plural forms and format mismatches;
  `TranslationsTest` checks keys, placeholders, plural forms and untranslated names in every
  language, and `LanguageSwitchTest` switches the running app's language from Settings.

### Changed

- Dates follow the language: the order, words and punctuation of "Mon, Oct 19", "Mo., 19. Okt.",
  "10月19日(月)", and the week's range in the calendar header.
- Counted messages (changes waiting, more tasks in a day, the trash's days, the label and
  reminder limits) use the plural forms of each language.

## 0.10.0 (2026-10-24)

### Added

- **Settings → Agents** (with a server, backend 0.11.0 or later): **Pause agents**, one switch
  that refuses every agent's changes while reading still works; the approval requests waiting
  for a decision, each on its own page with its options and their consequences, whether it can be
  undone and the time to decide by, decided with an optional word for the agent; the proposal
  inbox, where a proposal is accepted, merged into an open task or rejected with a reason; and the
  tool policies set with `dayhand policy set`, read-only.
- A **plan health** card above Today: overdue, claims that ran out, approval requests, blocked
  tasks, proposals, done without proof and more in one line, with **Review** to open Agents.
- Notifications for new approval requests while Dayhand is closed, checked every 15 minutes
  (WorkManager); a tap opens Agents.

## 0.9.1 (2026-10-24)

### Added

- Task details show, read-only, who works on a task and until when, its acceptance criteria and
  the proof it was completed with (backend 0.10.0).

## 0.9.0 (2026-10-24)

### Changed

- Helm is now **Dayhand**: the app's name and its texts in English and Polish, and the names of
  the backup file (`dayhand-backup-<date>.json`) and the exported plan (`dayhand-plan-<date>.md`
  and so on). The app id `io.github.maiarowsky.dayhand`, the plan on the phone, the sign-in and
  the settings stay as they were, so the update installs over 0.8.4.
- Pairing links are `dayhand://pair`; `helm://pair` links from older servers still open the app.
- The build reads `-Pdayhand.serverUrl` and `DAYHAND_RELEASE_*`; `helm.serverUrl` and
  `HELM_RELEASE_*` still work, with a warning in the build output.

## 0.8.4 (2026-10-23)

### Added

- **On this phone only**: Helm works without an account or a server, and the first start offers
  it first, next to **Connect to my server**. Settings → Server says whether the phone works on
  its own or is connected, and how to connect a server of your own later.
- **Try with sample data** at the first start: a sample plan for Today, the calendar and the
  board, in the app's language, which stays on the phone and goes with one tap.
- **Backup** in Settings → Data: save the plan on this phone to a file, share it or restore one,
  in Helm's JSON export format, which a Helm server imports too (`hlm import`).
- Without a server the phone adds a repeating task's next occurrence when it is completed.
- **Use this phone's time zone** in Settings → Server when the server's differs.

### Changed

- Without a server "today" and the reminders follow the phone's time zone, not Europe/London.
- No warning line on Today when no server is connected.
- A pairing code for another server than the one whose plan is on the phone asks before it
  replaces the plan; the old server's tasks and waiting changes never reach the new one.
- Export (from the server), the calendar address and agent connections are shown only with a
  server.

### Removed

- The offline test mode switch; on this phone only and airplane mode cover what it did.
