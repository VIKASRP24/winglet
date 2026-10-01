"""Winglet hub: the HTTP/WebSocket server the app talks to, plus push delivery.

Independent of Hermes internals so it can be tested on its own. The platform adapter
(``adapter.py``) owns a Hub and plugs Hermes into it through a few callbacks.

Wire protocol (JSON over one WebSocket at ``/api/ws?token=<device token>``):

server -> app  ``{"type": "hello" | "message.new" | "message.update" | "message.delete" | "typing" |
                  "chat.update" | "chat.delete" | "inbox.new" | "inbox.update" | "pong", ...}``
app -> server  ``{"type": "message.send", "chat_id", "text", "client_id"}``,
               ``{"type": "inbox.respond", "id", "choice" | "answer"}``, ``{"type": "ping"}``
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import ipaddress
import json
import logging
import mimetypes
import secrets
import shutil
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set
from urllib.parse import quote

from aiohttp import WSMsgType, web

from . import recovery, webpush
from .store import Store

logger = logging.getLogger(__name__)

VERSION = "0.1.1"
HOME_CHAT_ID = "home"
PUSH_DEBOUNCE_SECONDS = 2.5
MAX_TEXT = 16_000
PUSH_SUBJECT = "https://github.com/VIKASRP24/winglet"
PAIR_FAILURES_PER_MINUTE = 10
ALIVE_CACHE_SECONDS = 2.0
# Raster formats only: SVG is a document that can carry script.
INLINE_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"}

InboundFn = Callable[[Dict[str, Any], str, Dict[str, Any], Dict[str, Any]], Awaitable[None]]
ResolveFn = Callable[[Dict[str, Any], Any], Awaitable[bool]]


def _json(data: Any, status: int = 200) -> web.Response:
    return web.json_response(data, status=status, dumps=lambda o: json.dumps(o, separators=(",", ":")))


def _error(status: int, message: str) -> web.Response:
    return _json({"error": message}, status=status)


def _clip(text: str, n: int) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= n else text[: n - 1] + "…"


class Hub:
    def __init__(self, store: Store, *, web_root: Optional[Path] = None,
                 bot_info: Optional[Callable[[], Dict[str, Any]]] = None,
                 ntfy_server: str = "https://ntfy.sh", http_client: Any = None,
                 media_dir: Optional[Path] = None):
        self.store = store
        self.web_root = web_root
        self.media_dir = media_dir or Path(store.path).parent / "media"
        self._bot_info = bot_info or (lambda: {"name": "Hermes", "title": "Hermes", "description": ""})
        self.ntfy_server = (ntfy_server or "https://ntfy.sh").rstrip("/")
        self._http = http_client
        self._sockets: Dict[web.WebSocketResponse, Dict[str, Any]] = {}
        self._push_tasks: Dict[str, asyncio.Task] = {}
        self._typing: Set[str] = set()
        self._pair_failures: Dict[str, List[float]] = {}
        self._alive_cache: Dict[str, tuple] = {}
        self.connection = {"mode": "direct", "url": None}
        # cloudflared overrides Host with this private marker on origin requests. Never expose
        # it in /api/info: client-IP headers from ordinary/direct callers are untrusted.
        self.tunnel_host = "winglet-" + secrets.token_hex(24) + ".invalid"
        self._recovery_task = None
        self._recovery_due = {}
        self._recovery_wake = asyncio.Event()
        self._recovery_lock = asyncio.Lock()
        # Hermes-side callbacks, installed by the adapter.
        self.on_user_message: Optional[InboundFn] = None
        self.on_approval: Optional[ResolveFn] = None
        self.on_answer: Optional[ResolveFn] = None
        self.store.ensure_chat(HOME_CHAT_ID, "Updates", kind="home")

    # -- lifecycle -------------------------------------------------------------------

    def build_app(self) -> web.Application:
        app = web.Application(client_max_size=2 * 1024 * 1024, middlewares=[self._cors])
        r = app.router
        r.add_get("/api/info", self.h_info)
        r.add_post("/api/pair", self.h_pair)
        r.add_get("/api/ws", self.h_ws)
        r.add_get("/api/me", self.h_me)
        r.add_get("/api/connection", self.h_connection)
        r.add_delete("/api/me", self.h_unpair)
        r.add_get("/api/chats", self.h_chats)
        r.add_post("/api/chats", self.h_chat_create)
        r.add_patch("/api/chats/{chat_id}", self.h_chat_rename)
        r.add_delete("/api/chats/{chat_id}", self.h_chat_delete)
        r.add_get("/api/chats/{chat_id}/messages", self.h_messages)
        r.add_post("/api/chats/{chat_id}/messages", self.h_message_send)
        r.add_get("/api/inbox", self.h_inbox)
        r.add_post("/api/inbox/{item_id}/respond", self.h_inbox_respond)
        r.add_get("/api/push/vapid", self.h_vapid)
        r.add_post("/api/push/webpush", self.h_webpush_subscribe)
        r.add_delete("/api/push/webpush", self.h_webpush_unsubscribe)
        r.add_get("/api/push/ntfy", self.h_ntfy)
        r.add_post("/api/push/test", self.h_push_test)
        r.add_get("/api/media/{media_id}/{name}", self.h_media)
        r.add_get("/{tail:.*}", self.h_static)
        app.on_shutdown.append(self._close_sockets)
        return app

    async def _close_sockets(self, _app: web.Application) -> None:
        for ws in list(self._sockets):
            with contextlib.suppress(Exception):
                await ws.close()
        for task in self._push_tasks.values():
            task.cancel()
        self._push_tasks.clear()

    @web.middleware
    async def _cors(self, request: web.Request, handler):
        # The native app calls from its own origin-less context; browsers use the same origin as the
        # server. Allowing any origin is safe because every API call needs a bearer token (no cookies).
        if request.method == "OPTIONS":
            resp: web.StreamResponse = web.Response(status=204)
        else:
            resp = await handler(request)
        if request.path.startswith("/api/"):
            resp.headers["Access-Control-Allow-Origin"] = "*"
            resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
            resp.headers.setdefault("Cache-Control", "no-store")
        return resp

    # -- auth ------------------------------------------------------------------------

    def _device(self, request: web.Request) -> Optional[Dict[str, Any]]:
        auth = request.headers.get("Authorization", "")
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else request.query.get("token", "")
        return self.store.device_for_token(token)

    def _require(self, request: web.Request) -> Dict[str, Any]:
        device = self._device(request)
        if device is None:
            raise web.HTTPUnauthorized(text=json.dumps({"error": "not paired"}), content_type="application/json")
        return device

    def action_signature(self, item_id: str, choice: str) -> str:
        """HMAC used for one-tap notification action links (no bearer token available there)."""
        key = self.store.secret("action_key").encode()
        return hmac.new(key, f"{item_id}:{choice}".encode(), hashlib.sha256).hexdigest()[:32]

    # -- info & pairing ------------------------------------------------------------------

    def bot(self) -> Dict[str, Any]:
        info = dict(self._bot_info() or {})
        info.setdefault("name", "Hermes")
        info.setdefault("title", info["name"])
        info.setdefault("description", "")
        return info

    def server_id(self) -> str:
        return self.store.secret("server_id", lambda: secrets.token_hex(6))

    def device_alive(self, device_id: str) -> bool:
        """Whether a device is still paired. Unpairing can happen in another process (the CLI), so
        this reads the database, cached for a moment to keep streaming broadcasts cheap."""
        now = time.monotonic()
        cached = self._alive_cache.get(device_id)
        if cached and now - cached[1] < ALIVE_CACHE_SECONDS:
            return cached[0]
        alive = self.store.get_device(device_id) is not None
        self._alive_cache[device_id] = (alive, now)
        return alive

    async def h_info(self, request: web.Request) -> web.Response:
        return _json({"app": "winglet", "version": VERSION, "server_id": self.server_id(), "bot": self.bot(),
                      "connection": self.connection,
                      "features": {"webpush": True, "ntfy": True, "approvals": True, "questions": True}})

    def _pair_peer(self, request: web.Request) -> str:
        peer = request.remote or "?"
        try:
            if (self.connection["mode"] == "quick" and ipaddress.ip_address(peer).is_loopback
                    and request.headers.get("Host") == self.tunnel_host):
                return str(ipaddress.ip_address(request.headers.get("CF-Connecting-IP", "")))
        except ValueError:
            pass  # Missing/malformed proxy headers use the socket's address.
        return peer

    async def h_pair(self, request: web.Request) -> web.Response:
        peer = self._pair_peer(request)
        now = time.monotonic()
        recent = [t for t in self._pair_failures.get(peer, []) if now - t < 60]
        if len(recent) >= PAIR_FAILURES_PER_MINUTE:
            return _error(429, "Too many attempts. Wait a minute and try again.")
        try:
            body = await request.json()
        except Exception:
            return _error(400, "invalid JSON")
        if not isinstance(body, dict):
            return _error(400, "expected a JSON object")
        if not self.store.redeem_pair_code(str(body.get("code") or "")):
            self._pair_failures[peer] = recent + [now]
            return _error(403, "This pairing code is invalid or expired. Run `hermes winglet pair` for a new one.")
        self._pair_failures.pop(peer, None)
        device, token = self.store.add_device(str(body.get("device_name") or ""), str(body.get("platform") or ""))
        logger.info("[winglet] paired new device %s (%s)", device["name"], device["platform"] or "unknown")
        address = self._recovery_credentials(device) if device["platform"] == "android" else None
        return _json({"token": token, "device": device, "server_id": self.server_id(), "bot": self.bot(),
                      "recovery": address})

    def _recovery_credentials(self, device: dict) -> Optional[dict]:
        if self.connection["mode"] != "quick" or not self.ntfy_server.startswith("https://"):
            return None
        mine = next((s for s in self.store.list_push_subs("recovery") if s["device_id"] == device["id"]), None)
        if mine is None:
            data = recovery.credentials(self.ntfy_server)
            self.store.add_push_sub(device["id"], "recovery", data["server"] + "/" + data["topic"], data)
            self._recovery_wake.set()
        else:
            data = mine["data"]
        # The revision at enrollment is already current. Only later addresses may replace it.
        return {**data, "revision": int(self.store.get_kv("connection_revision") or 0)}

    async def h_connection(self, request: web.Request) -> web.Response:
        device = self._require(request)
        return _json({"recovery": self._recovery_credentials(device) if device["platform"] == "android" else None})

    async def set_connection(self, url: Optional[str]) -> None:
        self.connection = {"mode": "quick", "url": url}
        if url:
            if self.store.get_kv("connection_url") != url:
                self.store.set_kv("connection_revision", str(int(self.store.get_kv("connection_revision") or 0) + 1))
                self.store.set_kv("connection_url", url)
                self._recovery_due.clear()
                self._recovery_wake.set()
            if self._recovery_task is None:
                self._recovery_task = asyncio.create_task(self._recovery_loop())

    async def _recovery_loop(self) -> None:
        while True:
            self._recovery_wake.clear()
            await self.publish_addresses()
            try:
                await asyncio.wait_for(self._recovery_wake.wait(), timeout=300)
            except asyncio.TimeoutError:
                pass

    async def publish_addresses(self) -> None:
        async with self._recovery_lock:
            await self._publish_addresses()

    async def _publish_addresses(self) -> None:
        url = self.connection.get("url")
        if not url or self.connection["mode"] != "quick":
            return
        revision = int(self.store.get_kv("connection_revision") or 0)
        for sub in self.store.list_push_subs("recovery"):
            if self.connection.get("url") != url:
                return  # A rotated URL supersedes the remainder of this batch.
            if self._recovery_due.get(sub["id"], 0) > time.monotonic():
                continue
            if not self.store.get_device(sub["device_id"]):
                continue
            try:
                message = recovery.encrypt(sub["data"], self.server_id(), sub["device_id"], url, revision)
                client = await self._client()
                response = await client.post(sub["data"]["server"], json={
                    "topic": sub["data"]["topic"], "message": message}, timeout=15)
                # Refresh every six hours so phones returning after ntfy's cache expires can recover.
                if self.connection.get("url") == url:
                    self._recovery_due[sub["id"]] = time.monotonic() + (6 * 3600 if response.status_code < 300 else 300)
                if response.status_code >= 300:
                    logger.warning("[winglet] address recovery publish rejected: HTTP %s", response.status_code)
            except Exception:
                if self.connection.get("url") == url:
                    self._recovery_due[sub["id"]] = time.monotonic() + 300
                logger.warning("[winglet] address recovery publish failed; will retry")

    async def h_me(self, request: web.Request) -> web.Response:
        device = self._require(request)
        return _json({"device": device, "bot": self.bot(), "server_id": self.server_id()})

    async def h_unpair(self, request: web.Request) -> web.Response:
        device = self._require(request)
        self.store.remove_device(device["id"])
        self._alive_cache.pop(device["id"], None)
        for ws, meta in list(self._sockets.items()):
            if meta["device"]["id"] == device["id"]:
                await ws.close()
        return _json({"ok": True})

    # -- chats & messages ----------------------------------------------------------------

    async def h_chats(self, request: web.Request) -> web.Response:
        self._require(request)
        return _json({"chats": self.store.list_chats()})

    async def h_chat_create(self, request: web.Request) -> web.Response:
        self._require(request)
        body = await self._body(request)
        chat = self.store.create_chat(str(body.get("title") or ""))
        await self.broadcast({"type": "chat.update", "chat": chat})
        return _json({"chat": chat})

    async def h_chat_rename(self, request: web.Request) -> web.Response:
        self._require(request)
        body = await self._body(request)
        chat = self.store.rename_chat(request.match_info["chat_id"], str(body.get("title") or ""))
        if chat is None:
            return _error(404, "no such chat")
        await self.broadcast({"type": "chat.update", "chat": chat})
        return _json({"chat": chat})

    async def h_chat_delete(self, request: web.Request) -> web.Response:
        self._require(request)
        chat_id = request.match_info["chat_id"]
        if chat_id == HOME_CHAT_ID:
            return _error(400, "the Updates chat can't be deleted")
        if not self.store.delete_chat(chat_id):
            return _error(404, "no such chat")
        await self.broadcast({"type": "chat.delete", "chat_id": chat_id})
        return _json({"ok": True})

    async def h_messages(self, request: web.Request) -> web.Response:
        self._require(request)
        chat_id = request.match_info["chat_id"]
        try:
            before = float(request.query["before"]) if request.query.get("before") else None
            before_position = int(request.query["before_position"]) if request.query.get("before_position") else None
            limit = int(request.query.get("limit") or 50)
            if before_position is not None and before_position < 1:
                raise ValueError
        except ValueError:
            return _error(400, "before and limit must be numbers; before_position must be a positive integer")
        messages = self.store.list_messages(chat_id, before_position=before_position,
                                            before_id=request.query.get("before_id") or None,
                                            before=before, limit=limit)
        return _json({"messages": messages, "deleted_ids": self.store.deleted_message_ids(chat_id)})

    async def h_message_send(self, request: web.Request) -> web.Response:
        device = self._require(request)
        body = await self._body(request)
        if self.store.get_chat(request.match_info["chat_id"]) is None:
            return _error(404, "This chat was deleted.")
        message = await self.user_message(device, request.match_info["chat_id"], str(body.get("text") or ""),
                                          str(body.get("client_id") or ""))
        if message is None:
            return _error(400, "empty message")
        return _json({"message": message})

    async def user_message(self, device: Dict[str, Any], chat_id: str, text: str,
                           client_id: str = "") -> Optional[Dict[str, Any]]:
        text = (text or "").strip()[:MAX_TEXT]
        if not text or not chat_id:
            return None
        if client_id:
            # A retry of something we already have (the reply to the first try was lost): don't run it twice.
            existing = self.store.find_user_message(chat_id, client_id)
            if existing is not None:
                return existing
        chat = self.store.get_chat(chat_id)
        if chat is None:
            return None  # deleted (or never created): don't bring it back
        message = self.store.add_message(chat_id, "user", text,
                                         meta={"device": device["name"], "client_id": client_id})
        await self.broadcast({"type": "message.new", "chat_id": chat_id, "message": message})
        await self.broadcast({"type": "chat.update", "chat": self.store.get_chat(chat_id)})
        if self.on_user_message is not None:
            try:
                await self.on_user_message(chat, text, device, message)
            except Exception:
                logger.exception("[winglet] failed to hand message to Hermes")
                await self.post_message(chat_id, "⚠️ Couldn't reach the agent. Check the gateway logs.",
                                        role="system", push=False)
        return message

    # -- inbox ---------------------------------------------------------------------------

    async def h_inbox(self, request: web.Request) -> web.Response:
        self._require(request)
        status = request.query.get("status") or None
        if status == "pending":
            items = self.store.pending_items()
        elif status:
            items = self.store.list_inbox(status=status)
        else:
            # Everything still waiting for an answer, however old, plus recent history.
            pending = self.store.pending_items()
            seen = {i["id"] for i in pending}
            items = pending + [i for i in self.store.list_inbox() if i["id"] not in seen]
        return _json({"items": items, "pending": self.store.pending_count()})

    async def h_inbox_respond(self, request: web.Request) -> web.Response:
        item_id = request.match_info["item_id"]
        body = await self._body(request)
        choice = str(body.get("choice") or request.query.get("choice") or "")
        answer = body.get("answer")
        device = self._device(request)
        if device is None:
            # One-tap notification actions carry an HMAC instead of a bearer token.
            sig = str(body.get("sig") or request.query.get("sig") or "")
            if not (choice and hmac.compare_digest(sig, self.action_signature(item_id, choice))):
                return _error(401, "not paired")
        ok, item = await self.respond(item_id, choice=choice, answer=answer)
        if item is None:
            return _error(404, "no such item")
        return _json({"ok": ok, "item": item}, status=200 if ok else 409)

    async def respond(self, item_id: str, *, choice: str = "", answer: Any = None) -> tuple[bool, Optional[Dict]]:
        item = self.store.get_inbox(item_id)
        if item is None:
            return False, None
        if item["status"] != "pending":
            return False, item
        ok = False
        if item["kind"] == "approval":
            if choice not in (item["payload"].get("choices") or []):
                return False, item
            ok = bool(self.on_approval and await self.on_approval(item, choice))
            resolution = choice
        elif item["kind"] == "question":
            if isinstance(answer, list):  # multi-select: the labels the user ticked
                picked = [str(a).strip() for a in answer if str(a).strip()]
                if not picked:
                    return False, item
                reply: Any = picked
                resolution = ", ".join(picked)
            else:
                reply = resolution = str(answer if answer is not None else choice).strip()
                if not reply:
                    return False, item
            ok = bool(self.on_answer and await self.on_answer(item, reply))
        else:  # results are simply acknowledged
            ok, resolution = True, "seen"
        updated = self.store.resolve_inbox(item_id, "resolved" if ok else "expired", resolution if ok else "")
        item = updated or self.store.get_inbox(item_id)
        await self.broadcast({"type": "inbox.update", "item": item, "pending": self.store.pending_count()})
        return ok, item

    async def expire_item(self, item_id: str, note: str = "") -> Optional[Dict[str, Any]]:
        """Mark a pending card dead (its request ended without an answer from Winglet)."""
        item = self.store.resolve_inbox(item_id, "expired", note[:500])
        if item is not None:
            await self.broadcast({"type": "inbox.update", "item": item, "pending": self.store.pending_count()})
        return item

    async def add_inbox(self, kind: str, chat_id: str, title: str, body: str, payload: Dict[str, Any], *,
                        push: bool = True) -> Dict[str, Any]:
        # Results are informational: they land in the inbox history but never count as "needs you".
        status = "resolved" if kind == "result" else "pending"
        item = self.store.add_inbox(kind, chat_id, title, body, payload, status=status)
        await self.broadcast({"type": "inbox.new", "item": item, "pending": self.store.pending_count()})
        if push:
            await self.push_now(self._inbox_notification(item), tag=f"inbox-{item['id']}",
                                urgency="normal" if kind == "result" else "high", item=item)
        return item

    def _inbox_notification(self, item: Dict[str, Any]) -> Dict[str, Any]:
        bot = self.bot()["title"]
        chat = self.store.get_chat(item["chat_id"]) or {}
        return {"title": f"{bot} · {item['title']}", "body": _clip(item["body"], 180),
                "url": "/inbox", "kind": item["kind"], "item_id": item["id"],
                "chat_id": item["chat_id"], "chat_title": chat.get("title", "")}

    # -- outbound (called by the adapter) ------------------------------------------------------

    async def post_message(self, chat_id: str, text: str, *, role: str = "bot", status: str = "final",
                           meta: Optional[Dict[str, Any]] = None, push: bool = True) -> Dict[str, Any]:
        message = self.store.add_message(chat_id, role, text, status=status, meta=meta)
        await self.broadcast({"type": "message.new", "chat_id": chat_id, "message": message})
        await self.broadcast({"type": "chat.update", "chat": self.store.get_chat(chat_id)})
        if push and role == "bot":
            self.schedule_push(chat_id, message["id"], final=status == "final")
        return message

    async def edit_message(self, message_id: str, text: str, *, final: bool = False) -> Optional[Dict[str, Any]]:
        message = self.store.update_message(message_id, text, status="final" if final else "streaming")
        if message is None:
            return None
        await self.broadcast({"type": "message.update", "chat_id": message["chat_id"], "message": message})
        if message["role"] == "bot":
            self.schedule_push(message["chat_id"], message_id, final=final)
        return message

    async def delete_message(self, message_id: str) -> bool:
        message = self.store.delete_message(message_id)
        if message is None:
            return False
        await self.broadcast({"type": "message.delete", "chat_id": message["chat_id"], "message_id": message_id})
        return True

    async def set_typing(self, chat_id: str, on: bool) -> None:
        """``on`` is re-sent every few seconds while the agent works; the app expires it after ~8s."""
        if not on and chat_id not in self._typing:
            return
        (self._typing.add if on else self._typing.discard)(chat_id)
        await self.broadcast({"type": "typing", "chat_id": chat_id, "on": on})
        if not on:
            # A turn ended: anything still marked as streaming (e.g. a tool-progress bubble) is done.
            for message in self.store.streaming_messages(chat_id):
                await self.edit_message(message["id"], message["text"], final=True)

    def add_media(self, path: str, name: Optional[str] = None) -> Dict[str, Any]:
        """Copy a local file the agent produced into Winglet's media store; returns an attachment."""
        src = Path(path)
        name = Path(name or src.name).name or "file"
        media_id = secrets.token_urlsafe(12)
        dest_dir = self.media_dir / media_id
        dest_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest_dir / name)
        mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
        kind = "image" if mime in INLINE_IMAGE_TYPES else mime.split("/")[0] if mime.split("/")[0] in (
            "audio", "video") else "file"
        # The link carries a signature for this one file, never the device's bearer token.
        return {"url": f"/api/media/{media_id}/{quote(name)}?sig={self.media_signature(media_id)}", "name": name,
                "mime": mime, "kind": kind, "size": (dest_dir / name).stat().st_size}

    def media_signature(self, media_id: str) -> str:
        key = self.store.secret("media_key").encode()
        return hmac.new(key, media_id.encode(), hashlib.sha256).hexdigest()[:32]

    async def h_media(self, request: web.Request) -> web.StreamResponse:
        media_id, name = request.match_info["media_id"], request.match_info["name"]
        sig = request.query.get("sig", "")
        if not (sig and hmac.compare_digest(sig, self.media_signature(media_id))):
            self._require(request)  # older links used the device token
        path = (self.media_dir / media_id / name).resolve()
        if self.media_dir.resolve() not in path.parents or not path.is_file():
            return _error(404, "not found")
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        inline = mime in INLINE_IMAGE_TYPES or mime.startswith(("audio/", "video/"))
        # Agent output is untrusted: an HTML or SVG file must never run as part of the app's origin.
        # Anything that isn't plain media downloads, and the sandbox CSP neuters it even if opened.
        headers = {
            "Cache-Control": "private, max-age=86400",
            "Content-Type": mime if inline else "application/octet-stream",
            "Content-Disposition": f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{quote(path.name)}",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "X-Content-Type-Options": "nosniff",
        }
        return web.FileResponse(path, headers=headers)

    # -- websocket -------------------------------------------------------------------------

    async def h_ws(self, request: web.Request) -> web.StreamResponse:
        device = self._device(request)
        if device is None:
            return _error(401, "not paired")
        ws = web.WebSocketResponse(heartbeat=25, max_msg_size=1024 * 1024)
        await ws.prepare(request)
        self._sockets[ws] = {"device": device}
        try:
            await ws.send_json({"type": "hello", "server_id": self.server_id(), "bot": self.bot(), "device": device,
                                "version": VERSION, "chats": self.store.list_chats(),
                                "typing": sorted(self._typing), "pending": self.store.pending_count()})
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    data = json.loads(msg.data)
                except ValueError:
                    continue
                await self._on_ws(ws, device, data)
        finally:
            self._sockets.pop(ws, None)
        return ws

    async def _on_ws(self, ws: web.WebSocketResponse, device: Dict[str, Any], data: Dict[str, Any]) -> None:
        if self.store.get_device(device["id"]) is None:
            await ws.close(code=4401, message=b"unpaired")
            return
        kind = data.get("type")
        if kind == "ping":
            await ws.send_json({"type": "pong", "t": data.get("t")})
        elif kind == "message.send":
            await self.user_message(device, str(data.get("chat_id") or ""), str(data.get("text") or ""),
                                    str(data.get("client_id") or ""))
        elif kind == "inbox.respond":
            await self.respond(str(data.get("id") or ""), choice=str(data.get("choice") or ""),
                               answer=data.get("answer"))
        elif kind == "presence":
            self._sockets[ws]["visible"] = bool(data.get("visible", True))

    def live_clients(self) -> int:
        """Sockets whose app is in the foreground (a backgrounded PWA may keep its socket briefly)."""
        return sum(1 for ws, meta in self._sockets.items() if not ws.closed and meta.get("visible", True))

    async def broadcast(self, event: Dict[str, Any]) -> None:
        dead = []
        for ws, meta in list(self._sockets.items()):
            if not self.device_alive(meta["device"]["id"]):
                dead.append(ws)
                with contextlib.suppress(Exception):
                    await ws.close(code=4401, message=b"unpaired")
                continue
            try:
                await ws.send_json(event)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._sockets.pop(ws, None)

    # -- push ------------------------------------------------------------------------------

    def schedule_push(self, chat_id: str, message_id: str, *, final: bool) -> None:
        """Debounced per chat so a streamed reply produces one notification with the final text."""
        task = self._push_tasks.pop(chat_id, None)
        if task is not None:
            task.cancel()
        delay = 0.3 if final else PUSH_DEBOUNCE_SECONDS
        self._push_tasks[chat_id] = asyncio.ensure_future(self._delayed_push(chat_id, message_id, delay))

    async def _delayed_push(self, chat_id: str, message_id: str, delay: float) -> None:
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        self._push_tasks.pop(chat_id, None)
        if self.live_clients():
            return
        message = self.store.get_message(message_id)
        if message is None or not message["text"].strip():
            return
        chat = self.store.get_chat(chat_id) or {"title": chat_id}
        bot = self.bot()["title"]
        title = bot if chat_id != HOME_CHAT_ID else f"{bot} · Update"
        if chat.get("kind") == "chat" and chat.get("title") not in ("", "General"):
            title = f"{bot} · {chat['title']}"
        await self.push_now({"title": title, "body": _clip(message["text"], 180), "url": self.chat_path(chat_id),
                             "kind": "message", "chat_id": chat_id}, tag=f"chat-{chat_id}")

    def chat_path(self, chat_id: str) -> str:
        """The app's route for a chat (bots are told apart by server id)."""
        return f"/chat/{quote(self.server_id(), safe='')}/{quote(chat_id, safe='')}"

    async def push_now(self, note: Dict[str, Any], *, tag: str, urgency: str = "normal",
                       item: Optional[Dict[str, Any]] = None) -> Dict[str, int]:
        """Send ``note`` to every subscription. Returns counts of deliveries the push services
        accepted, rejected, and dropped as expired (accepted is not proof the phone showed it)."""
        result = {"accepted": 0, "failed": 0, "expired": 0}
        subs = self.store.list_push_subs()
        if not subs:
            return result
        client = await self._client()
        note = {**note, "tag": tag, "server_id": self.server_id()}
        if item is not None and item["kind"] == "approval":
            note["actions"] = [{"action": c, "title": item["payload"].get("labels", {}).get(c, c.title()),
                                "sig": self.action_signature(item["id"], c)}
                               for c in item["payload"].get("choices", []) if c in ("once", "deny")]
        for sub in subs:
            try:
                if sub["kind"] == "webpush":
                    status = await webpush.send(client, sub["data"], note, self.vapid_private_key(), PUSH_SUBJECT,
                                                urgency=urgency, topic=tag)
                elif sub["kind"] == "ntfy":
                    status = await self._send_ntfy(client, sub["data"], note)
                else:
                    continue
            except Exception as exc:
                logger.warning("[winglet] push delivery failed: %s", exc)
                result["failed"] += 1
                continue
            if status in (404, 410) and sub["kind"] == "webpush":
                self.store.remove_push_sub(endpoint=sub["endpoint"])
                result["expired"] += 1
            elif status >= 300:
                logger.warning("[winglet] %s push rejected with HTTP %s", sub["kind"], status)
                result["failed"] += 1
            else:
                result["accepted"] += 1
        return result

    async def _client(self):
        if self._http is None:
            import httpx
            self._http = httpx.AsyncClient(timeout=15.0)
        return self._http

    async def aclose(self) -> None:
        if self._recovery_task:
            self._recovery_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._recovery_task
            self._recovery_task = None
        if self._http is not None:
            with contextlib.suppress(Exception):
                await self._http.aclose()
            self._http = None

    def vapid_private_key(self) -> str:
        return self.store.secret("vapid_private_pem", webpush.generate_vapid_private_key)

    async def h_vapid(self, request: web.Request) -> web.Response:
        return _json({"public_key": webpush.vapid_public_key(self.vapid_private_key())})

    async def h_webpush_subscribe(self, request: web.Request) -> web.Response:
        device = self._require(request)
        body = await self._body(request)
        sub = body.get("subscription") or body
        endpoint = str(sub.get("endpoint") or "") if isinstance(sub, dict) else ""
        keys = (sub.get("keys") if isinstance(sub, dict) else None) or {}
        try:
            valid = (endpoint.startswith("https://") and len(webpush.b64url_decode(keys["p256dh"])) == 65
                     and len(webpush.b64url_decode(keys["auth"])) >= 16)
        except Exception:
            valid = False
        if not valid:
            return _error(400, "invalid push subscription")
        self.store.add_push_sub(device["id"], "webpush", endpoint,
                                {"endpoint": endpoint, "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]}})
        return _json({"ok": True})

    async def h_webpush_unsubscribe(self, request: web.Request) -> web.Response:
        device = self._require(request)
        body = await self._body(request)
        removed = self.store.remove_push_sub(endpoint=str(body.get("endpoint") or ""), device_id=device["id"])
        return _json({"ok": True, "removed": removed})

    async def h_ntfy(self, request: web.Request) -> web.Response:
        """Enable ntfy delivery for this device and return the private topic to subscribe to."""
        device = self._require(request)
        legacy_shared = self.store.get_kv("ntfy_topic")  # v0.1 gave every phone the same topic
        mine = [sub for sub in self.store.list_push_subs("ntfy")
                if sub["device_id"] == device["id"] and sub["data"].get("topic") != legacy_shared]
        if mine:
            topic = mine[0]["data"]["topic"]
        else:
            # One private topic per phone: unpairing a phone stops exactly its notifications.
            topic = "winglet-" + secrets.token_hex(12)
            if legacy_shared:
                self.store.remove_push_sub(endpoint=f"{self.ntfy_server}/{legacy_shared}", device_id=device["id"])
            self.store.add_push_sub(device["id"], "ntfy", f"{self.ntfy_server}/{topic}",
                                    {"server": self.ntfy_server, "topic": topic})
        return _json({"server": self.ntfy_server, "topic": topic,
                      "subscribe_url": f"{self.ntfy_server}/{topic}"})

    async def _send_ntfy(self, client, data: Dict[str, Any], note: Dict[str, Any]) -> int:
        # ntfy topics transit a third-party server, so only generic text is sent there.
        generic = {"approval": "needs your approval", "question": "has a question for you"}.get(
            note.get("kind", ""), "sent you a message")
        payload = {"topic": data["topic"], "title": self.bot()["title"], "message": f"{self.bot()['title']} {generic}",
                   "tags": ["winglet"], "priority": 4 if note.get("kind") in ("approval", "question") else 3,
                   # Opens the Android app on the same route the web notification uses.
                   "click": f"winglet:/{note.get('url') or '/'}"}
        resp = await client.post(data["server"], json=payload, timeout=15.0)
        return resp.status_code

    async def h_push_test(self, request: web.Request) -> web.Response:
        self._require(request)
        result = await self.push_now({"title": self.bot()["title"], "body": "Notifications are working 🎉",
                                      "url": "/", "kind": "test"}, tag="test")
        return _json({"ok": result["accepted"] > 0, **result})

    # -- static web app -----------------------------------------------------------------------

    async def h_static(self, request: web.Request) -> web.StreamResponse:
        tail = request.match_info.get("tail", "")
        if tail.startswith("api/"):
            return _error(404, "not found")
        root = self.web_root
        if root is None or not (root / "index.html").is_file():
            return web.Response(text=_NO_WEB_BUILD, content_type="text/html")
        root = root.resolve()
        candidate = (root / tail).resolve() if tail else root / "index.html"
        inside = candidate == root / "index.html" or root in candidate.parents
        found = inside and candidate.is_file()
        if not found:
            # A missing file (font, script, icon) is a 404, not the HTML shell: a browser handed HTML
            # for a font or script fails in confusing ways, and must not cache that answer.
            if "." in Path(tail).name or tail.startswith(("_expo/", "assets/")):
                return web.Response(status=404, text="not found", headers={"Cache-Control": "no-store"})
            # Client-side routes (/chat/abc) fall back to the SPA shell; Expo also emits <route>.html.
            html = (root / f"{tail}.html").resolve() if tail else None
            candidate = html if html and root in html.parents and html.is_file() else root / "index.html"
        headers = {"Cache-Control": "no-cache"}
        if found and tail.startswith(("_expo/static/", "assets/")):
            headers["Cache-Control"] = "public, max-age=31536000, immutable"
        ctype = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if candidate.suffix == ".webmanifest":
            ctype = "application/manifest+json"
        return web.FileResponse(candidate, headers={**headers, "Content-Type": ctype})

    @staticmethod
    async def _body(request: web.Request) -> Dict[str, Any]:
        if not request.can_read_body:
            return {}
        try:
            data = await request.json()
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}


_NO_WEB_BUILD = """<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width">
<title>Winglet</title><body style="background:#1e1f22;color:#dbdee1;font:16px system-ui;padding:32px">
<h2>🪽 Winglet is running</h2><p>The web app isn't bundled in this install. Reinstall the plugin from a
release, or use the Android app.</p></body>"""
