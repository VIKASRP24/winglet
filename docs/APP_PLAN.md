# Winglet app plan: v0.1.3 → v0.6

**Goal: everything you normally do with Hermes, from your phone, without opening the server.**

This is the working plan for the next releases. It covers the look and feel, the features, and the
server-side work each feature needs. Every item has a priority, every milestone is split into small
PRs, and every PR has acceptance criteria. Review it, change what you disagree with, and we build it
in order.

Priorities used throughout:

| Tag | Meaning |
| --- | --- |
| **P0** | Must have. The app feels broken or incomplete without it. |
| **P1** | Should have. Part of "no SSH needed". |
| **P2** | Nice to have. Adds polish or covers rarer tasks. |
| **P3** | Later. Large, risky, or depends on Hermes features that are still moving. |

---

## 1. What "done" looks like

From the app alone, you can:

1. Chat with Hermes, send it photos, files and voice notes, and get them back.
2. See what the agent is doing right now, step by step, without a flood of messages.
3. Switch the model for one chat, or change the default, and set reasoning effort.
4. Add a new model provider (API key, sign-in, or a custom endpoint) and use it.
5. Read and edit the agent's persona and memory.
6. Give the agent a pet that reacts to what it's doing.
7. Create, pause and run scheduled tasks and long-running goals.
8. Install and toggle skills, tools and MCP servers.
9. Check server health, restart Hermes, update Hermes and Winglet, and read logs.
10. Pair a new phone and remove old ones.

Anything that still needs a terminal after v0.6 should be the exception, not the rule.

---

## 2. Where we are (v0.1.2)

Works today: pairing by QR, multiple bots, streaming chat with Markdown, files and images *from* the
agent, inbox with approvals and questions, Web Push and ntfy notifications, the automatic HTTPS
tunnel, and Android address recovery.

Gaps found while reviewing the code:

| Gap | Where |
| --- | --- |
| Agent replies can't be selected or copied. Only code blocks are selectable. | `app/src/components/Markdown.tsx` |
| You can't send photos or files. There's no attach button and no upload endpoint. | `ChatView.tsx` composer, `plugin/hub.py` routes |
| Tool progress arrives as ordinary agent messages, so long tasks flood the chat. | `plugin/adapter.py` `send`/`edit_message` |
| Images are cropped to 280×200 and can't be opened full screen. | `ChatView.tsx` |
| One fixed dark palette. Colors are static constants used in about 200 places across 13 files, so there's no light theme or theme switching. | `app/src/lib/theme.ts` |
| No animation or gesture library. The app uses the basic built-in `Animated` API only. | `app/package.json` |
| After a server restart, the app only checks for the new address on its normal retry timer, which backs off to 30 seconds. Reconnecting feels slow. | `app/src/lib/store.ts` `Connection.retry/recover` |
| Model, provider, persona, schedule, skills, logs and pairing all need the server's terminal. | n/a |

---

## 3. Design direction

### 3.1 Personality

A friendly personal agent, not a dashboard. The agent has a face (its pet). The home screen tells you
what it's doing and what it needs from you. Surfaces are calm, shapes are soft and rounded, and
motion is lively but quick.

Power-user details stay: a rail of bots on wide screens, `#` side chats, a slash-command palette,
and an optional compact message layout. These are accents, not the main look.

### 3.2 Themes

Three options in Settings → Appearance: **Light**, **Dark**, and **System** (follows the phone).

- **Dark is true black** (`#000000`) for OLED screens. Elevation comes from subtle borders and
  slightly lighter surfaces, not grey backgrounds.
- **Accent color** is selectable. Five presets: Iris (default), Ocean, Mint, Sunset, Rose. Each
  preset defines a solid color, a soft tint and a two-stop gradient.
- **Per-bot color.** Each bot keeps its own color (already derived from its name in `botColor`),
  used for its avatar ring and name.

Semantic tokens (names, not raw hex values, are used everywhere in the code):

| Token | Light | Dark (true black) |
| --- | --- | --- |
| `bg` | `#F6F6F9` | `#000000` |
| `surface` | `#FFFFFF` | `#0B0B0D` |
| `surfaceRaised` | `#FFFFFF` + shadow | `#141417` |
| `glass` | `rgba(255,255,255,0.62)` + blur | `rgba(22,22,26,0.58)` + blur |
| `glassBorder` | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.08)` |
| `text` | `#0B0B0F` | `#F5F5F7` |
| `textSecondary` | `#55555F` | `#A1A1AA` |
| `textTertiary` | `#8A8A94` | `#6B6B73` |
| `accent` (Iris) | `#6C5CE7` | `#8B7CFF` |
| `accentSoft` | accent at 12% | accent at 18% |
| `success` / `warning` / `danger` | `#16A34A` / `#D97706` / `#DC2626` | `#22C55E` / `#F59E0B` / `#F43F5E` |
| `userBubble` | accent gradient | accent gradient |
| `agentBubble` | none (unboxed) | none (unboxed) |
| `codeBg` | `#F1F1F5` | `#0F0F12` |

