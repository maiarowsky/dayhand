# Install

No Dayhand release is published yet: there is no package on npm or Homebrew, no APK on GitHub
Releases and no signed Mac download. Everything below builds from the source today, and each
section says what is coming. A piece marked *coming soon* has no command on this page, because none
works yet.

| Piece | Runs on | Today | Coming soon |
|---|---|---|---|
| [Command line](#command-line-dayhand) (`dayhand`, `dh`, `dayhand ui`) | macOS, Linux, Windows; Node.js 22.12+ | from source | npm, Homebrew |
| [Your own server](#your-own-server) | macOS and Linux (on this computer), or your Convex account | `dayhand server start` or `dayhand server deploy` | |
| [Android](#android) | Android 8.0 or newer | build it yourself | signed APK on GitHub Releases, Google Play |
| [macOS](#macos) | macOS 13 or newer; built with Xcode 26 | from source | signed, notarized download |
| [Linux](#linux-and-omarchy) | Qt 6 desktops; a package for Arch Linux and Omarchy | from source | |

The iPhone and iPad app is in development and has nothing to install yet. There is no Windows desktop
app; on Windows the command line works with a server on your own Convex account.

## Command line: dayhand

You need [Node.js](https://nodejs.org) 22.12 or newer and git, on macOS, Linux or Windows.

```sh
git clone https://github.com/maiarowsky/dayhand.git dayhand
cd dayhand/cli && npm ci --ignore-scripts && npm run build && npm link && cd ..
```

- `npm link` puts `dayhand` and `dh` (the same command, shorter) on your PATH. Where that needs
  administrator rights, run `node cli/dist/bin/dayhand.js` from the checkout instead.
  `npm unlink -g dayhand` removes the link.
- On Debian and Ubuntu, debhelper has a `dh` command of its own; type `dayhand` there.
- `--ignore-scripts` keeps the install scripts of dependencies from running. The packages come from
  the lockfile.
- **Update**: `git pull`, then `cd cli && npm ci --ignore-scripts && npm run build`. `dayhand version`
  shows the CLI and server versions and whether they work together.
- **Shell completion** for bash, zsh, fish and PowerShell: `dayhand help completion`.
- **Manual pages**: `man/dayhand.1` and `man/dh.1` in the checkout (`man ./man/dayhand.1`). A
  package installed from npm will carry them, so that `man dayhand` works.

Next, sign `dayhand` in to a server. `dayhand server start` and `dayhand server deploy` do it by
themselves; for a server that already runs, `dayhand login --url https://<deployment>.convex.site`
asks for a key ([command reference](cli.md#dayhand-login)).

**Coming soon:** the `dayhand` package on npm and a Homebrew tap. The publishing workflow and the
formula are prepared in the repository, but nothing is published.

## Your own server

The server is the `backend/` folder of the repository, deployed to [Convex](https://www.convex.dev).
The command line sets it up; there is nothing else to install:

- **On this computer** (macOS or Linux, x64 or arm64): `dayhand server start` downloads the Convex
  local backend once and runs your server until Ctrl+C. No account needed.
- **On your own free Convex account** (from macOS, Linux or Windows): `dayhand server deploy` logs in
  to Convex in the browser and deploys. The server gets a public HTTPS address.

Both are described step by step, with costs, backups and updates, in [Your own server](deploy.md).
The apps also work with no server at all, each on its own device.

## Android

Android 8.0 (API 26) or newer.

**Coming soon:** a signed APK on [GitHub Releases](https://github.com/maiarowsky/dayhand/releases) and
Google Play. The release build is prepared and signed with the project's key, but no release is
published yet.

**Build it yourself** with JDK 17 or newer and the Android SDK (platform 36). With a phone connected
over USB with debugging on, or an emulator running, in the checkout:

```sh
cd android
./gradlew :app:installDebug
```

`./gradlew :app:assembleDebug` makes the APK (`app/build/outputs/apk/debug/app-debug.apk`) without
installing it. A debug build can also talk to a server over plain HTTP, which helps with a server on
your computer during development; release builds use HTTPS only. A release build needs a signing key of
your own (`DAYHAND_RELEASE_KEYSTORE`): see [android/README.md](../android/README.md#release-build). Keep
that key, because every update must be signed with the same one.

Then open Dayhand and choose **On this phone only** or **Connect to my server**: [Android](android.md).

## macOS

macOS 13 or newer. Building needs Xcode 26 or later.

```sh
(cd macos && scripts/build-app.sh)
open macos/dist/Dayhand.app
```

The app is built for the Mac that built it: it is not signed with a Developer ID or notarized, so
other Macs would refuse it. Updates are built in (Sparkle) but stay off in local builds, which say
so in Settings → Updates; update a local build by pulling and building again. Then connect it with a
code from `dayhand pair`, or choose **Not now**: [macOS](macos-app.md).

**Coming soon:** a signed, notarized download that updates itself.

## Linux and Omarchy

A Qt 6 app, `dayhand-qt`. On Arch Linux or Omarchy, build and install the package from the checkout
(not from the AUR, where there is no package):

```sh
cd packaging/arch
makepkg -si
```

It builds `linux/`, runs its tests (they need `weston` and `dbus`; `--nocheck` skips them) and
installs `dayhand-qt` with its launcher entry and icon. It depends on `qt6-base`, `qt6-declarative`,
`qt6-svg`, `qt6-wayland` and `libsecret`; the sign-in is kept by a Secret Service such as
gnome-keyring. For Japanese and Chinese, install a CJK font such as `noto-fonts-cjk`.

On other distributions, build it with CMake 3.21+ and Ninja against Qt 6 (Base, Declarative, SVG,
Tools, Wayland) and libsecret, from your distribution's packages:

```sh
cmake -S linux -B linux/build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build linux/build
ctest --test-dir linux/build --output-on-failure
sudo cmake --install linux/build
```

The install step puts `dayhand-qt`, its launcher entry, the AppStream metadata and the icon under
`/usr/local`. Setting it up on the desktop (a key for quick add, the tray, themes): [Linux and
Omarchy](linux.md). Only Arch Linux builds are tested in the project; the CMake path on other
distributions is not.

`dayhand ui`, the terminal app, comes with the [command line](#command-line-dayhand), on Linux as
everywhere else; [dayhand ui on Omarchy](omarchy.md) makes it an app of its own.
