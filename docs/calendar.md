# Calendar feed and .ics export

Helm can show your dated tasks in Google Calendar, Apple Calendar or any other calendar app
that subscribes to a calendar by URL. The feed is **read-only**: the calendar shows the plan,
and changes are made in Helm (the app, `hlm`, the agent). Two-way sync (CalDAV) is not
offered: Convex's HTTP router serves only `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS` and
`PATCH`, not CalDAV's `PROPFIND` and `REPORT`, and edits from two sides would need conflict
handling that a read-only view does not.

## What the calendar shows

The same iCalendar text (RFC 5545, `backend/convex/lib/ical.ts`) serves the feed and the
one-time `.ics` export:

| Task | In the calendar |
|---|---|
| Day and time | An event of 30 minutes at that time, in the time zone from the settings (default `Europe/London`), with its `VTIMEZONE` |
| Day only | An all-day event |
| No day, archived, in the trash | Left out |
| Done | Kept for 90 days as a single event marked `✓`, without alarms or repeat |
| Repeating | One event with the rule as `RRULE` (the same rule `hlm` and MCP show as `rrule`) |
| Reminders | `VALARM`s relative to the start: the task's own reminders, else the default minutes from the settings (those need a time) |

- `SUMMARY` is the title, `DESCRIPTION` is `Helm #<number>` and the note, `CATEGORIES` the
  labels. Events are `TRANSP:TRANSPARENT`: a task does not make you busy.
- `UID` is `<task id>@helm` and `DTSTAMP` the task's last change, so an unchanged plan gives
  the same text and calendar apps update events in place. Completing a repeating task creates
  the next task of the series (a new id), so the calendar gets the done occurrence and a new
  series.
- A repeating task's due date that is not itself a date of the rule (a Mon/Thu task due on a
  Wednesday) is its own event, and the series starts at the next date with its own UID
  (`<task id>-next@helm`): RFC 5545 leaves such a series undefined. `UNTIL` of a timed series is
  the end of that day in UTC, as RFC 5545 requires next to a `TZID`.
- A monthly rule on a 29th to 31st falls on the last day of shorter months in Helm. Its RRULE
  form needs `BYMONTHDAY` with `BYSETPOS`, which calendar apps do not all expand (ical.js
  ignores `BYSETPOS` there), so such a series is written as single events for two years ahead
  (UIDs `<task id>-<YYYYMMDD>@helm`); the feed moves that window along.
- A rule counted from completion (`from: "completion"`) shows the dates it would have if each
  occurrence were done on its day; its real dates are not known in advance.
- The tests parse every output with ical.js (a separate RFC 5545 parser) and check that each
  repeat rule expands to exactly the dates of Helm's own `lib/repeat.ts`, in the time zone,
  across clock changes (`backend/tests/ical.test.ts`, `calendar.test.ts`).

## Turning it on

- **Android:** Settings → Calendar shows the address with **Copy**, **Add to Google Calendar**,
  **Add to Apple Calendar**, **Create a new address** and **Turn off**, and **Export .ics**,
  which shares a one-time file through the system share sheet.
- **CLI:** `hlm calendar on` (or `hlm calendar` to see it), `hlm calendar rotate`,
  `hlm calendar off`, `hlm calendar export -o helm.ics` ([cli.md](cli.md)).

Then:

- **Apple Calendar** (iPhone, iPad, Mac): open the `webcal://` address, or on a Mac File → New
  Calendar Subscription and paste the address. The subscription has a setting to remove
  alerts; leave it off to keep the reminders.
- **Google Calendar:** on the web (the phone app cannot add calendars by URL), Settings → Add
  calendar → From URL, and paste the `https://` address; or open the "Add to Google Calendar"
  link. Google then shows it on the phone too.

**How fresh it is.** The feed asks clients to look again every hour (`REFRESH-INTERVAL`,
`X-PUBLISHED-TTL`) and lets them cache it for 5 minutes. Apple Calendar lets you pick the
interval. **Google Calendar refreshes subscribed calendars on its own schedule, usually every
several hours, and ignores these hints**; a change in Helm can take that long to show there.
Google also does not take reminders from subscribed calendars. Neither could be checked from
this repository (it needs a real Google account and time); treat both as reported behaviour.

## HTTP endpoints

| Method and path | Key | Answer |
|---|---|---|
| `GET /cal/<token>.ics` | the token in the path | `200 text/calendar; charset=utf-8`; `404` for any wrong, old, malformed or revoked token |
| `GET /calendar/feed` | personal API key, scope full | `{ "feed": { url, webcalUrl, googleCalendarUrl, createdAt } }`, or `{ "feed": null }` when off |
| `POST /calendar/feed` | personal API key, scope full | turns it on (keeps an existing address) and returns it |
| `POST /calendar/feed/rotate` | personal API key, scope full | a new address; the old one answers `404` at once |
| `POST /calendar/feed/revoke` | personal API key, scope full | `{ "revoked": true }` (or `false` when it was off) |

The app uses `app:getCalendarFeed`, `app:createCalendarFeed` (`{ replace: true }` for a new
address) and `app:revokeCalendarFeed`. The export is `export_plan` with `format: "ics"` (MCP,
`hlm export --format ics`, `app:exportPlan`); its text is the calendar itself. Changes to the
feed are recorded in the history (`calendarFeed.create`, `.rotate`, `.revoke`) without the
address.

## Threat model

**The address is a password to read the plan.** Whoever has it reads every dated task: titles,
notes, labels, times and reminders, until the address is replaced. It grants nothing else: no
changes, no undated or archived tasks, no history, settings or keys.

| Threat | Control | What is left |
|---|---|---|
| Guessing the address | 44 base64url characters: a 72-bit selector and a 192-bit secret from `crypto.getRandomValues`, compared in constant time; any miss is the same plain `404` | Nothing practical; there is no rate limit on misses |
| The address leaks (shared calendar, screenshot, a calendar app's sync, a forwarded link) | **Create a new address** (app) or `hlm calendar rotate`: the old one answers `404` at once; **Turn off** / `hlm calendar off` stops the feed. The app and `hlm` say that the address is secret | Whoever had it keeps what they already downloaded. Subscriptions must be added again with the new address |
| Logs | Helm's code never logs the address or writes it to the history; the feed sends `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex` | **The hosting platform logs request paths, the token included**: the Convex local backend writes `GET /cal/<token>.ics` to its access log (seen in testing), and Convex Cloud and any proxy in between can see it too. Calendar providers (Google, Apple) store the address to poll it. This is inherent to a secret URL, which is what calendar apps support; Google's own "secret address in iCal format" has the same property |
| Caches | `Cache-Control: private, max-age=300`; `no-store` on the management endpoints | A client may keep a copy for 5 minutes |
| Stored secret | The server keeps the secret itself (not a hash) so the address can be shown again on the phone and in `hlm`. Whoever can read the database already reads the plan the address opens | Database backups contain the address too |
| Someone else's key manages your feed | `/calendar/feed*` need a personal API key with scope full and act only on its owner's feed; OAuth connections (agents) cannot reach them | An API key can show the address, as it can read the plan |

## Out of scope

CalDAV and two-way sync, per-calendar filters (one feed with everything dated), a REST API and
webhooks, OAuth for calendars.