Exact values get tuned with screenshots in PR M1-1. Every text/background pair must pass WCAG AA in
both themes.

### 3.3 Glass

Use frosted glass for floating chrome only: the tab bar, headers once content scrolls under them,
the composer, sheets, context menus, toasts and the pet's speech bubble. Never put glass behind body
text.

- Android: `expo-blur` `BlurView`. If the blur is too slow on a given phone, fall back to a
  translucent tinted surface. There's also a "Reduce transparency" setting.
- iPhone and desktop (web): CSS `backdrop-filter`, which `expo-blur` maps to on web.
- On true-black dark mode, glass is a dark tint plus a hairline border, so it still reads as a layer.

### 3.4 Motion

Built on `react-native-reanimated` (springs and layout animations on the UI thread) and
`react-native-gesture-handler`.

| Preset | Use |
| --- | --- |
| `spring.snappy` (damping 20, stiffness 300) | Buttons, toggles, chips |
| `spring.soft` (damping 18, stiffness 180) | Sheets, cards, the pet |
| `duration.fast` 150 ms / `base` 250 ms / `slow` 400 ms | Fades, color changes |

Catalogue:

- Messages fade and rise 8 px on arrival. Your own message flies up from the composer.
- Pressables scale to 0.97 on press.
- Bottom sheets spring open and drag to dismiss. Context menus scale in from the pressed message,
  with the background blurred.
- Approval cards: swipe right to approve, left to deny, with a haptic at the threshold.
- Activity card: steps tick in. The spinner turns into a check.
- Typing indicator: the pet's run animation (falls back to animated dots).
- Shimmering skeleton placeholders while lists load. Pull-to-refresh shows the pet.
- Tab bar: the selected icon springs, and the pill indicator slides between tabs.
- Goal completed: one short confetti burst.

"Reduce motion" (system setting, plus an in-app toggle) turns springs into fades and switches off
confetti and pet roaming.

### 3.5 Haptics

`expo-haptics` (already installed) behind one `haptics.ts` map so every screen feels the same:

| Moment | Haptic |
| --- | --- |
| Tab switch, picker change, chip toggle | `selection` |
| Send message, open context menu | `impact light` |
| Swipe passes the approve/deny threshold | `impact medium` |
| Approval approved, task or goal completed | `notification success` |
| Denied, or an action failed | `notification error` |
| Pull-to-refresh triggers | `impact soft` |

Settings → Appearance has a haptics on/off switch. iPhone web apps can't vibrate (Safari has no
Vibration API), so haptics are Android-only. That's a platform limit, not a bug.

### 3.6 Shape and type

- Radii: 12 (chips), 16 (cards), 22 (sheets), 28 (composer). Avatars are squircles.
- Inter stays. Headings get tighter tracking; body text stays at 16 for readability.
  The app follows the phone's font-size setting.

### 3.7 Message layout

Two layouts in Settings → Appearance → Chat layout:

- **Bubbles (default).** Your messages are right-aligned accent bubbles. Agent replies are
  full-width, unboxed text next to the pet avatar. Best for reading long answers on a phone.
- **Compact.** The current layout: everything left-aligned with avatar, name and time headers and
  grouped follow-ups. Denser; good on desktop.

---

## 4. App structure

### 4.1 Phone

A glass tab bar with four tabs. A bot switcher (avatar plus name) sits at the top of each tab.
Tapping it shows your bots and "Add a bot".

| Tab | Contents |
| --- | --- |
| **Home** | The pet, large, with a status line ("Working on: …", "Waiting for you", "Idle"). "Needs you" cards (approvals, questions). Running tasks. Goal progress. Next scheduled tasks. Recent updates. A quick composer that posts to the main chat. |
| **Chats** | The main chat pinned at the top, then side chats (`#` channels) with previews and times. Search. New chat. |
| **Inbox** | Approvals, questions and routine results. Mostly exists today. Gains swipe actions and filters. |
| **Agent** | **Brain**: model, reasoning, providers, usage. **Identity**: pet, name, persona, memory. **Automations**: goals, schedule. **Abilities**: skills, tools, MCP. **Server**: health, updates, logs, devices, connection. **Settings**: appearance, notifications, security, about. |

### 4.2 Tablet and desktop (wide layout)

Keep the current three columns (bot rail, chat list, chat), restyled with the new tokens. Add an
optional right panel showing the agent card (pet, model chip, status, active goal) and a list of
the files in the current chat.

---

## 5. Architecture

### 5.1 App foundations

