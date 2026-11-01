# Dayhand for macOS: distribution and what is left

The app itself (what it does, how it is built and tested) is described in
[macos/README.md](../macos/README.md). This page is about shipping it to other Macs, its updates, and the rest
of the Android app's features.

## Distribution

Nothing is signed, notarized, packed or published yet, and nothing in the repository does it.
`macos/scripts/build-app.sh` makes `macos/dist/Dayhand.app` for the Mac that built it. Each step below
needs the maintainer's word and secrets that must not live in the repository.

| Step | What it needs | Where the secret lives (to decide) |
|---|---|---|
| Developer ID signing with the hardened runtime | a *Developer ID Application* certificate of the Apple Developer team (99 USD a year, the team exists) | the Mac's login Keychain for local releases; for CI an encrypted `.p12` and its password as repository secrets |
| Notarization (`xcrun notarytool submit --wait`) and stapling (`xcrun stapler staple`) | an App Store Connect API key (issuer id, key id, `.p8`) or an app-specific password | `notarytool store-credentials <profile>` locally; repository secrets in CI |
| DMG (`hdiutil create -format UDZO`) and a Homebrew cask in an own tap | a tap repository; Homebrew's official casks require apps that pass Gatekeeper | none |
| Updates with [Sparkle](https://sparkle-project.org) (MIT-style licence): **built in**, off until the key is given ([Updates](#updates)) | an EdDSA key pair (`generate_keys`); the public key goes into `Info.plist` at build time, the appcast is published with the releases | the private key in the maintainer's login Keychain (where `generate_keys` puts it) and a backup in a password manager, never in the repository |
| App icon | an `AppIcon.icns` (the app shows the generic icon now) | none |

One build change comes first: **signed builds need an Xcode project** (or an `.xcodeproj` generated for the
package's `Dayhand` target). SwiftPM's generated resource accessor looks for a package's resources next to the
app (`Dayhand.app/KeyboardShortcuts_KeyboardShortcuts.bundle`), which is fine for a local build but is unsealed
content in the bundle root, so `codesign` refuses it. An Xcode app target that depends on the package puts the
bundles in `Contents/Resources` and finds them there. The core and the screens do not change.

With the project in place, a release on this Mac is (no secrets in the commands, the names come from the
Keychain):

```sh
xcodebuild -project Dayhand.xcodeproj -scheme Dayhand -configuration Release \
  -archivePath build/Dayhand.xcarchive archive
xcodebuild -exportArchive -archivePath build/Dayhand.xcarchive -exportPath build/export \
  -exportOptionsPlist ExportOptions.plist            # method: developer-id
ditto -c -k --keepParent build/export/Dayhand.app build/Dayhand.zip
xcrun notarytool submit build/Dayhand.zip --keychain-profile "$DAYHAND_NOTARY_PROFILE" --wait
xcrun stapler staple build/export/Dayhand.app
hdiutil create -volname Dayhand -srcfolder build/export/Dayhand.app -format UDZO build/Dayhand.dmg
```

Estimate: 4 to 8 hours of agent work once the certificate and the notarization key exist (project, signing
settings, the release workflow, the cask), plus the maintainer's time for the Apple accounts. The updater and its
screens are done (below); the release only has to sign and publish them.

Before the first release also decide: the version scheme (current build metadata is described in
[macos/README.md](../macos/README.md#build-and-run)) and when to stop registering `helm://` next to
`dayhand://` (`dayhand pair` prints `dayhand://` links; `helm://` is only there for codes printed by
older versions).

## Updates

Dayhand updates itself with [Sparkle](https://sparkle-project.org) 2 (2.10.0, MIT-style licence), the way most
Mac apps outside the App Store do. Sparkle reads an **appcast** (an RSS file listing the versions), compares
`sparkle:version` with the app's build number (`CFBundleVersion`), downloads the newer archive, checks its
**EdDSA signature** against the public key in the app, and installs it after the app quits, then starts the new
version. Dayhand draws its own screens for it (Sparkle's user driver in `DayhandUpdates`):

- **The update button**: a round blue button with a download arrow at the bottom left of the shared task sidebar
  ([sidebar layout](../macos/README.md)). It shows only while a newer version is known; its tooltip names the version.
- **The update window** (a popover on the button): "Dayhand 0.2.0 is available", the running version, the release
  notes as plain text, **Later** and **Update and Relaunch**; then the download with its progress, the signature
  check, "Dayhand will quit and open again"; a failure in plain words (offline, unreadable list, broken download,
  failed signature, cannot replace itself) with **Try Again**; "Dayhand is up to date" after a check.
- **Dayhand → Check for Updates…** opens the window over the button and checks.
- **Settings → Updates**: the version and build, **Check for updates automatically** (on by default, once a
  day, `SUEnableAutomaticChecks`), **Include preview versions** (off by default; the appcast's `preview`
  channel), **Check for Updates**, the last check, and the outcome of the last install.
- **After an install**: just before Sparkle quits the app, Dayhand notes the version it installs. At the next
  start the running build tells whether it went in; if not, Settings and the update window say so and the offer
  stays.

**Without the key, nothing happens.** The key and the appcast address are written into `Info.plist` by
`scripts/build-app.sh` from `DAYHAND_SPARKLE_PUBLIC_KEY` and `DAYHAND_APPCAST_URL`. A build without the key (every
local build, and `swift run`) never creates Sparkle's updater, so it fetches nothing, and Settings says
"Updates aren't available in this build" with the reason. The appcast must be HTTPS (plain HTTP only to
`127.0.0.1`/`localhost`, for trying an update locally). Nothing in the code changes when the key is added.

Default appcast address: `https://github.com/maiarowsky/helm/releases/download/dayhand-macos-appcast/appcast.xml`,
the `appcast.xml` asset of one release tagged `dayhand-macos-appcast`, which also holds the archives; `appcast.xml`
is replaced at every macOS release (the repository's "latest release" can be a CLI release, so `releases/latest`
would not work). It needs the repository
to be **public**: assets of a private repository need a GitHub sign-in. Until the first macOS release this
address is not called by anything.

### What the maintainer does (needs secrets)

Once:

1. `macos/.build/artifacts/sparkle/Sparkle/bin/generate_keys` (the folder appears after `swift build` in
   `macos/`). It makes the EdDSA pair, keeps the private key in the login Keychain and prints the public key.
   Back the private key up: `generate_keys -x dayhand-sparkle-private.key`, store the file in the password manager,
   delete it from disk. **Losing it means the installed apps can never be updated again.**
2. Keep the public key where builds read it: a shell profile for local releases
   (`export DAYHAND_SPARKLE_PUBLIC_KEY=…`; it is not secret) or a repository variable for CI.
3. Make the repository public (see [release.md](release.md)) or choose another HTTPS host for the appcast and pass
   it as `DAYHAND_APPCAST_URL`.
4. Create the release that holds the appcast: `gh release create dayhand-macos-appcast --title "Dayhand for macOS appcast" --notes "Update feed of Dayhand for macOS."`.

Every release (version `X.Y.Z`; the build number is the commit count):

```sh
cd macos
DAYHAND_VERSION=X.Y.Z scripts/build-app.sh          # with DAYHAND_SPARKLE_PUBLIC_KEY set; prints "updates from …"
# Sign with the Developer ID, inside out, with the hardened runtime (Sparkle's order for apps not signed by Xcode):
ID="Developer ID Application: <name> (<team>)"
F=dist/Dayhand.app/Contents/Frameworks/Sparkle.framework
codesign -f -s "$ID" -o runtime "$F/Versions/B/XPCServices/Installer.xpc"
codesign -f -s "$ID" -o runtime --preserve-metadata=entitlements "$F/Versions/B/XPCServices/Downloader.xpc"
codesign -f -s "$ID" -o runtime "$F/Versions/B/Autoupdate" "$F/Versions/B/Updater.app" "$F"
codesign -f -s "$ID" -o runtime dist/Dayhand.app
ditto -c -k --keepParent dist/Dayhand.app build/Dayhand.zip
xcrun notarytool submit build/Dayhand.zip --keychain-profile "$DAYHAND_NOTARY_PROFILE" --wait
xcrun stapler staple dist/Dayhand.app
mkdir -p build/updates && ditto -c -k --keepParent dist/Dayhand.app "build/updates/Dayhand-X.Y.Z.zip"
# Signs the archive with the private key from the Keychain and writes build/updates/appcast.xml (it keeps
# earlier items if the previous appcast.xml is in the folder; download it first):
.build/artifacts/sparkle/Sparkle/bin/generate_appcast build/updates --embed-release-notes \
  --download-url-prefix "https://github.com/maiarowsky/helm/releases/download/dayhand-macos-appcast/"
# The archives live next to the appcast, so every item keeps a working address:
gh release upload dayhand-macos-appcast "build/updates/Dayhand-X.Y.Z.zip"
gh release upload dayhand-macos-appcast build/updates/appcast.xml --clobber
```

For a preview, add `--channel preview` to `generate_appcast`: only Macs with **Include preview versions** see it.
Release notes are a `Dayhand-X.Y.Z.html` (or `.md`) next to the archive; `--embed-release-notes` puts them into the
item, and the window shows them as plain text, up to about 600 characters. A preview needs a build number of its
own, newer than the release before it: Sparkle ignores a `-preview.1` suffix when it compares versions. While
the signing still needs the Xcode project from [Distribution](#distribution), the archive and export steps
there replace the first `codesign` lines; the appcast steps stay the same.

### What the scripts and the app do (no secrets)

- `scripts/build-app.sh`: copies `Sparkle.framework` into `Contents/Frameworks` (the binary's rpath points there),
  writes `SUFeedURL` and, only when given, `SUPublicEDKey` into `Info.plist`, and refuses a key that is not 32
  bytes of base64.
- `DayhandUpdates` (`macos/Sources/DayhandUpdates`): reads the configuration (`UpdateConfiguration`), keeps the
  state machine (`UpdateState`: checking, available, downloading with progress, extracting, ready, installing,
  failed, up to date), turns release notes into text (`ReleaseNotes`), keeps the install note (`InstallRecord`), and
  drives Sparkle (`Updater`). Sparkle itself is used only from here, so `DayhandCore` stays free of it.
- `swift test` checks it without the network outside this Mac: the real Sparkle reads appcasts from a server on
  `127.0.0.1` (a newer build with its notes, numeric build order, a too-new macOS skipped, the preview channel, up
  to date, an unreadable appcast, a server that is down, a download that breaks halfway with its progress, and no
  request at all without a key), with a throwaway key pair made in memory; plus the state machine, the
  configuration, the notes, the error texts and the install note.

Not checked yet (needs the signed release): a full install and relaunch. Sparkle does that with its own installer
after the app quits, and only for a signed, notarized app; the first release should try it from the previous
version before announcing it.

## Offline repeating

Completing a repeating task shows its next occurrence at once, with or without a network.

**Paired Mac** (a server is connected, reachable or not): the server still creates the next occurrence. The Mac
shows its own copy straight away and queues only the completion, with the local day (`completedOn`, backend
0.14.1). When the server answers, the copy becomes the server's occurrence: the next snapshot fills in the
server's fields, criteria and plan included, also when an agent changed them in the meantime. A
completion-anchored rule counts from the day the task was done on the Mac, not from the day it syncs. Until then
the copy can be edited and completed like any task; those changes are sent after the completion. When the server
creates no occurrence (another device completed the same occurrence first), the copy and the changes made to it go,
and the server's occurrence is kept: one completion, one next occurrence. When the server refuses the completion
(the task was trashed or purged elsewhere), the copy goes too, with the copies made from it. A server older than
0.14.1 refuses `completedOn`; the completion is then sent again without it and counted from the sync day.

**Without a server** (**Not now**, disconnected or signed out): the Mac creates the next occurrence itself. It
clears the completed task's rule before sending completion, then uploads the locally created occurrence, so
connecting a server later does not also generate an occurrence for that completion. Retries reuse the queued
occurrence's `clientId`. If the parent add, rule-clear or completion is permanently refused, its unsent generated
occurrences are discarded.

Known limitations:

- Without a server, a locally created next occurrence does not copy agent work (criteria, plan, proof,
  dependencies, blocked reason, claim): those fields are read-only on the Mac.
- Without a server, completing the same cached occurrence on two devices before sync can yield two next
  occurrences, as on Android.

## Agent work and settings on the Mac

Since 0.3.0 the Mac shows agent work read-only and edits the notification settings. What it does is described in
[macos/README.md](../macos/README.md); the edges:

- The agent fields (criteria, plan, proof, dependencies, blocked reason, claim holder and end, the task's number)
  come only from snapshots and always take the server's copy. A dependency shows its title only when the task is on
  this Mac; a proposal or a purged task reads "A task not on this Mac".
- The plan health card shows the last report the server sent and is read a second after the tasks change, when a
  server connects, whenever Today appears, on Sync Now and on a synced poll once a minute has passed. While Today
  stays open, these age-based reads check approval requests and proposals even when no task changes. Without a
  server the card is not read; the last report stays (also after **Not now**) until **Disconnect** or a sign-out
  by the server.
- **Review** reads the waiting approval requests and proposals when it opens and keeps nothing: offline it says
  they could not be read. Known limitation: `app:listApprovals` returns only the newest 50 pending requests, with
  no pagination on the Mac. When plan health counts more pending requests than the list shows, the header labels
  them as the newest subset. For a larger batch, use the CLI's [approval list options](cli.md#dayhand-approvals).
  Deciding, pausing agents, tool policies and ending a claim stay on the phone and with `dayhand`.
- A settings change made without a server waits in the outbox and goes to the first server the Mac connects to.
  Until a server has sent its settings, the time zone stays this Mac's at the moment of the change.

## What is left for parity with the Android app

The implemented features, including the trash and change history, are described in
[macos/README.md](../macos/README.md). The lists are done: All Tasks, No Project and each project are
places in the sidebar, each as a list, a board or a week plan, next to Done and Archived and the trash
([Projects](projects.md)). The research estimated 80 to 110 hours for full parity; what remains,
by screen:

- **Board**: the now task first in In progress; the Mac's board keeps the order of the list.
- **Calendar**: the week plan has the hour grid, blocks and drag to a day and time; missing are a single day,
  later dates of a repeating task (`Recurrence.occurrences` is ported) and Undo after a drag.
- **Details**: an editor for links, a date picker and moving checklist items.
- **Agents**: deciding approval requests and proposals, pausing agents, tool policies and **End the claim**; the
  read-only list behind **Review** is the start.
- **Settings**: appearance (the Mussh palettes and fonts of
  [design.md](design.md)); export as Markdown or JSON; the calendar address; **agent connections** (approve a
  connection by the code its sign-in page shows, list and disconnect).
- **Date phrases in other languages**: the screens speak eight languages, but quick add and the date field read
  English phrases only ("fri 2pm"), as `dayhand` does; "pt 14:00" or "jutro" would need the grammar in each language.
- **Reminders**: macOS may deliver a notification late after sleep; the Android app drops a reminder more than
  15 minutes late. Dayhand could withdraw stale pending ones when the Mac wakes.
- **Live updates (coming soon)**: active polling starts at 60 seconds and doubles after every three unchanged
  merges, up to 300 seconds; background or hidden windows poll no faster than every 300 seconds. Local changes
  still sync immediately; foreground return, interaction, waking the Mac or a changed merge resets the active
  interval to 60 seconds, reading at once only when the last read is at least that old, time asleep included. See [sync details](../macos/README.md#how-it-works). A Convex WebSocket subscription would make
  changes elsewhere appear at once; `convex-swift` needs a binary framework, so this would be a small client of the Convex sync
  protocol, or the Rust core if a binary is accepted.
- **UI tests**: current screen and layout checks are described in [macos/README.md](../macos/README.md#tests);
  clicks through the real app (XCUITest) need the Xcode project above.

The same core (`DayhandCore`) is meant to carry the iOS app later: it has no AppKit or SwiftUI in it.
