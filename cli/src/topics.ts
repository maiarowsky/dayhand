// `hlm help <topic>`: longer explanations that do not belong to one command.
// docs/cli.md includes the same texts.
import { WHEN_EXAMPLES } from "./when/parse.js";

const dates = `Dates (--due, hlm move, hlm list --due-before/--due-after, hlm when)

Dates are English phrases resolved in your time zone from the server settings
(hlm settings), not the computer's. The same phrase at the same moment always
gives the same day. Try one with: hlm when "<phrase>", or add --dry-run to a command.

  Days        today (tod), tomorrow (tmr), yesterday, day after tomorrow
  Weekdays    fri, friday, on mon: the first such day after today
              this fri: this week's (today included); next fri: next week's (weeks start on Monday)
  Periods     next week (its Monday), next month (the 1st), next year, weekend, next weekend
              eow / end of week (Sunday), eoww / end of work week (Friday),
              eom / end of month, eoy / end of year
  Relative    in 3 days, in a week, in 2 months, in 1 year, +3d, +2w, +1mo, +1y
              in 2 hours, in 30 min, +3h: a day and a time
  Calendar    23 oct, 23rd of october, oct 23, oct 23 2027, the 15th, 2026-10-23
              (without a year: the next such day, today included)
  Times       14:00, 9:30, 2pm, 2:30 pm, at 9, noon, midnight
              alone: today, or tomorrow once that time has passed
  Together    tomorrow at 9am, fri 14:30, 9am tomorrow, at 3pm on friday, in 3 days at 8:15

A time that does not exist because the clocks go forward (01:30 on the last
Sunday of March in London) moves forward by the gap (to 02:30) with a warning.
YYYY-MM-DD, today and tomorrow are sent to the server as typed; every other
phrase is sent as YYYY-MM-DD (and HH:MM). Anything else is refused (exit 2),
never guessed.

Examples: ${WHEN_EXAMPLES.join(", ")}
`;

const config = `Configuration (config.toml)

The file lives in:
  Linux     $XDG_CONFIG_HOME/hlm/config.toml (~/.config/hlm/config.toml)
  macOS     ~/Library/Application Support/hlm/config.toml
  Windows   %APPDATA%\\hlm\\config.toml
or in $HLM_CONFIG_DIR. hlm whoami prints the one in use. hlm login creates it.

  url = "https://<deployment>.convex.site"     # used when no profile is chosen
  default_profile = "personal"

  [profiles.personal]
  url = "https://<deployment>.convex.site"

  [profiles.work]
  url = "https://<other>.convex.site"

  [aliases]
  home = "list -l home --status todo,doing"    # hlm home --json
  week = "list --due-before eow"

  [ui]
  color = "auto"                               # auto, always or never

Precedence. URL: --url, the profile named by --profile, HLM_URL, the profile from
HLM_PROFILE or default_profile, then the top-level url. Key: HLM_API_KEY, then the
key hlm login stored for that URL. Colors: --color/--no-color, [ui] color,
NO_COLOR/FORCE_COLOR, then whether the output is a terminal.

The API key never goes into this file: hlm refuses keys named api_key, key,
token, secret or password. An unknown key or a wrong value is an error that names
the file and the key (exit 2). Aliases cannot hide a built-in command.
`;

const login = `Signing in (hlm login, hlm logout, hlm whoami)

  hlm login --url https://<deployment>.convex.site   # paste the key at the hidden prompt
  hlm login --with-key < key.txt                     # or pipe it (scripts)
  hlm whoami                                         # URL, profile, where the key came from
  hlm logout

Create the key in the app (Settings → API keys, kind cli) or with
npx convex run apiKeys:create. hlm login checks it against the server, then stores
it for that URL in the OS keychain: macOS Keychain, Windows Credential Manager or
the Secret Service on Linux (GNOME Keyring, KWallet, KeePassXC). Without one (a
server, Omarchy without a keyring daemon) it says so and keeps the key in
credentials.json next to config.toml, readable only by you (mode 0600).
HLM_CREDENTIAL_STORE=file or --store file chooses the file on purpose.

HLM_API_KEY, when set, wins over the stored key: give agents and CI their own key
(kind agent) that way. The keychain keeps the key out of dotfiles, backups and shell
history; it does not hide it from programs running as you.
`;

const completion = `Shell completion (hlm completion <shell>)

  bash         echo 'source <(hlm completion bash)' >> ~/.bashrc
  zsh          hlm completion zsh > "\${fpath[1]}/_hlm"     (or source <(hlm completion zsh) after compinit)
  fish         hlm completion fish > ~/.config/fish/completions/hlm.fish
  PowerShell   hlm completion powershell | Out-String | Invoke-Expression   (add it to $PROFILE)

Completes commands, aliases from config.toml, options and their values, task
numbers with their titles, labels, profiles and date words. Task numbers and
labels come from one list_all call, cached for 60 seconds in the cache folder
(~/.cache/hlm, ~/Library/Caches/hlm or %LOCALAPPDATA%\\hlm\\Cache). Completion
never prompts and prints nothing when it cannot reach the server.
`;

export const TOPICS: Record<string, string> = { dates, config, login, completion };