| Piece | Choice | Notes |
| --- | --- | --- |
| Theme engine | `ThemeProvider` + `useTheme()` + `makeStyles(theme => …)` | Replaces static `colors` imports. Saves the preference with `storage.ts`. Updates the status bar and Android navigation bar (`expo-system-ui`) and the PWA `theme-color`. |
| Motion | `react-native-reanimated`, `react-native-gesture-handler` | Installed with `npx expo install` so the versions match the Expo SDK. |
| Sheets | `@gorhom/bottom-sheet` | Model picker, chat menu, attach menu, confirm dialogs. |
| Glass | `expo-blur` behind one `<Glass>` component | Handles the fallback in one place. |
| Media | `expo-image-picker`, `expo-document-picker`, `expo-image-manipulator`, `expo-audio`, `expo-video`, `expo-sharing`, `expo-file-system` | Upload, resize/HEIC→JPEG, voice notes, playback, sharing. |
| Security | `expo-local-authentication` | Optional fingerprint/face check before sensitive actions. |
| QR display | `react-native-qrcode-svg` | Pair another device from the app. |
| Syntax highlighting | A small highlighter with about 15 common languages | Keep the bundle small. Pick one that runs without a WebView. |

New shared components: `Glass`, `Sheet`, `ContextMenu`, `Segmented`, `Chip`, `Skeleton`, `Toast`
(restyled), `PetSprite`, `ModelChip`, `ActivityCard`, `AttachmentTile`, `MediaViewer`.

### 5.2 Plugin foundations

1. **`plugin/hermes_api.py` compatibility layer.** Every import of Hermes internals (`hermes_cli.*`,
   `agent.*`, `cron.*`, `gateway.*`) lives here, wrapped so a missing or changed function disables
   one feature instead of crashing the plugin. Hermes changes quickly, so this is the most
   important rule in the plan.
2. **Capability flags.** `/api/info` gains `features: {uploads: true, model_picker: true, pets: true, …}`
   and `hermes_version`. The app hides anything the server doesn't support and says why ("Update
   Winglet on the server to use this").
3. **Device roles.** `owner` (full control) and `member` (chat, inbox and approvals only). Existing
   devices become owners on upgrade, so nothing breaks. All server-control endpoints require
   `owner`.
4. **Audit log.** Every control action (model change, key added, restart, update, device removed,
   schedule change) is written to the store with the device name and time, and shown under Agent →
   Server → Activity.
5. **Sealed secrets.** In quick-tunnel mode Cloudflare can read traffic. API keys must not cross it
   in plain text. The server gets an X25519 key pair at setup, and the pairing QR carries its
   fingerprint. The app encrypts secrets to that key (`@noble/curves` + `@noble/ciphers`, already
   used for recovery) and the server decrypts them. Devices paired before this change pin the key on
   first use and show a "re-pair for the strongest protection" hint. Secrets are write-only: the API
   never returns them, only "set" plus the last 4 characters.
6. **Job runner.** Long actions (Hermes update, pet hatch, plugin update, skill install) run as
   background jobs with progress events over the WebSocket, so the app can show progress and
   survive reconnects.

### 5.3 Using Hermes's own hooks

Hermes already lets chat platforms draw native UI for some commands. Telegram, Slack and Matrix use
these hooks. Winglet implements the same ones, so the behaviour, validation and permissions stay
Hermes's own:

| Hook (on the adapter) | Called by | Winglet renders |
| --- | --- | --- |
| `send_model_picker(chat_id, providers, current_model, current_provider, session_key, on_model_selected, metadata)` | `/model` with no arguments (`gateway/slash_commands_model.py`) | Bottom sheet: provider → model, search, current model marked. Selecting calls `on_model_selected`. |
| `send_choice_picker(chat_id, title, choices, session_key, on_choice_selected, metadata)` | `/reasoning`, `/fast` | Segmented control or option list in a sheet. |
| `send_slash_confirm(chat_id, title, message, session_key, confirm_id, metadata)` | Commands that need confirmation, such as `/reload-mcp` | Confirm sheet: Once / Always / Cancel. |
| `send_or_update_status(chat_id, status_key, content, metadata=…)` | Status and lifecycle messages (context pressure, compression, fallback) | One status line edited in place instead of new bubbles. |
| `send_exec_approval` (done), `send_clarify` (done) | Approvals, questions | Existing inbox cards. |

Pickers are stored like inbox items (`kind: "picker"`) with the callback held in memory. They expire
after 10 minutes or on restart, falling back to Hermes's text reply.

For everything else, the plugin calls the same library functions Hermes's own dashboard uses. Exact
references are in Appendix A.

### 5.4 Testing

- **Plugin:** pytest for every new endpoint, including permission checks (member vs owner), oversized
  uploads, path traversal and secret redaction.
- **Compatibility:** a CI job that installs the latest Hermes release and runs the plugin tests
  against it, so internal API changes are caught before users hit them.
- **End-to-end:** move the fake-model gateway harness used during development into `tests/e2e/`. It
  drives a real Hermes gateway with a scripted model, and covers uploads, pickers and approvals.
