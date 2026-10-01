# Security Policy

Winglet connects your phone to an AI agent that can act on your behalf, so we take
security seriously.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Instead, report it privately through GitHub:
**Security → Report a vulnerability** on this repository
([direct link](../../security/advisories/new)).

Include what you found, how to reproduce it, and what an attacker could do with it.
We'll acknowledge the report as soon as we can and keep you updated on the fix.

## Supported versions

Winglet is pre-alpha. Only the latest code on `main` is supported.

## Automatic remote access

Automatic setup publishes the Winglet HTTP/WebSocket service through a Cloudflare Quick Tunnel.
Pairing codes and device tokens still protect the API. Cloudflare terminates HTTPS and can read
traffic and tokens; the tunnel is not end-to-end encrypted against Cloudflare. Use direct mode
with a connection you control if that trust model is unsuitable.

Android address discovery uses a separate random AES-GCM key and random ntfy topic per device.
Encrypted announcements bind the server, device and increasing address revision. The app
validates an HTTPS Quick Tunnel hostname and the server identity before forwarding its saved
token, then verifies the paired device. Revocation removes the device's discovery enrollment.
ntfy learns topic/timing/IP metadata and can interfere with availability, but receives neither
discovery keys nor plaintext addresses/tokens. All downloaded tunnel binaries are version-pinned
and checked against official release SHA-256 digests before execution.
