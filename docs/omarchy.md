# dayhand ui on Omarchy

[Omarchy](https://github.com/omacom/omarchy) treats terminal programs as first-class apps: a
launcher entry opens them in their own terminal window, a Hyprland key focuses that window
when it is already open, and the terminal's 16 ANSI colours follow the Omarchy theme. `dayhand ui`
uses only those 16 colours, so it changes with the theme like the rest of the desktop.

For the desktop app with a tray, quick add and notifications, see [linux.md](linux.md).

This page describes a hand-made setup. There is no AUR package yet, and nothing here has been
run on an Omarchy machine (see [Not checked](#not-checked)).

## Install dayhand

`dayhand` needs Node.js 22.12 or newer, which Omarchy does not install by default:

```sh
omarchy pkg add nodejs npm          # or: sudo pacman -S nodejs npm
```

`dayhand` is not on npm yet ([release.md](release.md)), so build it from a checkout of this
repository:

```sh
cd cli
npm ci --ignore-scripts
npm run build
npm link                            # puts dayhand on the PATH
dayhand login --url https://<deployment>.convex.site
```

`dayhand login` keeps the key in the Secret Service keyring (gnome-keyring and libsecret are in
Omarchy's base packages). Check it with `dayhand whoami`, then try `dayhand ui` in any terminal.

## A launcher entry

Either go to *Install > TUI* in the Omarchy menu (`Super + Space`) and give it the name `Dayhand`,
the command `dayhand ui`, a window style and an icon, or write the entry yourself. The hand-written
one below focuses the Dayhand window when it is already open instead of starting a second one,
because it launches through `omarchy-launch-or-focus-tui` with a fixed app id:

```ini
# ~/.local/share/applications/Dayhand.desktop
[Desktop Entry]
Version=1.0
Name=Dayhand
Comment=Today, board and week of your Dayhand tasks
Exec=omarchy-launch-or-focus-tui --app-id=org.omarchy.dayhand dayhand ui
Terminal=false
Type=Application
Icon=utilities-terminal
StartupNotify=true
```

`omarchy-launch-or-focus-tui` looks for a window whose class or title matches the app id and
focuses it; otherwise it runs `omarchy-launch-tui`, which opens the default terminal with
`xdg-terminal-exec --app-id=org.omarchy.dayhand -e dayhand ui`. *Install > TUI* writes a similar
entry, but with `Exec=xdg-terminal-exec --app-id=TUI.tile -e dayhand ui` (or `TUI.float`), which
always opens a new window. For your own icon, copy a PNG to
`~/.local/share/icons/hicolor/256x256/apps/dayhand.png` and set `Icon=dayhand`.

## A Hyprland key

Personal bindings go in `~/.config/hypr/bindings.lua`. Pass the whole command as a string so
that the app id stays `org.omarchy.dayhand` and the key focuses a running Dayhand:

```lua
o.bind("SUPER + SHIFT + H", "Dayhand", "omarchy-launch-or-focus-tui --app-id=org.omarchy.dayhand dayhand ui")
```

Pick a free combination: `omarchy menu keybindings --print` lists the ones in use. The shorter
`{ tui = "dayhand ui", focus = true }` form does not suit a command with an argument: it quotes
`dayhand ui` as one word, so the app id becomes `org.omarchy.dayhand ui` and never matches the window.

The window tiles like any other; `Super + T` floats it. To open it floating every time, use the
app id `TUI.float` instead (Omarchy floats that class), at the cost of the key also focusing
other floating TUIs.

## In the app

- Keys: `?` in the app, or `dayhand help ui` ([cli.md](cli.md#topic-ui)). `q` quits.
- The mouse selects and scrolls. Mouse reporting stops the terminal's own text selection;
  hold `Shift` while dragging to select anyway, or start `dayhand ui --no-mouse`.
- `E` opens `$VISUAL` or `$EDITOR` for a task's title and note, in the same window, and comes
  back when it closes.
- The screen refreshes every 12 seconds (`--interval`). Without a connection it keeps the last
  data, says so in red, and retries.

## Not checked

- No run on Omarchy or in a real Hyprland session: the entry, the binding and the theme
  colours above follow Omarchy's own scripts (`bin/omarchy-launch-or-focus-tui`,
  `bin/omarchy-launch-tui`, `bin/omarchy-tui-install`, `default/hypr/helpers.lua`, branch
  `quattro` at `cbd44ba`, read on 2026-10-23), not a test on the system.
- The keyring on Linux (Secret Service) is the same code path as for every `dayhand` command; it
  was not tried on Omarchy either.
- No reminders or notifications: `dayhand ui` shows the plan while it is open. Desktop
  notifications (`notify-send` from a systemd user timer) would be a separate addition.