- **Visual:** Playwright screenshots of the web build in light and dark for each PR that changes
  UI, attached to the PR.
- **Device check:** each milestone is tried on a real Android phone (blur performance, haptics,
  camera, voice) before release.

---

## 6. Feature catalogue

### 6.1 Look and feel

| ID | Feature | Pri | Milestone |
| --- | --- | --- | --- |
| L1 | Theme engine with semantic tokens | P0 | M1 |
| L2 | Light, true-black Dark, System | P0 | M1 |
| L3 | Accent color presets | P1 | M1 |
| L4 | Glass chrome (tab bar, headers, composer, sheets, menus) with fallback | P0 | M1 |
| L5 | Motion system and animation catalogue (3.4) | P0 | M1 (base), then each milestone |
| L6 | Haptics map and on/off switch | P0 | M1 |
| L7 | New navigation: tab bar, bot switcher, Home | P0 | M1 |
| L8 | Bubbles / Compact chat layout | P1 | M1 |
| L9 | Skeleton loading, empty states, pull-to-refresh | P1 | M1 |
| L10 | Reduce motion / Reduce transparency | P1 | M1 |
| L11 | Alternate app icons (Android) | P3 | Later |

### 6.2 Chat

| ID | Feature | Pri | Milestone |
| --- | --- | --- | --- |
| C1 | Selectable agent text and a copy button on code blocks | P0 | M0 |
| C2 | Long-press menu: Copy, Reply, Retry, Edit last message, Share | P0 | M2 |
| C3 | Reply to a message (quoted context sent as Hermes `reply_to_text`) | P1 | M2 |
| C4 | Activity card: tool progress folded into one expandable card per turn | P0 | M2 |
| C5 | Jump-to-latest button with an unread count | P1 | M2 |
| C6 | Syntax highlighting, collapsible long code, better tables | P1 | M2 |
| C7 | Slash palette fed by the server (all gateway commands and skills, with hints) | P1 | M2 |
| C8 | While the agent works, choose: Steer now (`/steer`), Queue next (`/queue`), or Stop | P1 | M2 |
| C9 | Draft saved per chat | P2 | M2 |
| C10 | Message search (server full-text search) | P2 | M5 |
| C11 | Separate main chat and side chats, with "branch to side chat" | P2 | M5 |

### 6.3 Media

| ID | Feature | Pri | Milestone |
| --- | --- | --- | --- |
| U1 | Upload photos (camera, gallery, several at once) with progress and cancel | P0 | M2 |
| U2 | Upload files (any type, size limit set on the server) | P0 | M2 |
| U3 | Paste and drag-and-drop images on web/desktop | P1 | M2 |
| U4 | Full-screen image viewer: pinch-zoom, swipe to close, save, share | P0 | M2 |
| U5 | Voice notes: hold to record, transcribed by Hermes's speech-to-text | P1 | M2 |
| U6 | Inline audio player (agent voice replies) and video player | P1 | M2 |
| U7 | Files panel: everything shared in a chat | P2 | M5 |

### 6.4 Agent brain

| ID | Feature | Pri | Milestone |
| --- | --- | --- | --- |
| B1 | Model chip in the chat header showing the current model | P0 | M3 |
| B2 | Native model picker for this chat (`send_model_picker`) | P0 | M3 |
| B3 | Default model for new chats | P0 | M3 |
| B4 | Reasoning effort and fast mode pickers | P1 | M3 |
| B5 | Add a provider: API key, sign-in flow, custom OpenAI-compatible endpoint | P0 | M3 |
| B6 | Provider list with status; remove a provider | P1 | M3 |
| B7 | Usage and cost: tokens and spend by day and model | P2 | M3 |
| B8 | Fallback and auxiliary model slots | P3 | Later |

### 6.5 Identity and pets

| ID | Feature | Pri | Milestone |
| --- | --- | --- | --- |
| I1 | Pet as the agent's avatar, animated by what the agent is doing | P1 | M3 |
| I2 | Pet gallery: browse, install and choose a pet | P1 | M3 |
| I3 | Hatch a new pet from a description (needs an image-generation provider) | P2 | M5 |
| I4 | Floating pet companion with a speech bubble showing status | P2 | M5 |
| I5 | Persona editor (SOUL) and personality presets (`/personality`) | P1 | M3 |
| I6 | Memory viewer and editor; pending memory writes appear in the inbox | P1 | M3 |
| I7 | Bot display name and description from the app | P2 | M3 |

### 6.6 Automations

| ID | Feature | Pri | Milestone |
| --- | --- | --- | --- |
| A1 | Schedule: list, create (plain-language time), pause, resume, run now, run history | P1 | M4 |
| A2 | Goals: set, track progress, add subgoals, finish | P1 | M5 |
| A3 | Suggested automations (accept/dismiss) and blueprint templates | P2 | M5 |
| A4 | Heartbeat / loop prompts per chat | P3 | Later |

### 6.7 Abilities

