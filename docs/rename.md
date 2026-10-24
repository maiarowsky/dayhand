# Renamed from Helm

Helm became Dayhand in backend 0.9.0, CLI 0.10.0 and Android app 0.9.0. Nothing has to change
at once; the old names keep working with a deprecation warning:

| Before | Now | Old name |
|---|---|---|
| `hlm` command | `dayhand`, short `dh` | `hlm` still runs until CLI 1.0 and warns on every run |
| CLI variables `HLM_*`, `HELM_URL`, `HELM_API_KEY`, `HELM_BACKEND_DIR`, `HELM_SERVER_CONFIG_DIR` | `DAYHAND_*` | read while the `DAYHAND_*` name is unset, with a warning |
| CLI config folder `hlm` (e.g. `~/.config/hlm`) | `dayhand` | used while there is no `dayhand` folder, with a warning saying where to move it |
| keychain entry `hlm` | `dayhand` | read when there is no `dayhand` entry; `dayhand logout` removes both |
| server folder `helm-server` | `dayhand-server` | used while there is no `dayhand-server` folder |
| deployment variables `HELM_*` | `DAYHAND_*` | read while `DAYHAND_*` is unset ([deploy.md](deploy.md#renamed-variables)) |
| Android build: `-Phelm.serverUrl`, `HELM_RELEASE_*` | `-Pdayhand.serverUrl`, `DAYHAND_RELEASE_*` | read when the new one is unset (Gradle warns) |
| API keys `helm_…` | new keys start with `dayhand_` | old keys work until revoked |
| MCP resources `helm://…`, pairing links `helm://pair` | `dayhand://…` | still accepted |
| import format `helm-json` | `dayhand-json` | still accepted |
| `backend/cli/helm.mjs` (`npx helm`) | `dayhand` | removed |

These stay as they were, because they are stored in data or in tokens already given out: the
issuer `https://helm.local` of the local backend and the user ids made from it, the JWT audience
`helm`, the device and OAuth token prefixes (`helmdev_`, `helmat_`, `helmrt_`…), the calendar
UIDs `…@helm` (a new suffix would duplicate every event in Google and Apple Calendar), the
Android app's storage names and Kotlin package `dev.helm.planner`.

The GitHub repository is now `maiarowsky/dayhand`; GitHub redirects the old `maiarowsky/helm`
addresses, including `git clone` and existing checkouts.

## Known risk: another DayHand

There is an unrelated to-do app called DayHand for iPhone, iPad and
Mac ([amouraux/DayHand](https://github.com/amouraux/DayHand), in public TestFlight beta in
October 2026). App Store names are unique, so if it gets there first, this project's Apple apps
would be listed as "Dayhand Planner". The CLI, npm, Homebrew and Android are not affected.
