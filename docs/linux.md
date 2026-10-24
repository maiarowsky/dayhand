# Dayhand for Linux: install and desktop setup

What the app does and how it is built and tested is in [linux/README.md](../linux/README.md). This page is about
putting it on a desktop, with Omarchy (Hyprland) as the worked example: install, a key for quick add, the tray,
notifications, colours that follow the theme, the language, and where the data lives.

Nothing here has been run on a real Omarchy or Hyprland session yet; see [Not checked](#not-checked). The Omarchy
details follow its own configuration files (`omacom/omarchy`, branch `quattro` at `99f479b`, read on 2026-10-24).

## Install

There is no AUR package. Build the Arch Linux package from a checkout of this repository:

```sh
cd packaging/arch
makepkg -si          # builds linux/, runs its tests (needs weston and dbus; --nocheck skips them), installs
```

It installs `/usr/bin/dayhand-qt`, `io.github.maiarowsky.dayhand.desktop` (also the handler of `dayhand://` and
`helm://` links), the icon and the AppStream metadata. It needs `qt6-base`, `qt6-declarative`, `qt6-svg`,
`qt6-wayland` and `libsecret`; the sign-in is kept by a Secret Service such as gnome-keyring, which Omarchy runs.
For Japanese and Chinese, a CJK font such as `noto-fonts-cjk` must be installed.

## First start

Open **Dayhand** from the launcher. It asks for a server: on a computer signed in with `dayhand`, run
`dayhand pair` and type the address and code it shows, or open the `dayhand://pair?…` link it prints (the browser
hands it to Dayhand). **Not Now, Use Dayhand Offline** keeps the tasks on this computer; **⋯ → Connect…** connects
later and sends them. **⋯ → Disconnect** forgets the sign-in here; `dayhand revoke <device>` ends it on the server.

Closing the window keeps Dayhand in the tray, so reminders keep ringing. **Quit Dayhand** (tray or **⋯**) stops it.
Without a tray, closing the window quits.

## Task details

Click a task row to open its details on the right (windows at least 800 pixels wide).
In a narrower window, the details replace Today and **Back** returns to the list.
Title, status, current work, where you stopped, comma-separated labels and checklist edits save locally and queue for sync.
The due field reads English date phrases like quick add, previews them with **I understand**, and applies them with Return or **Set date**.
**Today** keeps the time, **No day** clears day and time, and **Remove time** keeps the day.
Notes save only with **Save note**; repeat rules, reminders and links are previews, not editors.
Archive or trash keeps the selected details open even though the row leaves Today.
In the trash, all edits are disabled and **Restore** brings the task back.
There is no trash list in this version.

## Quick add from any app (Hyprland)

`dayhand-qt --quick-add` opens the small quick add window. Only one Dayhand runs per session: when it is already
running, the second `dayhand-qt` hands the request over a socket in `$XDG_RUNTIME_DIR` and exits, so the window
appears at once. Return adds the task and closes the window, Escape closes it.

On Omarchy, personal bindings go in `~/.config/hypr/bindings.lua` (`Super + Alt + N` and `Super + Alt + D` are free
in Omarchy's defaults; `omarchy menu keybindings --print` lists what is taken):

```lua
o.bind("SUPER + ALT + N", "Dayhand quick add", { launch = "dayhand-qt --quick-add" })
o.bind("SUPER + ALT + D", "Dayhand", { launch = "dayhand-qt" })
```

`{ launch = … }` runs the command through `uwsm-app`, as Omarchy does for its own apps. To have the quick add window
float in the middle of the screen instead of tiling, add a window rule at the end of `~/.config/hypr/hyprland.lua`
(the window's class is the app id, its title is always the English `Dayhand quick add`):

```lua
o.window({ class = "io\\.github\\.maiarowsky\\.dayhand", title = "^Dayhand quick add$" }, { float = true, center = true })
```

To start Dayhand in the tray when you log in, add to `~/.config/hypr/autostart.lua`:

```lua
o.launch_on_start("dayhand-qt --background")
```

On Hyprland without Omarchy, the same in `hyprland.conf` (the window rule syntax changes between Hyprland
versions; check it against the wiki for yours):

```ini
bind = SUPER ALT, N, exec, dayhand-qt --quick-add
exec-once = dayhand-qt --background
windowrulev2 = float, class:^(io\.github\.maiarowsky\.dayhand)$, title:^(Dayhand quick add)$
windowrulev2 = center, class:^(io\.github\.maiarowsky\.dayhand)$, title:^(Dayhand quick add)$
```

### The GlobalShortcuts portal (not used)

Hyprland's portal (`xdg-desktop-portal-hyprland`) also offers the GlobalShortcuts interface: an app registers a
named shortcut (here it would be `quick-add`) and Hyprland binds a key to it with the `global` dispatcher
(`bind = SUPER ALT, N, global, io.github.maiarowsky.dayhand:quick-add`, `hl.dsp.global(…)` in Lua). Dayhand does not
register one in this version. The binding above does the same with nothing to set up in the app and works on any
compositor that can run a command; the portal path would need a portal session kept for the life of the app and
cannot be tested without a running Hyprland. It is a candidate for later, for desktops where users cannot add
bindings of their own.

## Tray

Dayhand's tray icon is a StatusNotifierItem with a dbusmenu menu, which Qt provides over D-Bus. Omarchy's shell
shows such items in its tray, and so do Waybar's `tray` module and KDE. The tooltip says how many tasks are open
today and how many are overdue, and the icon gets a red mark when something is overdue. The menu has **Quick Add…**,
**Open Dayhand**, up to ten of today's open tasks (choosing one ticks it off), **Sync Now** and **Quit Dayhand**.
A click on the icon opens the window; a middle click opens quick add.

## Notifications

Reminders and the morning summary go to the notification service on the session bus
(`org.freedesktop.Notifications`: Omarchy's shell, mako, dunst, GNOME, KDE). A reminder has **Done**, which
completes the task, and opening it shows Dayhand; it has normal urgency. The morning summary has low urgency, so it
waits quietly. Dayhand rings only while it runs (in the tray); a reminder more than 15 minutes late, after the
laptop slept, is dropped, as on Android.

## Colours and Omarchy themes

Dayhand takes its colours from the system palette, which Qt gets from the platform theme. Omarchy sets
`QT_QPA_PLATFORMTHEME=gtk3`, so Qt apps follow the GTK theme's light or dark mode, not the colours of the Omarchy
theme itself.

For the theme's own colours, Dayhand reads a palette file, the first of:

1. `$DAYHAND_PALETTE`
2. `~/.config/dayhand/palette.conf`
3. `~/.local/state/omarchy/current/theme/dayhand-palette.conf`

with `key = value` lines (`#` and `;` start comments). The keys are the names of Omarchy's `colors.toml`:
`background`, `lighter_background`, `foreground`, `accent`, `selection_foreground`, `muted`, and `red` or `overdue`
for overdue tasks. A key left out keeps the system's colour. Dayhand watches the file and recolours the running
window when it changes.

Omarchy renders every template in `~/.config/omarchy/themed/` into the current theme's folder on each theme
switch, so one template keeps Dayhand in step with every theme:

```ini
# ~/.config/omarchy/themed/dayhand-palette.conf.tpl
background = {{ background }}
lighter_background = {{ lighter_background }}
foreground = {{ foreground }}
accent = {{ accent }}
selection_foreground = {{ selection_foreground }}
muted = {{ muted }}
red = {{ red }}
```

Run `omarchy theme set <theme>` (or pick a theme in the menu) once after adding it. A theme without an `accent`
colour leaves that line empty and Dayhand keeps the system's highlight.

## Language

Dayhand speaks English, Polish, German, Spanish, French, Brazilian Portuguese, Japanese and Simplified Chinese. It
follows the system's language (`LANGUAGE`, `LC_MESSAGES`, `LANG`) and falls back to English; **⋯ → Settings… →
Language** picks another one at once. Quick add reads date phrases in English in every language ("tomorrow 9am",
"fri", "23 oct"), the same grammar as `dayhand`.

## Data and settings

| What | Where |
|---|---|
| Tasks and the outbox (SQLite) | `~/.local/share/dayhand/dayhand.sqlite` |
| Preferences (language, offline mode, last server) | `~/.config/dayhand/dayhand-qt.conf` |
| The sign-in to the server | the Secret Service keyring, item `io.github.maiarowsky.dayhand`, `account=device` |

Environment variables: `DAYHAND_DATA_DIR=<folder>` keeps the database and preferences there instead (for a second
profile or a test), `DAYHAND_CREDENTIALS=memory` keeps the sign-in in memory only, and `DAYHAND_PALETTE=<file>` names
a palette file.

## Not checked

- No run on Omarchy, Hyprland or another real desktop. The app was built and tested in an Arch Linux container: the
  window on Qt's offscreen platform, the tray and notifications as a client of a headless Weston against fake
  desktop services, and the real `dayhand-qt` started on that Weston. The bindings, the window rule, the autostart
  line and the theme template follow Omarchy's files, not a test on the system.
- Not tried with the Omarchy shell's tray or notification centre, Waybar, mako or dunst; only the D-Bus
  interfaces they implement were exercised.
- The Secret Service keyring path was not exercised (the tests keep the sign-in in memory), and no pairing with a
  real server was made from this app; pairing and sync were tested against a fake server.
- Japanese and Chinese were not looked at on screen (the test container has no CJK font); their texts and those of
  the other languages were translated by the agent that wrote the app and have not been reviewed by native
  speakers.
