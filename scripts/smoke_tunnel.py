"""Opt-in live integration check against Cloudflare and ntfy (no Hermes/model needed).

Run: python scripts/smoke_tunnel.py [--cache-dir .venv/tunnel-live]
Uses an ephemeral loopback hub/device, makes two public tunnels and publishes encrypted test
announcements. Needs internet/Cloudflare TCP 7844. Prints no addresses, pairing codes or tokens.
"""
import argparse
import asyncio
import base64
import json
import logging
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
from aiohttp import ClientSession, web
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from plugin.hub import Hub
from plugin.store import Store
from plugin.tunnel import QuickTunnel, install


async def check(directory: Path, cache: Path):
    await asyncio.to_thread(install, cache)
    store = Store(directory / "data.db")
    hub = Hub(store, web_root=Path(__file__).resolve().parents[1] / "plugin" / "web")
    hub.connection = {"mode": "quick", "url": None}
    runner = web.AppRunner(hub.build_app(), access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    ready = asyncio.Event()
    async def changed(url):
        await hub.set_connection(url)
        if url:
            ready.set()
    async def reply(chat, text, device, message):
        await hub.post_message(chat["id"], "Tunnel reply: " + text, push=False)
    hub.on_user_message = reply
    tunnel = QuickTunnel(cache, f"http://127.0.0.1:{port}", hub.server_id(), changed)
    try:
        tunnel.start()
        await asyncio.wait_for(ready.wait(), 160)
        async with httpx.AsyncClient(timeout=15) as client:
            first_url = hub.connection["url"]
            info = (await client.get(first_url + "/api/info")).json()
            assert info["server_id"] == hub.server_id()
            response = await client.post(first_url + "/api/pair", json={
                "code": store.create_pair_code(), "platform": "android"})
            response.raise_for_status()
            paired = response.json()
            auth = {"Authorization": "Bearer " + paired["token"]}
            assert (await client.get(first_url + "/api/me", headers=auth)).status_code == 200
            async with ClientSession() as session:
                async with session.ws_connect(first_url.replace("https:", "wss:") + "/api/ws?token=" + paired["token"]) as ws:
                    assert (await ws.receive_json(timeout=15))["type"] == "hello"
                    await ws.send_json({"type": "ping", "t": 123})
                    assert (await ws.receive_json(timeout=15))["type"] == "pong"
                    await ws.send_json({"type": "message.send", "chat_id": "home", "text": "smoke", "client_id": "smoke-1"})
                    for _ in range(8):
                        event = await ws.receive_json(timeout=15)
                        if event.get("message", {}).get("text") == "Tunnel reply: smoke":
                            break
                    else:
                        raise AssertionError("Reply did not reach WebSocket")
            print("PASS: public HTTPS health, pairing, authenticated API and WebSocket message/reply.", flush=True)
            await tunnel.stop()
            ready.clear()
            tunnel.start()
            await asyncio.wait_for(ready.wait(), 160)
            assert hub.connection["url"] != first_url
            await hub.publish_addresses()
            recovery = paired["recovery"]
            response = await client.get(recovery["server"] + "/" + recovery["topic"] + "/json?poll=1&since=all")
            response.raise_for_status()
            decode = lambda s: base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
            updates = []
            for line in response.text.splitlines():
                event = json.loads(line)
                if event.get("event") == "message":
                    envelope = json.loads(event["message"])
                    aad = f"winglet.connection.v1:{hub.server_id()}:{paired['device']['id']}".encode()
                    updates.append(json.loads(AESGCM(decode(recovery["key"])).decrypt(
                        decode(envelope["nonce"]), decode(envelope["ciphertext"]), aad)))
            assert any(u["url"] == hub.connection["url"] and u["revision"] > recovery["revision"] for u in updates)
            assert (await client.get(hub.connection["url"] + "/api/me", headers=auth)).status_code == 200
            store.remove_device(paired["device"]["id"])
            assert (await client.get(hub.connection["url"] + "/api/me", headers=auth)).status_code == 401
            print("PASS: URL rotation, encrypted ntfy recovery, retained pairing and device revocation.", flush=True)
    finally:
        await tunnel.stop()
        await runner.cleanup()
        await hub.aclose()
        store.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path)
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING)
    with tempfile.TemporaryDirectory(prefix="winglet-tunnel-smoke-") as directory:
        asyncio.run(check(Path(directory), (args.cache_dir or Path(directory)).resolve()))
