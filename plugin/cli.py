"""``hermes winglet ...``: setup, pair, devices, unpair, status."""

from __future__ import annotations

import argparse
import json
import socket
import sys
import urllib.request
from typing import Optional

DEFAULT_PORT = 8787


def setup_parser(parser: argparse.ArgumentParser) -> None:
    subs = parser.add_subparsers(dest="winglet_command", required=False)
    p_setup = subs.add_parser("setup", help="Enable Winglet in this profile's gateway")
    p_setup.add_argument("--port", type=int, default=None, help=f"Port to listen on (default {DEFAULT_PORT})")
    p_setup.add_argument("--public-url", default=None,
                         help="URL your phone uses to reach this machine, e.g. https://box.tailnet.ts.net")
    p_pair = subs.add_parser("pair", help="Show a QR code to pair a phone")
    p_pair.add_argument("--public-url", default=None, help="Override the URL encoded in the QR code")
    subs.add_parser("devices", help="List paired phones")
    p_unpair = subs.add_parser("unpair", help="Remove a paired phone")
    p_unpair.add_argument("device_id", help="Device id from `hermes winglet devices`")
    subs.add_parser("status", help="Show whether Winglet is running and how to reach it")
    parser.set_defaults(func=main)


def main(args: argparse.Namespace) -> int:
    sub = getattr(args, "winglet_command", None) or "status"
    handler = {"setup": cmd_setup, "pair": cmd_pair, "devices": cmd_devices, "unpair": cmd_unpair,
               "status": cmd_status}.get(sub)
    if handler is None:
        print(f"unknown subcommand: {sub}", file=sys.stderr)
        return 2
    return handler(args) or 0


# -- helpers -----------------------------------------------------------------------------


def _env(key: str) -> str:
    try:
        from hermes_cli.config import get_env_value
        return (get_env_value(key) or "").strip()
    except Exception:
        return ""


def _port() -> int:
    try:
        return int(_env("WINGLET_PORT") or DEFAULT_PORT)
    except ValueError:
        return DEFAULT_PORT


def lan_ip() -> str:
    """Best guess at this machine's LAN address (no packets are sent)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        try:
            sock.connect(("10.255.255.255", 1))
            return sock.getsockname()[0]
        except OSError:
            return "127.0.0.1"


def public_url(override: Optional[str] = None) -> str:
    url = (override or _env("WINGLET_PUBLIC_URL")).rstrip("/")
    return url or f"http://{lan_ip()}:{_port()}"


def _running() -> Optional[dict]:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{_port()}/api/info", timeout=2) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def _print_qr(text: str) -> None:
    try:
        import qrcode
    except ImportError:
        print("(install `qrcode` to see a scannable code here: pip install qrcode)")
        return
    qr = qrcode.QRCode(border=2)
    qr.add_data(text)
    qr.make(fit=True)
    qr.print_ascii(invert=True)


# -- commands ----------------------------------------------------------------------------


def cmd_setup(args: argparse.Namespace) -> int:
    from hermes_cli.config import save_env_value
    save_env_value("WINGLET_ENABLED", "true")
    if args.port:
        save_env_value("WINGLET_PORT", str(args.port))
    if args.public_url:
        save_env_value("WINGLET_PUBLIC_URL", args.public_url.rstrip("/"))
    print("🪽 Winglet is enabled for this profile.\n")
    print("Next:")
    print("  1. Restart the gateway:   hermes gateway restart   (or start it: hermes gateway run)")
    print("  2. Pair your phone:       hermes winglet pair\n")
    print("Tip: for live-typing replies, add this to config.yaml:")
    print("  display:\n    platforms:\n      winglet:\n        streaming: true")
    if not (args.public_url or _env("WINGLET_PUBLIC_URL")):
        print(f"\nYour phone will connect to {public_url()} (same Wi-Fi only).")
        print("For iPhone notifications and away-from-home access you need HTTPS, e.g. with Tailscale:")
        print(f"  tailscale serve --bg {_port()}   then   hermes winglet setup --public-url https://<machine>.ts.net")
    return 0


def cmd_pair(args: argparse.Namespace) -> int:
    from .adapter import open_store
    store = open_store()
    try:
        code = store.create_pair_code()
    finally:
        store.close()
    url = public_url(args.public_url)
    link = f"{url}/#pair={code}"
    print("\nScan this with your phone's camera (iPhone) or the Winglet app (Android):\n")
    _print_qr(link)
    print(f"\n  Link:  {link}")
    print(f"  Code:  {code[:4]}-{code[4:]}   (expires in 10 minutes, works once)\n")
    if _running() is None:
        print("⚠️  Winglet isn't answering on this machine yet. Run `hermes winglet setup`, then restart the gateway.")
    elif url.startswith("http://"):
        print("Note: plain http works for the Android app on your Wi-Fi. iPhone needs an https URL"
              " (see `hermes winglet setup --help`).")
    return 0


def cmd_devices(args: argparse.Namespace) -> int:
    from .adapter import open_store
    store = open_store()
    try:
        devices = store.list_devices()
    finally:
        store.close()
    if not devices:
        print("No phones paired yet. Run `hermes winglet pair`.")
        return 0
    import datetime as _dt
    for d in devices:
        seen = _dt.datetime.fromtimestamp(d["last_seen"]).strftime("%Y-%m-%d %H:%M")
        print(f"  {d['id']}  {d['name']:<24} {d['platform'] or '':<8} last seen {seen}")
    return 0


def cmd_unpair(args: argparse.Namespace) -> int:
    from .adapter import open_store
    store = open_store()
    try:
        removed = store.remove_device(args.device_id)
    finally:
        store.close()
    print("Removed." if removed else "No device with that id.")
    return 0 if removed else 1


def cmd_status(args: argparse.Namespace) -> int:
    enabled = _env("WINGLET_ENABLED").lower() in ("1", "true", "yes", "on")
    info = _running()
    print(f"Enabled:  {'yes' if enabled else 'no  (run `hermes winglet setup`)'}")
    print(f"Running:  {'yes — ' + info['bot']['title'] if info else 'no  (start the gateway: hermes gateway run)'}")
    print(f"URL:      {public_url()}")
    return 0
