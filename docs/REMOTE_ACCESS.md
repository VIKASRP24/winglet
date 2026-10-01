# Connect to Winglet from another network

Winglet has no same-Wi-Fi restriction. The Android app can use any server address it can reach.
The default URL comes from the server's routing table: on a VPS it may be a public IP; on a home
computer it is usually a private IP. Detecting that address does not establish connectivity.

Use HTTPS for remote connections. Setting `hermes winglet setup --public-url ...` only changes
the address used for pairing; it does not provision HTTPS, start a tunnel, or configure a firewall.
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

- Local `/api/info` fails: check `hermes winglet status` and gateway logs. Setup enables the plugin
  but does not start the gateway. Substitute your configured port if it is not 8787.
- Local `/api/info` works, but the phone cannot open the HTTPS URL: check the VPN connection or
  reverse proxy, DNS, and firewall. This is a network/hosting issue rather than a Wi-Fi restriction.
- HTTPS works in the phone's browser, but the app still uses the old address: pair again with
  the correct HTTPS URL. Changing the server's advertised URL does not update stored app connections.
