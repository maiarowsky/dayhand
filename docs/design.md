# Design system

Helm's Android app uses the visual language of Mussh (the owner's other app) so the two read
as one family: the same palettes, type scale, shapes, buttons, cards, fields and states. Helm keeps its own identity:
its name, its helm icon and its words. No Mussh name, logo or icon is used.

The code lives in `android/app/src/main/java/dev/helm/planner/ui/theme/` (tokens) and `ui/components/` (shared
components). Screens use only these: no raw colours, no `MaterialTheme.colorScheme` lookups and no ad-hoc shapes.

## Rules

1. **Roles, not colours.** A screen asks for `palette.text`, `palette.accent`, `palette.dangerSoft`… never for a hex
   value. Material components get a scheme built from the same roles (`colorScheme(palette)`), so fields, switches,
   dialogs, menus and pickers match.
2. **One palette is light or dark.** The user picks a dark palette and a light palette and a mode (system, light,
   dark); the mode decides which one shows. The status and navigation bar icons follow the palette.
3. **Text contrast.** Text and muted text have at least 4.5:1 on the background, cards and every soft background;
   the accent, danger and secondary colours have at least 4.5:1 on the background; faint text (hints, decoration
   only) at least 3:1. `PaletteContrastTest` checks every palette.
4. **Type follows the system size.** Every size is in sp. Anything that holds text has a minimum height, never a
   fixed one, and rows put their value under the name from font scale 1.5 (`LARGE_TEXT_SCALE`).
5. **Touch targets of at least 48 × 48 dp**, also for icon buttons (Material's `IconButton` has a 40 dp clickable
   circle, so Helm uses `HeaderIconButton`). Every icon-only control has a description for screen readers.
6. **One primary action per screen** (the accent pill). Secondary actions are tinted pills, minor ones text actions.
7. **Change applies at once.** The appearance is a `StateFlow`; saving it redraws the whole app without a restart and
   it is read synchronously at start, so the first frame has the right colours.

## Mussh → Helm

