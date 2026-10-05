# Connect to Winglet from another network

## Automatic HTTPS: setup, scan, connect

```bash
hermes winglet setup
```

On a fresh or previously unpaired install, setup prepares the plugin dependencies and downloads
a pinned `cloudflared` release from Cloudflare's GitHub repository, verifies its SHA-256 digest, and stores it in the active Hermes
profile. It starts/restarts that profile's gateway and prints a QR only after the public HTTPS
`/api/info` response identifies the same Winglet server. No account, domain, admin rights,
firewall opening or phone VPN is required. Outbound HTTPS (downloads, tunnel creation and ntfy)
and Cloudflare's TCP port 7844 must still be permitted by the network.

Re-running setup preserves a saved connection mode or custom HTTPS address. An older install
without a saved mode keeps direct access if any phones are already paired; setup prints a hint
instead of changing their route. To opt into Cloudflare, run `hermes winglet setup --connection quick`
and re-pair existing phones using the new QR. An unreadable device store stops setup before
connection settings change, so it cannot mistake an existing install for a fresh one.

The gateway owns the tunnel, retries failed starts with backoff, clears unavailable addresses,
and recreates the tunnel if its client exits. A parent-lifetime pipe stops the tunnel client even
if the gateway crashes. Automatic mode defaults to listening on loopback; an explicit
`WINGLET_HOST` is respected. No system-wide service or firewall rule is installed. Hermes must
itself run persistently if you want access after logout/reboot.

Use `hermes winglet setup --no-start` to prepare it without restarting the gateway, or
`hermes winglet pair` for another QR. `status` reports the live address and probes it through
Cloudflare. Failure to obtain or verify HTTPS never falls back to an old HTTP address or creates
a pairing code. A successful public check verifies the Cloudflare route, although a phone's
own network can still block that domain.

### Limits and provider privacy

