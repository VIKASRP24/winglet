<div align="center">

# 🪽 Winglet

**The open-source Dots for Hermes Agent. Your agents, in your pocket.**

Named AI agents that live on *your* server, work while you're away,
and tap you on the shoulder when they need you.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Status: pre-alpha](https://img.shields.io/badge/status-pre--alpha-orange)
![Android APK](https://img.shields.io/badge/android-APK-3DDC84)
![iPhone PWA](https://img.shields.io/badge/iPhone-PWA-lightgrey)

</div>

---

> **Status: pre-alpha.** We're building in public. Nothing installable yet.
> Star/watch the repo to follow along, or jump in (see [Contributing](#contributing)).

## What is this?

OpenAI Dots, Meta Muse and Grok Bot showed what a personal agent on your
phone should feel like. Each one has a face and a name, its own computer to
work on, memory, and a way to ping you when it needs a decision.

Winglet brings that experience to [Hermes Agent](https://github.com/NousResearch/hermes-agent),
the open-source agent by Nous Research, running on **your own machine or server**:

- **Your hardware, your models, your data.** No vendor cloud in the loop.
- **No app store needed.** Android gets an APK. iPhone gets an installable web app with push notifications.
- **Not another chat window.** Winglet is built around your agents and what they're doing, not around a text box.

## Planned features

| | Feature | What it means |
|---|---|---|
| 🤖 | **Your bots** | A home screen of named agents, each with an avatar, personality and live status |
| 📥 | **Inbox** | One place for everything that needs you: approvals, questions, finished results |
| 🔔 | **Push** | Your phone buzzes when a bot needs you, even when the app is closed |
| ✅ | **Approvals** | Approve once, for the session, always, or deny, straight from the notification |
| 💬 | **Chat** | Talk to any bot, with streaming replies, files and artifacts |
| 🖥️ | **Live screen** | Watch a bot use its computer and take over when it needs you (logins, 2FA, captchas) |
| 📞 | **Call your bot** | Real-time voice conversation |
| 🎯 | **Goals & routines** | See what each bot is working toward and what's scheduled next |
| 📷 | **QR pairing** | Scan a code from your server and you're connected. No typing URLs or keys |

## How it works

```
 ┌──────────────────────┐                ┌───────────────────────────────────┐
 │  Winglet app         │   HTTPS / WS   │  Your server                      │
 │  • Android (APK)     │ ─────────────▶ │                                   │
 │  • iPhone (PWA)      │                │  Hermes Agent                     │
 └──────────▲───────────┘                │   ├─ dashboard API                │
            │                            │   └─ winglet plugin               │
            │   push notifications       │        • QR pairing               │
            └─────────────────────────── │        • device registry          │
               (Web Push / ntfy)         │        • push on approvals/results│
                                         │        • serves the iPhone web app│
                                         └───────────────────────────────────┘
```

Winglet has two parts:

1. **The app** (`app/`): one [Expo](https://expo.dev) / React Native codebase that builds
   the Android APK and the iPhone/desktop web app.
2. **The companion plugin** (`plugin/`): a small Hermes plugin you install on your
   server. It adds what Hermes doesn't ship with: pairing, push notifications and
   hosting for the web app. **No fork of Hermes, and no third-party relay.**

Winglet talks to Hermes through its existing APIs and turns features on or off based
on what your Hermes version supports.

## Install

Not ready yet. When it is, the plan is:

- **Server:** install the Winglet plugin into Hermes with one command, then scan the QR code it shows.
- **Android:** download the APK from [Releases](../../releases), or use [Obtainium](https://github.com/ImranR98/Obtainium) for auto-updates.
- **iPhone:** scan the QR code, open it in Safari, tap **Share → Add to Home Screen**. Requires iOS 16.4+ for notifications.

## Roadmap

**v0.1: Connect**
- [ ] Companion plugin skeleton + QR pairing
- [ ] Bots home screen
- [ ] Chat with streaming
- [ ] Inbox + push notifications (Web Push for iPhone, ntfy for Android)
- [ ] Approvals from the phone

**v0.2: The wow**
- [ ] Live screen: watch and take over a bot's computer
- [ ] Call your bot (real-time voice)

**v0.3: Daily driver**
- [ ] Goals, routines and activity timeline
- [ ] Multiple servers
- [ ] Widgets / shortcuts where the platform allows

## FAQ

**Do I need to pay for anything?**
No. Winglet is MIT-licensed and needs no App Store or Play Store account. You need a
machine that runs Hermes Agent and whatever model provider you choose (local models work).

**Does my server need to be public on the internet?**
Your phone needs to reach it. On the same Wi-Fi works; for away-from-home, use something
like Tailscale or a Cloudflare Tunnel. Setup guides will come with v0.1.

**Why a web app on iPhone instead of a real app?**
Apple doesn't allow installing apps outside the App Store without a paid developer account,
and free sideloading expires every 7 days and can't receive notifications. An installed web
app can receive notifications and costs nothing.

## Contributing

Early days, so everything is open: code, design, naming of things, ideas.
See [CONTRIBUTING.md](CONTRIBUTING.md). Found a security issue? Please read [SECURITY.md](SECURITY.md) first.

## Disclaimer

Winglet is an independent community project. It is **not affiliated with or endorsed by
Nous Research, OpenAI, Meta or xAI**. "Hermes Agent" is a project of Nous Research;
other product names are used only to describe what Winglet is similar to.

## License

[MIT](LICENSE)