| Mussh (Android) | Helm | Notes |
|---|---|---|
| `ui.Palette` (roles) | `ui.theme.Palette` | Same roles and values minus the chat, code and agent roles Helm has no use for (`userBubble`, `code*`, `toolSurface`, `vivid*`, `blocked`, `idle`, `unknown`, `inlineCode`, `quoteBar`). Mussh `working` is Helm "Now", `done` is done, `attention`/`danger` is overdue. |
| `Palettes.all` (16) and `PaletteThemes` | `Palettes`, `PaletteThemes` | Same 16 palettes, ids and values: dark Terracotta (default), Honey, Amber, Gruvbox Dark, Solarized Dark, Nord, Dracula, Tokyo Night, Catppuccin Mocha, One Dark, Rosé Pine; light Paper (default), Gruvbox Light, Solarized Light, Catppuccin Latte, Rosé Pine Dawn. Generated from the Mussh sources, not retyped. |
| One palette for the whole app | Dark palette + light palette + mode | Mussh has no light/dark mode; Helm needs one, so it keeps one choice per variant. |
| `AppTheme`, `LocalPalette`, `palette` | `HelmTheme(appearance)`, `LocalPalette`, `palette` | Plus `LocalHelmType`/`helmType`, the Material type scale and shapes. |
| `colorScheme(palette)` | `colorScheme(palette)` | Same mapping, also the Material 1.4 container roles. |
| `AppType` (Headline 30, Title 18, Body 15, Small 13, Label mono 12 / 2 sp tracking) | `HelmType` | Same sizes and weights, in the chosen font; adds `screenTitle` (22 sp, Mussh's settings title) and the strong variants. |
| `ChatFont` (System, Inter, IBM Plex Sans, Atkinson Hyperlegible, Geist, Source Serif 4, JetBrains Mono) | `HelmFont` | Same list and ids, for the whole app; default System like Mussh's screens. The ten code fonts are terminal-only in Mussh and not used. Mussh has no font import, so Helm has none. |
| `CardShape` 20 dp, option 16 dp, field 14 dp, icon tile 14 dp, swatch 12 dp, badge 8 dp, pills round | `HelmShapes` | Same radii; also the Material `Shapes`. |
| `AccentButton` (56 dp accent pill) | `PrimaryButton` | Minimum height instead of a fixed one, optional icon. |
| `GhostButton` (12 % tinted pill) | `SecondaryButton` | At least 48 dp high. |
| `TextButton` in dialogs | `TextAction` | Accent text, 48 dp. |
| `HeaderIconButton` / `BackButton` (48 dp) | `HeaderIconButton` | Material icons instead of Mussh's own drawings. |
| `IconButtonBox` (44 dp) | `HeaderIconButton` | 48 dp, Helm's minimum. |
| `FeatureCard`, `InfoCard`, cards on `surface` with 18 dp padding | `HelmCard` | |
| Settings section (muted `MonoLabel` over a card) | `CardSection` | Task details; Settings uses `ListGroup`. |
| `IconTile` | `IconTile` | |
| `MonoLabel` | `SectionLabel` | Also a heading for screen readers. |
| `Pill` | `Pill` | |
| `Segmented` | `Segmented` | A sunken track on the screen colour with a border, so it reads as one control on a card; the selected option on `accentSoft` with an accent border. |
| filter choice (pills) | `HelmChip` | Soft-accent pill with a tick when selected (not colour alone), 48 dp; `multiple` for checkbox groups (reminders, weekdays). |
| outlined action pill | `ActionChip` | Pick a day, add or remove a label; 48 dp, optional leading and trailing icon. |
| `SettingsSwitchRow` | `SwitchRow`, `helmSwitchColors()` | Same switch colours, one toggle for screen readers. |
| `fieldColors()` + `OutlinedTextField`, 14 dp | `HelmTextField`, `helmFieldColors()` | Radio buttons and checkboxes take `helmRadioColors()` / `helmCheckboxColors()`. |
| `SettingsPage` header (back + 22 sp title) | `ScreenHeader` | |
| Top-level screen title | `LargeHeader` | Headline 30 sp with a subtitle and actions (Today, Board). |
| Bottom navigation | `HelmTabBar`, `HelmTab` | Bar on `surface`, the selected tab in the accent on `accentSoft`. |
| Accent "new" button | `HelmFab` | Accent pill with the on-accent icon (Today, Board). |
| `SettingsGroup`, `SettingsRow`, `SettingsNote` | `ListGroup`, `ListRow`, `RowIcon`, `ListNote` | Accent section label; rows at least 64 dp with a 40 dp icon tile tinted by `IconTone` (accent for a setting, success, warning or danger for a state), the name with a line under it, a trailing control and an optional slot under the text; lines between rows start at the text. Settings is built from these. |
| `OptionRow` (palette and font choice) | `OptionCard` | |
| `AppearancePreview`, palette swatches, font sample "Aa ąę 0O il1" | `AppearancePreview`, `Swatches`, `FontOption` | Preview is a small Today screen in both chosen palettes. |
| Connection notice, `successSoft` result card | `StatusBanner(tone)` | Soft background per tone, text colour kept for contrast, read out when it changes. |
| Empty lists | `EmptyState` | Icon tile, sentence, primary action. |
| `MessageDialog` (`AlertDialog` on `surface`) | `HelmDialog` | Date and time pickers use the same card colour and text actions. |
| `ActionSheet` / long-press menu | `HelmMenu` | Dropdown on `surfaceRaised` with option corners. |
| `BottomSheet` | Quick add `ModalBottomSheet` | `surface`, 28 dp top corners, border-coloured handle. |
| Board cards, "Now" card | Material `Card` in palette roles | `surface` with option corners, the "Now" card on `accentSoft` with an accent label; labels in the secondary colour on its own tint. |
| Task history actor | `Pill` | The person in the secondary colour, the agent in `attention`. |
| Notification accent | `setColor(accent)` | The chosen palette's accent for the shade's light or dark look. |
| Spacing: 20 dp screen margin, 18 dp card padding, 12 dp between groups, 60 dp list rows | `HelmDimens` | List rows are 64 dp with 16 dp side padding and a 72 dp line inset. |

## Fonts and licenses

Every bundled font is an unmodified file from Mussh under the SIL Open Font License 1.1, which allows bundling and
redistribution with software, including open source and commercial software, as long as the font is not sold on its
own and the license goes with it. The license texts are in `android/app/src/main/assets/licenses/` and shown in
Settings → About → Open source licenses.

| Font | Version | Licence file |
|---|---|---|
| Inter | 4.001 | `Inter-OFL.txt` |
| IBM Plex Sans | 3.005 | `IBMPlexSans-OFL.txt` (Reserved Font Name "Plex") |
| Atkinson Hyperlegible | 1.006 | `AtkinsonHyperlegible-OFL.txt` |
| Geist | 1.800 | `Geist-OFL.txt` |
| Source Serif 4 | 4.005 | `SourceSerif4-OFL.txt` (Reserved Font Name "Source") |
| JetBrains Mono | 2.304 | `JetBrainsMono-OFL.txt` |

Only Regular and Bold are bundled (as in Mussh); medium and semibold weights use the nearest file. Reserved font
names only matter for modified fonts; Helm ships them unchanged.

## Adding a screen

Use `LargeHeader` or `ScreenHeader`, `HelmCard`/`ListGroup` for containers, `PrimaryButton` for the one main action,
`StatusBanner` for state and `EmptyState` when there is nothing to show. If a component is missing, add it to
`ui/components/` with the palette roles and a 48 dp target, then use it; do not style a single screen by hand.