[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
are for testing/development: no uptime guarantee, changing hostnames, at most 200 in-flight
requests, and no Server-Sent Events. Winglet uses WebSockets rather than SSE. Cloudflare
terminates HTTPS and can see the HTTP/WebSocket traffic, including messages and device tokens;
this is transport encryption through a provider, not end-to-end encryption against that provider.
Setup prints this privacy disclosure before preparing the tunnel client.

Pairing attempts through the automatic loopback tunnel are limited by Cloudflare's client IP,
so another visitor's wrong codes do not exhaust your phone's allowance. Winglet only trusts
that header on local requests bearing the tunnel's private origin Host marker; direct requests
and malformed headers retain the socket-address limit. Explicit non-loopback binds retain the
socket-address limit as well.

Android address recovery is separate from notifications and requires the updated APK. Each
paired Android device receives its own random ntfy topic and AES-256-GCM key over the paired
connection. The gateway publishes only an encrypted address/identity/revision announcement,
never a bearer token or message text. It refreshes announcements every six hours for phones
returning after ntfy's cache expires. The app polls ntfy when reconnecting or returning to the
foreground, rejects forged/stale/cross-device announcements, verifies server identity without
a token, and verifies the device before saving a new URL. There is no separate ntfy app needed
for recovery. Unpairing deletes that device's enrollment. ntfy still sees topics, timing and IP
metadata and can delay/drop announcements; outages or exhausted free quotas delay recovery.
If the cache is empty, retry later or obtain a fresh QR. This is not background execution while
Android has suspended the app. Older paired Android installations enroll on their next successful
connection; upgrade/connect them before restarting a temporary tunnel, or re-pair afterward.

The iPhone web app's storage, service worker, installation and push subscription belong to one
origin. After a tunnel address changes, scan a fresh QR, pair, reinstall the new home-screen app
and enable notifications again. Use a permanent address if that is unsuitable.

Automatic downloads support Windows x86/x64, Linux x86/x64/ARM/ARM64, and macOS x64/ARM64.
Windows ARM is not silently emulated. Downloads are pinned in `plugin/tunnel.py`; maintainers
must update the release and official asset digests together for future cloudflared updates.

For an opt-in live integration test, run `python scripts/smoke_tunnel.py` after installing the
plugin's Python dependencies. It creates an ephemeral local hub, verifies public pairing and
WebSocket replies, restarts the tunnel, checks real encrypted ntfy delivery and revocation, and
stops its child processes. It uses Cloudflare/ntfy and prints no pairing codes, tokens or addresses.

## Your own connection

Winglet has no same-Wi-Fi restriction. For a permanent HTTPS address, use `setup --public-url`;
an existing explicit HTTPS configuration is preserved by default. Use `setup --connection direct`
to opt out of the automatic tunnel, then restart the gateway. In direct mode the fallback URL
comes from the routing table, which does not establish connectivity.

Use HTTPS for remote connections. Setting `hermes winglet setup --public-url ...` only changes
the address used for pairing and selects direct mode; it does not provision your custom HTTPS endpoint.
The gateway must also be running.

`setup` reports whether Winglet answers locally. `pair` checks this before creating a code;
if the gateway is not ready, it prints the next action instead of a QR that cannot work yet.
A successful local check does not verify access from the phone: its route to the server may differ.

## Private access with Tailscale

Install Tailscale on the computer/VPS running Hermes and on the Android phone. Sign both into
the same tailnet and connect them. Keep Tailscale connected on the phone when using Winglet,
including over mobile data or a different Wi-Fi network.

On the Hermes server:

```powershell
hermes gateway restart
hermes winglet status
```

If the gateway is not installed as a background service, use `hermes gateway run` instead and
leave it running. From a second PowerShell window, verify the local server:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/info
tailscale serve --bg http://127.0.0.1:8787
```

On Linux/macOS, use `curl http://127.0.0.1:8787/api/info` for the local check; the
Hermes and Tailscale commands are the same. If you set `WINGLET_HOST` to a specific
address, use that address instead of `127.0.0.1` for the check and Tailscale target.

Follow Tailscale's prompts to enable HTTPS if needed. Copy the HTTPS URL it prints; do not use
your VPS's public IP for this connection. Substitute that exact URL below:

```powershell
hermes winglet setup --public-url https://your-vps.your-tailnet.ts.net
hermes gateway restart
hermes winglet pair
```

Use the new QR code in the Android app while its Tailscale connection is active. If you previously
paired using a different URL, add the HTTPS connection using the new pairing code. Existing
connections keep their previously stored address.

Serve provides HTTPS access within the tailnet, rather than public access to the internet. The
phone does not need an inbound firewall opening on the VPS's public port 8787 for this route.
See the official [Tailscale Serve guide](https://tailscale.com/docs/features/tailscale-serve) and
[command reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

## Public HTTPS domain without a phone VPN

Point a domain you control to the VPS, then configure an HTTPS reverse proxy such as Caddy or
Nginx to forward traffic to `http://127.0.0.1:8787`. The proxy must forward WebSocket connections
as well as HTTP requests. Configure DNS and the firewall for the proxy's HTTPS/certificate setup;
the Winglet backend need not be exposed directly on public port 8787.

For Caddy, a minimal Caddyfile is:

```caddyfile
winglet.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Replace the example domain with yours and run Caddy on the VPS. Its default automatic HTTPS
setup requires DNS to resolve to this server and ports 80/443 to reach Caddy. Verify
`https://your-domain/api/info` from your phone, then configure Winglet with that same HTTPS URL,
restart the gateway, and create a new pairing code. Caddy forwards WebSockets automatically.
See [Caddy's reverse-proxy quick start](https://caddyserver.com/docs/quick-starts/reverse-proxy).

## If connecting still fails

- Local `/api/info` fails: check `hermes winglet status` and gateway logs. Automatic setup starts
  the gateway; direct mode needs `hermes gateway restart` or `hermes gateway run`.
  Substitute your configured port/host if it differs from loopback port 8787.
- Local `/api/info` works, but the phone cannot open the HTTPS URL: check the VPN connection or
  reverse proxy, DNS, and firewall. This is a network/hosting issue rather than a Wi-Fi restriction.
- HTTPS works in the phone's browser, but the app still uses the old address: pair again with
  the correct HTTPS URL. Changing the server's advertised URL does not update stored app connections.