| ID | Feature | Pri | Milestone |
| --- | --- | --- | --- |
| S1 | Skills: list, search, install, enable/disable, read | P1 | M4 |
| S2 | Toolsets: enable/disable; approval mode (with a strong warning for "always allow") | P1 | M4 |
| S3 | MCP servers: list, add from catalogue, enable/disable, sign in | P2 | M4 |

### 6.8 Server control

| ID | Feature | Pri | Milestone |
| --- | --- | --- | --- |
| R1 | Health: online/uptime, Hermes and Winglet versions, CPU/RAM/disk, connection mode | P0 | M4 |
| R2 | Restart Hermes (graceful, waits for running work) | P0 | M4 |
| R3 | Emergency stop: pause all work (`/pause`) | P1 | M4 |
| R4 | Update Hermes, with progress | P1 | M4 |
| R5 | Update Winglet plugin (Hermes's plugin updater), then restart | P1 | M4 |
| R6 | App update check (new APK on GitHub Releases) | P1 | M4 |
| R7 | Logs: live tail, level filter, search, share a redacted debug report | P1 | M4 |
| R8 | Activity (audit) log | P1 | M4 |
| R9 | Hermes sessions browser and search; open an old session in a chat | P2 | M5 |
| R10 | Workspace file browser: browse, download, upload | P2 | M5 |
| R11 | Backups: create and download | P2 | M5 |
| R12 | Terminal from the phone (off by default, owner only, biometric check) | P3 | Later |

### 6.9 Devices and connection

| ID | Feature | Pri | Milestone |
| --- | --- | --- | --- |
| D1 | Instant reconnect after a server restart | P0 | M0 |
| D2 | Pair another device from the app (shows a QR) | P0 | M4 |
| D3 | Devices list: rename, role, last seen, remove | P0 | M4 |
| D4 | Connection settings: mode, current address, status | P1 | M4 |
| D5 | Permanent address wizard (own domain via a named tunnel) | P3 | Later |
| D6 | iPhone address recovery | P3 | Later |
| D7 | App lock and biometric check for sensitive actions | P1 | M4 |

### 6.10 Already on the roadmap (unchanged, later)

| ID | Feature | Pri |
| --- | --- | --- |
| X1 | Live screen: watch and take over the agent's computer | P3 |
| X2 | Real-time voice call with the agent | P3 |
| X3 | Android home-screen widget (status and quick ask) | P3 |
| X4 | Smaller APK (one per CPU architecture, currently about 75 MB universal) | P2 |

---

## 7. Milestones and PRs

Each PR stays small enough to review in one sitting. Commits are short and focused. Each milestone
ends with a release.

### M0: Quick fixes (v0.1.3)

**PR M0-1: Instant reconnect.**
- While offline on Android, poll the recovery topic every 5 s for the first 2 minutes, then fall
  back to backoff. Also check immediately when the app returns to the foreground.
- Cap the reconnect backoff at 10 s while the app is visible (30 s in the background).
- Show "Finding <bot>'s new address…" instead of "offline — reconnecting".
- Acceptance: after `hermes gateway restart`, an open Android app reconnects within about 10 s of
  the tunnel coming up. Tested with the fake-model harness and a forced address change.

**PR M0-2: Copy text.**
- Agent message text becomes selectable. Code blocks get a copy button with a "Copied" toast.
- Acceptance: long-press selects text on Android and web, and the copy button copies the exact code
  block.

### M1: Foundations and the new look (v0.2.0)

M1 comes before the feature work because every later screen is built from these pieces. Doing the
redesign afterwards would mean styling everything twice.

**PR M1-1: Theme engine.**
- Semantic tokens (3.2), `ThemeProvider`, `useTheme`, `makeStyles`.
- Migrate all 13 files off static colors.
- Settings → Appearance: Light / Dark / System, plus accent presets.
- Acceptance: switching theme updates every screen live, including the status and navigation bars.
  No hard-coded hex values remain outside `theme.ts`. Screenshots in both themes.

**PR M1-2: Motion, gestures, haptics.**
- Add reanimated and gesture-handler; motion presets; `haptics.ts` map; reduce-motion support.
- Replace the existing `Animated` uses (cursor, typing dots).
- Acceptance: APK builds in CI, there are no visible frame drops on a mid-range Android phone, and
  reduce motion works.

**PR M1-3: Glass and core components.**
- `Glass` (with fallback), `Sheet`, `ContextMenu`, `Segmented`, `Chip`, `Skeleton`, restyled
  `Button`/`Row`/`Toast`.
- Acceptance: a hidden component gallery screen in development builds shows every component in both
  themes.

**PR M1-4: Navigation and Home.**
- Tab bar (Home, Chats, Inbox, Agent), bot switcher, and a first Home (pet placeholder, "needs you"
  cards, recent updates, quick composer). Agent tab with a placeholder for each section.
- Wide layout restyled.
- Acceptance: every existing feature is still reachable, deep links (`/chat/…`, `/inbox`, `/pair`)
  still work, and the back gesture works on Android.

**PR M1-5: Chat restyle.**
- Bubbles and Compact layouts, the new composer (glass, rounded, attach button stubbed), message
  enter animations, skeleton loading.
- Acceptance: long conversations scroll smoothly; streaming still works; screenshots in both
  layouts and themes.

### M2: Chat essentials (v0.3.0)

**PR M2-1: Uploads, server side.**
- `POST /api/chats/{id}/uploads` (multipart, streamed to disk, size limit, MIME check, safe names).
- Messages accept `attachments: [upload ids]`.
- The adapter builds a `MessageEvent` with `media_urls`/`media_types` using Hermes's
  `cache_media_bytes`, and sets `message_type` to PHOTO, DOCUMENT, VOICE or VIDEO.
- Acceptance: pytest covers limits, bad types and traversal. In the e2e harness the agent receives
  the image path.

**PR M2-2: Uploads, app side.**
- Attach sheet (Camera, Photos, Files). Thumbnails with progress and cancel. Resize large photos
  and convert HEIC to JPEG. Paste and drag-and-drop on web.
- Acceptance: send a photo from the gallery and the camera, and a PDF, on Android and on the iPhone
  web app.

**PR M2-3: Media viewer and players.**
- Full-screen viewer (zoom, swipe to close, save, share), image grid for several images, inline
  audio and video players.

**PR M2-4: Voice notes.**
- Hold the mic to record, slide to cancel, upload as VOICE so Hermes transcribes it. The
  transcript is shown under the voice note.
- Acceptance: works when speech-to-text is configured in Hermes; otherwise the app explains what's
  missing.

**PR M2-5: Message actions and replies.**
- Context menu (Copy, Reply, Retry, Edit last, Share). Reply quoting via `reply_to_text`.
  Syntax highlighting.

**PR M2-6: Activity card.**
- Short investigation first: the gateway sends tool progress through `adapter.send`/`edit_message`
  with no marker for this platform. Pick the most robust way to recognise it (progress
  metadata, the progress message format, or a small upstream Hermes change adding a
  platform-neutral marker; upstream is the best option).
- Render progress as one expandable card per turn: tool name, short argument, duration, status.
- Also implement `send_or_update_status` so status messages edit in place.
- Acceptance: a 10-tool turn shows one card, not 10 messages.

**PR M2-7: Composer upgrades.**
- Server-fed slash palette (`GET /api/commands`). Steer / Queue / Stop while busy.
  Jump-to-latest button. Drafts saved per chat.

### M3: Your agent (v0.4.0)

**PR M3-1: Native pickers.**
- Implement `send_model_picker`, `send_choice_picker` and `send_slash_confirm` in the adapter.
  Store pickers as items (`kind: "picker"`) and add `POST /api/pickers/{id}/select`.
- App: sheet UI and inline card. A hidden-command flag so tapping the model chip sends `/model`
  without showing a command bubble.
- Acceptance: switching the model from the chip changes the model for that chat only, through
  Hermes's own switch logic. `/reasoning` and `/fast` show option pickers.

**PR M3-2: Model chip and default model.**
- `GET /api/agent` returns the default model, reasoning, personality, pet and versions.
- The chat header shows the effective model. Investigate reading the session override through
  `hermes_api.py`; otherwise track switches made through the picker.
- Agent → Brain → Default model uses the same functions as Hermes's `/api/model/options` and
  `/api/model/set`, including the expensive-model confirmation.

**PR M3-3: Providers.**
- List providers with their status. Add an API key (sealed, validated before saving). Sign-in flows
  (the phone opens the provider's sign-in page; the app polls until it's done). Custom endpoint
  (base URL, key, model discovery). Remove a provider.
- Also adds the sealed-secrets key pair and the QR fingerprint (5.2 item 5).
- Acceptance: add an OpenRouter key from the phone, pick one of its models, and chat with it. The
  key never appears in any API response or log.

**PR M3-4: Identity.**
- Persona (SOUL) editor, personality picker, memory viewer and editor, pending memory writes as
  inbox items, bot name and description.

**PR M3-5: Pets.**
- Server: list installed pets, serve the spritesheet (signed, cached), browse the gallery, install,
  set active (`display.pet.slug`), remove.
- App: `PetSprite`. The sheet is a grid of 192×208 frames, 8×9 for current sheets or 9×8 for legacy
  ones, 6 frames per state, about 1.1 s per loop.
- State mapping follows Hermes's `derive_pet_state` priority: error → failed; goal or todo done →
  jump; reply finished → wave (2.5 s); waiting on an approval or question → waiting; tool running →
  run; reasoning → review; busy → run; otherwise idle.
- The pet replaces the bot avatar in the header and on Home, and the typing dots.
- Port the sprite logic from Hermes Desktop's `pet-sprite.tsx` (MIT, keep the notice).
- Acceptance: install a pet from the gallery on the phone and watch it switch states during a turn
  that runs tools and asks for an approval.

**PR M3-6: Usage.**
- Tokens and cost by day and model (charts), plus the `/usage` summary.

### M4: Control center (v0.5.0)

**PR M4-1: Roles, audit, app lock.**
- Device roles, audit log, biometric check before sensitive actions.

**PR M4-2: Devices.**
- Devices list (rename, role, last seen, remove). "Add a device" mints a pairing code and shows the
  QR on the phone.
- Acceptance: pair a second phone using only the first phone.

**PR M4-3: Health and lifecycle.**
- Health screen. Restart (graceful). Pause/resume all work. Update Hermes and update Winglet as
  background jobs with progress. App update check.
- Acceptance: update Winglet from the phone; the app reconnects and shows the new version.

**PR M4-4: Logs.**
- Live tail over the WebSocket, level filter, search, and a redacted debug report to share.

**PR M4-5: Schedule.**
- Scheduled tasks: list, create, edit, pause/resume, run now, run history, delivery to the Updates
  chat.

**PR M4-6: Skills, toolsets, MCP.**
- Skills (list, search, install, toggle, read), toolsets (toggle; approval mode with a warning),
  MCP servers (list, add, toggle, sign in).

**PR M4-7: Connection settings.**
- Mode, current address, tunnel status, notification setup in one place.

### M5: Automations and delight (v0.6.0)

Goals tab, suggested automations, hatching pets, the floating pet, Hermes sessions browser and
search, workspace files, backups, message search, files panel, branching side chats, and per-CPU
APKs.

### Later

Live screen, real-time voice, home-screen widget, phone terminal, permanent-address wizard, iPhone
address recovery, alternate icons, auxiliary model slots.

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Hermes internals change between releases | Everything goes through `hermes_api.py`, features are flagged, and CI tests against the latest Hermes. Prefer gateway hooks and slash commands (stable) over internal functions where both exist. |
| Server control over a quick tunnel | Owner role, sealed secrets, biometric check, audit log, and confirmation for destructive actions. Recommend a permanent address for heavy use. |
| Blur is slow on some Android phones | Fallback surface and a "Reduce transparency" setting. Test on a real device each milestone. |
| APK size (about 75 MB) grows with new libraries | Track size in CI; ship per-CPU APKs (X4). |
| iPhone web app limits (no haptics, address change needs re-pairing) | State it clearly in the app and README. Keep features working without haptics. |
| Scope creep | Ship in milestone order. Anything new goes into the catalogue with a priority first. |

---

## 9. Decisions needed

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | Default chat layout | Bubbles by default, Compact as an option. |
| 2 | Accent color | Iris (violet) by default, with presets. |
| 3 | Order | M0 → M1 → M2 → M3 → M4 → M5 as written. If uploads matter most, M2-1/M2-2 can move before M1-4. |
| 4 | Terminal from the phone | Leave it for later; most needs are covered by the agent plus approvals. |
| 5 | How important is iPhone? | Android first; keep the iPhone web app working, but don't block on its limits. |
| 6 | Hermes upstream change for tool progress | Open a small Hermes PR for a platform-neutral progress marker during M2-6. |

---

## Appendix A: Hermes integration map

Paths are relative to the Hermes repository. Dashboard routes are listed as reference
implementations to copy the logic from. Winglet calls the underlying functions, not the dashboard
over HTTP.

| Feature | Hermes mechanism | Reference |
| --- | --- | --- |
| Inbound photo/file/voice | `MessageEvent.media_urls`, `media_types`, `MessageType.PHOTO/DOCUMENT/VOICE/VIDEO`; `cache_media_bytes` | `gateway/platforms/event.py`, `gateway/platforms/base.py` |
| Voice transcription | Gateway speech-to-text on inbound VOICE | `gateway/run_inbound.py` |
| Reply context | `MessageEvent.reply_to_text`, `reply_to_message_id` | `gateway/platforms/event.py` |
| Model picker (per chat) | Adapter `send_model_picker` | `gateway/slash_commands_model.py` `_send_model_picker`; example `plugins/platforms/telegram/adapter.py` |
| Reasoning / fast pickers | Adapter `send_choice_picker` | `gateway/slash_commands_model.py` `_try_send_choice_picker` |
| Command confirmation | Adapter `send_slash_confirm` | `gateway/run_busy.py` |
| Status edited in place | Adapter `send_or_update_status` | `gateway/run.py` `_send_or_update_status_coro` |
| Model list / default model | `hermes_cli.inventory.build_model_options_payload`, `load_picker_context`; model assignment as in `POST /api/model/set` | `hermes_cli/web_routers/models.py` |
| Provider keys | `hermes_cli.config.save_env_value_secure`; validation as in `POST /api/providers/validate` | `hermes_cli/config.py`, `hermes_cli/web_routers/config_env.py` |
| Provider sign-in | Logic behind `/api/providers/oauth/{id}/start`, `/poll`, `/submit` | `hermes_cli/web_routers/oauth.py` |
| Custom endpoints | Logic behind `/api/providers/custom-endpoints` | `hermes_cli/web_routers/config_env.py` |
| Persona | Logic behind `GET/PUT /api/profiles/{name}/soul` | `hermes_cli/web_routers/profiles.py` |
| Memory | Logic behind `GET /api/memory`; `tools/memory_tool.py` | `hermes_cli/web_routers/ops.py`, `hermes_cli/web_server_memory.py` |
| Pets | `agent.pet.store` (`installed_pets`, `install_pet`, `resolve_active_pet`, `remove_pet`, `rename_pet`, `thumbnail_png`), `agent.pet.manifest`, `agent.pet.generate`, `agent.pet.state.derive_pet_state`; config `display.pet.slug` | `agent/pet/`; desktop renderer `apps/desktop/src/components/pet/` |
| Schedule | `cron/jobs.py`; routes `/api/cron/*` | `hermes_cli/web_routers/cron.py` |
| Goals | `/goal`, `/subgoal` gateway commands | `hermes_cli/commands.py` |
| Skills / toolsets / MCP | Logic behind `/api/skills*`, `/api/tools/toolsets*`, `/api/mcp/*` | `hermes_cli/web_routers/skills.py`, `tools.py`, `mcp.py` |
| Restart / pause / update Hermes | Gateway commands `/restart`, `/pause`, `/update` | `hermes_cli/commands.py` |
| Update Winglet plugin | `hermes_cli.plugins_cmd.dashboard_update_user_plugin` | `hermes_cli/web_routers/dashboard_ui.py` |
| Usage | Logic behind `/api/analytics/usage`, `/api/analytics/models`; `/usage` | `hermes_cli/web_routers/analytics.py` |
| System stats / update check | Logic behind `/api/system/stats`, `/api/hermes/update/check` | `hermes_cli/web_routers/status.py`, `actions.py` |
| Sessions and search | Logic behind `/api/sessions*` | `hermes_cli/web_routers/sessions.py` |
| Workspace files | Logic behind `/api/files*` | `hermes_cli/web_routers/files.py` |
| Slash command list | `hermes_cli.commands.COMMAND_REGISTRY` (`cli_only`, `gateway_config_gate`) | `hermes_cli/commands.py` |

## Appendix B: New plugin API (draft)

All routes need a paired device. Routes marked ★ need the `owner` role and are written to the audit
log.

```
POST   /api/chats/{id}/uploads                  multipart → {upload}
POST   /api/chats/{id}/messages                 + attachments[], reply_to, hidden
GET    /api/commands                            gateway commands + skills, with hints
POST   /api/pickers/{id}/select                 {value} or {provider, model}

GET    /api/agent                               model, reasoning, personality, pet, versions
GET    /api/models                              providers + models (options payload)
PUT    /api/models/default ★                    {provider, model, confirm?}
GET    /api/providers
POST   /api/providers/{id}/key ★                {sealed}
POST   /api/providers/{id}/signin ★             → {url, code, poll_id}
GET    /api/providers/{id}/signin/{poll_id}
POST   /api/providers/custom ★                  {base_url, sealed_key}
DELETE /api/providers/{id} ★
GET    /api/usage?days=

GET    /api/identity                            persona, personality, name, description
PUT    /api/identity ★
GET    /api/memory      PUT /api/memory ★

GET    /api/pets                                installed + active
GET    /api/pets/catalog?q=
POST   /api/pets/{slug}/install ★   PUT /api/pets/active ★   DELETE /api/pets/{slug} ★
GET    /api/pets/{slug}/sheet                   signed, cached
POST   /api/pets/hatch ★                        job

GET    /api/system                              health, versions, stats, updates
POST   /api/system/restart ★  /pause ★  /resume ★  /update ★ (job)  /plugin-update ★ (job)
GET    /api/jobs/{id}
GET    /api/logs?level=&q=&before=              + WS log stream
GET    /api/audit

GET    /api/devices     PATCH/DELETE /api/devices/{id} ★
POST   /api/devices/pairing-code ★              → {code, url, expires_at}

GET/POST /api/schedule ★   PATCH/DELETE /api/schedule/{id} ★
POST   /api/schedule/{id}/run|pause|resume ★    GET /api/schedule/{id}/runs
GET    /api/skills   POST /api/skills/install ★   PUT /api/skills/{name} ★
GET    /api/toolsets PUT /api/toolsets/{name} ★
GET    /api/mcp      POST /api/mcp ★   PUT/DELETE /api/mcp/{name} ★
```

New WebSocket events: `picker.new`, `picker.update`, `activity.update`, `status.update`,
`job.progress`, `system.status`, `log.line`.
