# Winglet plugin for Hermes Agent

This folder is a [Hermes Agent](https://github.com/NousResearch/hermes-agent) plugin. It adds
**Winglet** as a messaging platform, the same way Telegram or Discord plug in, so everything
Hermes already does (sessions, approvals, questions, routines) reaches your phone.

What it adds on your server:

- A small HTTPS/WebSocket server for the app (default port `8787`)
- QR-code pairing (`hermes winglet pair`)
- Push notifications: Web Push for the iPhone/desktop web app, ntfy for Android
- One-tap approvals and answers to the agent's questions
- Hosting for the installable web app

## Install

```bash
hermes plugins install VIKASRP24/winglet/plugin
hermes plugins enable winglet
hermes winglet setup
hermes gateway restart        # or: hermes gateway run
hermes winglet pair           # scan the QR code with your phone
```

## Commands

| Command | What it does |
|---|---|
| `hermes winglet setup [--port N] [--public-url URL]` | Enable Winglet for this profile |
| `hermes winglet pair` | Show a QR code + one-time code (10 minutes) |
| `hermes winglet devices` | List paired phones |
| `hermes winglet unpair <id>` | Remove a phone |
| `hermes winglet status` | Is it running, and at which URL |

## Settings

Set in `~/.hermes/.env` (or per profile):

| Variable | Default | |
|---|---|---|
| `WINGLET_ENABLED` | – | `true` to start with the gateway |
| `WINGLET_PORT` | `8787` | |
| `WINGLET_HOST` | `0.0.0.0` | |
| `WINGLET_PUBLIC_URL` | `http://<lan-ip>:8787` | The address encoded in pairing QR codes |
| `WINGLET_NTFY_SERVER` | `https://ntfy.sh` | For Android notifications |

For live-typing replies, add to `config.yaml`:

```yaml
display:
  platforms:
    winglet:
      streaming: true
```

## Multiple bots

Each Hermes profile is a bot. Run a gateway per profile with its own port
(`hermes -p researcher winglet setup --port 8788`), then pair each one. They all show up in the
app's sidebar.
