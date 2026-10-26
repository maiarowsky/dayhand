# Design system

Dayhand's Android app uses the visual language of Mussh (the owner's other app) so the two read
as one family: the same palettes, type scale, shapes, buttons, cards, fields and states. Dayhand keeps its own identity:
its name, its own icon and its words. No Mussh name, logo or icon is used.

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
   circle, so Dayhand uses `HeaderIconButton`). Every icon-only control has a description for screen readers.
6. **One primary action per screen** (the accent pill). Secondary actions are tinted pills, minor ones text actions.
7. **Change applies at once.** The appearance is a `StateFlow`; saving it redraws the whole app without a restart and
   it is read synchronously at start, so the first frame has the right colours.

## Project colours

A project's colour is one of twelve named tokens the server stores: `red`, `orange`, `amber`, `green`, `teal`,
`cyan`, `blue`, `indigo`, `purple`, `pink`, `brown` and `gray` (`PROJECT_COLORS` in
`backend/convex/lib/validators.ts`), or none. The server never stores a hex value, so each app picks shades that
suit its own backgrounds.

- **Contrast of 3:1.** A project's dot is a graphic, so it needs at least 3:1 against what it sits on (WCAG
  1.4.11). Android starts from a light and a dark base shade for each token (`ui/theme/ProjectColors.kt`) and
  moves it towards the palette's text colour until it reaches 3.1:1 on `surface`, `background`, `accentSoft` and
  `surfaceRaised`; `PaletteContrastTest` checks every token on every palette. The Mac app has one shade for the
  light and one for the dark appearance (`macos/Sources/DayhandUI/ProjectColors.swift`), checked against the
  window and the cards in both by `SidebarTests`. A project without a colour, and on Android an archived one,
  gets an outline instead of a filled dot.
- **Never colour alone.** The project's name is always written next to its dot or emoji, and screen readers
  read the name, not the colour. The dot colour is never used for text.

## Mussh → Dayhand

| Mussh (Android) | Dayhand | Notes |
|---|---|---|
| `ui.Palette` (roles) | `ui.theme.Palette` | Same roles and values minus the chat, code and agent roles Dayhand has no use for (`userBubble`, `code*`, `toolSurface`, `vivid*`, `blocked`, `idle`, `unknown`, `inlineCode`, `quoteBar`). Mussh `working` is Dayhand "Now", `done` is done, `attention`/`danger` is overdue. |
| `Palettes.all` (16) and `PaletteThemes` | `Palettes`, `PaletteThemes` | Same 16 palettes, ids and values: dark Terracotta (default), Honey, Amber, Gruvbox Dark, Solarized Dark, Nord, Dracula, Tokyo Night, Catppuccin Mocha, One Dark, Rosé Pine; light Paper (default), Gruvbox Light, Solarized Light, Catppuccin Latte, Rosé Pine Dawn. Generated from the Mussh sources, not retyped. |
| One palette for the whole app | Dark palette + light palette + mode | Mussh has no light/dark mode; Dayhand needs one, so it keeps one choice per variant. |
| `AppTheme`, `LocalPalette`, `palette` | `HelmTheme(appearance)`, `LocalPalette`, `palette` | Plus `LocalHelmType`/`helmType`, the Material type scale and shapes. |
| `colorScheme(palette)` | `colorScheme(palette)` | Same mapping, also the Material 1.4 container roles. |
| `AppType` (Headline 30, Title 18, Body 15, Small 13, Label mono 12 / 2 sp tracking) | `HelmType` | Same sizes and weights, in the chosen font; adds `screenTitle` (22 sp, Mussh's settings title) and the strong variants. Settings use it in the system sans whatever the font, as Mussh's settings do (`SettingsType`). |
| `ChatFont` (System, Inter, IBM Plex Sans, Atkinson Hyperlegible, Geist, Source Serif 4, JetBrains Mono) | `HelmFont` | Same list and ids, for the whole app; default System like Mussh's screens. The ten code fonts are terminal-only in Mussh and not used. Mussh has no font import, so Dayhand has none. |
| `CardShape` 20 dp, option 16 dp, field 14 dp, icon tile 14 dp, swatch 12 dp, badge 8 dp, pills round | `HelmShapes` | Same radii; also the Material `Shapes`. |
| `AccentButton` (56 dp accent pill) | `PrimaryButton` | Minimum height instead of a fixed one, optional icon. |
| `GhostButton` (12 % tinted pill) | `SecondaryButton` | At least 48 dp high. |
| `TextButton` in dialogs | `TextAction` | Accent text, 48 dp. |
| `HeaderIconButton` / `BackButton` (48 dp) | `HeaderIconButton` | Material icons instead of Mussh's own drawings. |
| `IconButtonBox` (44 dp) | `HeaderIconButton` | 48 dp, Dayhand's minimum. |
| `FeatureCard`, `InfoCard`, cards on `surface` with 18 dp padding | `HelmCard` | |
| Settings section (muted `MonoLabel` over a card) | `CardSection` | Task details; Settings uses `ListGroup`. |
| `IconTile` | `IconTile` | |
| `MonoLabel` | `SectionLabel` | Also a heading for screen readers. |
| `Pill` | `Pill` | |
| filter choice (pills) | `HelmChip` | Soft-accent pill with a tick when selected (not colour alone), 48 dp; `multiple` for checkbox groups (weekdays). |
| outlined action pill | `ActionChip` | Pick a day, add or remove a label; 48 dp, optional leading and trailing icon. |
| `SettingsSwitchRow` | `SwitchRow`, `helmSwitchColors()` | Same switch colours, one toggle for screen readers. |
| `fieldColors()` + `OutlinedTextField`, 14 dp | `HelmTextField`, `helmFieldColors()` | Radio buttons and checkboxes take `helmRadioColors()` / `helmCheckboxColors()`. |
| `SettingsPage` (back + 22 sp title, scrolling column, pinned preview) | `ScreenHeader`, `SettingsPage` | `SettingsPage` is the Settings list and each of its pages. |
| Top-level screen title | `LargeHeader` | Headline 30 sp with a subtitle and actions (Today, Board). |
| Bottom navigation | `HelmTabBar`, `HelmTab` | Bar on `surface`, the selected tab in the accent on `accentSoft`. |
| Accent "new" button | `HelmFab` | Accent pill with the on-accent icon (Today, Board). |
| `SettingsGroup`, `SettingsRow`, `SettingsNote`, `SettingsIcon` | `ListGroup`, `ListRow`, `ChoiceRow`, `ListNote`, `LineIcon` | Muted upper-case label over a 20 dp card on `surface`, rows split by thin full-width lines. A row is at least 60 dp: a 22 dp outline icon (no tile, no state colour), the name, a short muted value (at most 190 dp) and a thin "›"; an optional muted note under the name or a control at the end. From font scale 1.5 the value goes under the name. `ChoiceRow` is a choice with an accent check mark. Settings is built from these: one row per setting, each opening its page. |
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
names only matter for modified fonts; Dayhand ships them unchanged.

## Adding a screen

Use `LargeHeader` or `ScreenHeader`, `HelmCard`/`ListGroup` for containers, `PrimaryButton` for the one main action,
`StatusBanner` for state and `EmptyState` when there is nothing to show. If a component is missing, add it to
`ui/components/` with the palette roles and a 48 dp target, then use it; do not style a single screen by hand.
