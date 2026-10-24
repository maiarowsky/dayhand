# Dayhand for macOS: distribution and what is left

The app itself (what it does, how it is built and tested) is described in
[macos/README.md](../macos/README.md). This page is about the two things that are not done yet:
shipping it to other Macs, and the rest of the Android app's features.

## Distribution

Nothing is signed, notarized, packed or published yet, and nothing in the repository does it.
`macos/scripts/build-app.sh` makes `macos/dist/Dayhand.app` for the Mac that built it. Each step below
needs the maintainer's word and secrets that must not live in the repository.

| Step | What it needs | Where the secret lives (to decide) |
|---|---|---|
| Developer ID signing with the hardened runtime | a *Developer ID Application* certificate of the Apple Developer team (99 USD a year, the team exists) | the Mac's login Keychain for local releases; for CI an encrypted `.p12` and its password as repository secrets |
| Notarization (`xcrun notarytool submit --wait`) and stapling (`xcrun stapler staple`) | an App Store Connect API key (issuer id, key id, `.p8`) or an app-specific password | `notarytool store-credentials <profile>` locally; repository secrets in CI |
| DMG (`hdiutil create -format UDZO`) and a Homebrew cask in an own tap | a tap repository; Homebrew's official casks require apps that pass Gatekeeper | none |
| Updates with [Sparkle](https://sparkle-project.org) (MIT-style licence) | an EdDSA key pair (`generate_keys`); the public key goes into `Info.plist`, the appcast is published with the releases | the private key, never in the repository |
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
settings, the release workflow, the cask, Sparkle's appcast), plus the maintainer's time for the Apple accounts.

Before the first release also decide: the version scheme (the app reports `0.1.0` and the commit count as the
build number, like the Android app's `versionCode`) and when to stop registering `helm://` next to
`dayhand://` (`dayhand pair` prints `dayhand://` links; `helm://` is only there for codes printed by
older versions).

## What is left for parity with the Android app

The MVP covers pairing, Today, quick add with date phrases, ticking off, the menu bar, the global shortcut, the
offline outbox, reminders and the morning summary, and the details with basic editing. The research estimated
80 to 110 hours for full parity; what remains, by screen:

- **Board**: three columns (To do, In progress with the now task first, Done: the 50 most recently done), drag
  between columns, the same moves from a menu. The repository already has `move(_:to:)`.
- **Calendar**: the week on an hour grid and one day, tasks with a time as blocks, the band of tasks without a
  time, later dates of a repeating task (`Recurrence.occurrences` is ported), drag to another day and time with
  Undo (`setDue` through the outbox is there).
- **Details**: editors for repeat (every N days, weeks on weekdays, months on a day, the last day or an nth
  weekday; from the due date or completion; until or a count; `TaskRules.isValid` and `setRepeat` are ported),
  for reminders (minutes before, a time on the day or days before, at most five; `setReminders` is ported), for
  links, a date picker, moving checklist items, and the **change history** (`app:getTask`, cached for offline).
- **Trash**: the list of deleted tasks with the day each goes for good, and **Restore** (`restore` is ported; the
  trash is already in every snapshot).
- **Settings**: the morning summary time and default reminders edited on the Mac (`app:updateSettings` through the
  outbox, kept against snapshots while it waits); appearance (the Mussh palettes and fonts of
  [design.md](design.md)); export as Markdown or JSON; the calendar address; **agent connections** (approve a
  connection by the code its sign-in page shows, list and disconnect).
- **Polish** next to English (the Android app has both). The screens are in English and dates follow them.
- **Reminders**: macOS may deliver a notification late after sleep; the Android app drops a reminder more than
  15 minutes late. Dayhand could withdraw stale pending ones when the Mac wakes.
- **Live updates**: polling every 15 seconds now. A Convex WebSocket subscription would make changes elsewhere
  appear at once; `convex-swift` needs a binary framework, so this would be a small client of the Convex sync
  protocol, or the Rust core if a binary is accepted.
- **UI tests**: the screens are drawn by `DayhandSnapshots` and their logic is tested in `DayhandCore`; clicks
  through the real app (XCUITest) need the Xcode project above.

The same core (`DayhandCore`) is meant to carry the iOS app later: it has no AppKit or SwiftUI in it.
