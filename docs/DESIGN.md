# Winglet design guide

How every screen in the app should look and read. When a screen disagrees with this file, the screen is wrong.

## Character

Premium, playful and light on its feet, in the spirit of the newest AI apps (Meta AI, Muse): a dark graphite canvas
lit by a soft, slowly drifting **aurora** in the bot's own colour, with **frosted glass** chrome floating over it. The
pets, the glow and the conversation carry the personality; text and navigation stay calm and sparse. Every feature
stays one or two taps away, but nothing shouts for attention.

- **Aurora** (`components/Aurora.tsx`, colours from `useAuroraColors(server)`): behind the landing (full strength),
  behind a chat (faint, top only) and behind every pushed screen's large title (`Screen` does this for you). Never
  behind long text at full strength. Holds still with reduced motion.
- **Glass** (`components/Glass.tsx`): floating chrome only — headers, the composer, sheets, toasts, floating pills.
  Lit top sheen and a light edge (`glassBorder`). Pass a `BlurTargetView` target for a real blur on Android.
- **Frosted cards**: `ListGroup`, `Card`, `Chip` and `SearchField` use `colors.card` / `colors.cardBorder`, a
  translucent pane that lets the glow through. Don't hand-roll `surface` cards.
- **Shape**: generous radii (cards 22, sheets and composer 28, pills everywhere for buttons and chips).
- **Motion**: springs (`spring.snappy` for taps, `spring.soft` for things that move into place), staggered
  `FadeInDown` for lists and cards arriving, a gentle float on the pet. Haptics on every meaningful tap.
- **Type**: Inter. `type.hero` for the landing greeting, `type.display` for screen titles, then the regular scale.
- **Colour**: one accent (the user's choice) for actions and your messages; the primary button is a soft accent
  gradient. State colours only for state.

## Words

- A screen title names the place. It does **not** get a paragraph under it. If a screen needs one sentence of
  explanation, put it as a `Footnote` under the group it explains, and keep it to one line where possible.
- A list row has a title. It gets a subtitle only when the subtitle carries **live information** (a value, a state,
  a count, a warning) or the row is a switch whose effect isn't obvious from its title. Never a description of what
  the destination page contains ("Who it is and how it talks", "Tokens and cost").
- Values go on the right (`value`), not in a subtitle.
- Sentence case everywhere. No ALL-CAPS labels. Buttons say exactly what they do ("Save", "Restart server").
- Empty states: one short line saying what will appear here, plus the action that creates it when there is one.

## Structure

- **Pushed screen** (`Screen`): a sticky top bar with a plain back arrow (and optional actions on the right), then a
  large left-aligned title that scrolls with the content. When the large title scrolls away, the small title fades
  into the top bar. Content column max 680 wide, 16 side padding.
- **Top-level views** (chat, landing): `NavigationHeader` — sidebar button (panel icon, never "⋯"), left-aligned
  title, actions on the right. "⋯" means *more options for this thing* and nothing else.
- **Groups**: `SectionHeader` (small, sentence case, secondary colour) then one `ListGroup` card of rows divided by
  inset hairlines. Don't wrap a single row in its own card unless it's alone in its section.
- **Rows**: icon (plain line icon, secondary colour, no tinted tile), title, optional value, chevron when it navigates.
  Colour an icon only for state (`iconColor` = success / warning / danger).
- **Sheets**: title is the name of what you're choosing or acting on. Actions are rows; settings (switches) never sit
  between actions — put them under a separator at the end.

## Tokens (see `app/src/lib/theme.ts`)

| | |
|---|---|
| Dark surfaces | graphite `bg #09090B`, `surface #131316`, raised/sunken `#1A1A1F`, high `#26262D`, hairlines white 8% / 14% |
| Light surfaces | `bg #F5F5F7`, `surface #FFFFFF`, sunken `#ECECF1` |
| Type | Inter. largeTitle 28/34 bold, title 22/28, heading 17/22, body 16/23, callout 14.5/20, footnote 13/18, caption 12.5/16 |
| Radius | 8 / 12 / 16 / 20 / 26 / pill |
| Spacing | 4 / 8 / 12 / 16 / 24 / 32; page padding 16; section gap 24 |
| Touch | 48dp minimum target |

Primary buttons are a flat accent fill. Your message bubble is a flat accent fill with a 6dp corner on its tail.
No decorative gradients or glows outside the pets.

## Chat

- Assistant replies are flat (no bubble) under a small identity line (face, name, time) shown once per group.
- Copy / reply / more actions show under the **latest** reply only; every other message gets them by long-press
  (touch) or hover (mouse).
- Gateway progress notices ("⏳ Working …", "⚡ Stopped …") are status, not conversation: one muted line.
- Tool activity collapses into a single "N steps" pill.
