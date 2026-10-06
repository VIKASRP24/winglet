"""Winglet hub: the HTTP/WebSocket server the app talks to, plus push delivery.

Independent of Hermes internals so it can be tested on its own. The platform adapter
(``adapter.py``) owns a Hub and plugs Hermes into it through a few callbacks.

Wire protocol (JSON over one WebSocket at ``/api/ws``; the app's first frame is
``{"type": "auth", "token"}`` so the token never sits in a URL; ``?token=`` still works for older apps):

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
import re
import os
import secrets
import shutil
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set
from urllib.parse import quote, unquote

from aiohttp import WSMsgType, web

from . import keys, recovery, uploads, webpush
from .store import ROLES, Store, new_id

logger = logging.getLogger(__name__)

VERSION = "0.1.2"
# Wire protocol: bumped only for breaking changes. The app compares these to its own and asks for
# whichever side is out of date to be updated.
PROTOCOL = 2
MIN_APP_PROTOCOL = 1
HOME_CHAT_ID = "home"
PUSH_DEBOUNCE_SECONDS = 2.5
MAX_TEXT = 16_000
PUSH_SUBJECT = "https://github.com/VIKASRP24/winglet"
PAIR_FAILURES_PER_MINUTE = 10
ALIVE_CACHE_SECONDS = 2.0
MAX_ATTACHMENTS = 10
UNSENT_UPLOAD_SECONDS = 24 * 3600
JANITOR_SECONDS = 3600
REPLY_EXCERPT = 280
# How long a model/choice/confirm picker stays answerable (Hermes's own slash confirmations time out
# after five minutes; the card says so when it's too late).
PICKER_SECONDS = 10 * 60
MAX_PERSONA = 20_000
_KEY_ENV = re.compile(r"^[A-Z][A-Z0-9_]{1,62}(_API_KEY|_KEY|_TOKEN)$")
REPLY_CONTEXT = 4000
# Raster formats only: SVG is a document that can carry script.
INLINE_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"}

InboundFn = Callable[..., Awaitable[None]]
ResolveFn = Callable[[Dict[str, Any], Any], Awaitable[bool]]


class MessageRejected(ValueError):
    """A message the server won't accept (bad attachments, reply to a missing message, ...)."""


class Forbidden(PermissionError):
    """The device is paired but its role doesn't allow this."""


# Who may call each route; the policy middleware enforces it before any handler runs, and a test checks
# that every route is listed. A route missing from the table needs an owner's signed request.
#   public        no token; the handler checks anything it needs itself
#   device        any paired device (handlers still limit members to their own chats)
#   owner         an owner device
#   signed        any verified device, with a signed request
#   owner_signed  an owner's verified device, with a signed request: every control action
ROUTE_POLICY = {
    "h_info": "public", "h_pair": "public", "h_ws": "public", "h_static": "public", "h_media": "public",
    "h_vapid": "public", "h_inbox_respond": "public", "h_server_key": "public",
    "h_me": "device", "h_connection": "device", "h_unpair": "device", "h_chats": "device",
    "h_chat_create": "device", "h_chat_rename": "device", "h_chat_delete": "device", "h_messages": "device",
    "h_message_send": "device", "h_upload": "device", "h_export": "device", "h_commands": "device",
    "h_push_prefs": "device", "h_push_prefs_put": "device", "h_inbox": "device", "h_webpush_subscribe": "device",
    "h_webpush_unsubscribe": "device", "h_ntfy": "device", "h_push_test": "device", "h_device_verify": "device",
    "h_devices": "owner", "h_audit": "owner",
    "h_agent": "device", "h_picker_select": "owner",
    "h_models": "owner", "h_providers": "owner", "h_identity": "owner", "h_memory": "owner", "h_usage": "owner",
    "h_model_default": "owner_signed", "h_provider_key": "owner_signed", "h_provider_key_delete": "owner_signed",
    "h_identity_put": "owner_signed", "h_memory_edit": "owner_signed",
    "h_rotate_token": "signed",
    "h_device_update": "owner_signed", "h_device_delete": "owner_signed", "h_pairing_code": "owner_signed",
}

# Slash commands a member may send: their own conversation and turn, and read-only help. Everything
# else, including unknown and future commands and skills, is for owners. Names are Hermes's canonical
# command names; aliases resolve to them.
MEMBER_COMMANDS = frozenset({"new", "retry", "undo", "title", "stop", "queue", "steer", "btw", "background",
                             "status", "help"})


def _env_mb(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name) or default)) * 1024 * 1024
    except ValueError:
        return default * 1024 * 1024


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
        self._janitor: Optional[asyncio.Task] = None
        # Upload limits: one file, one device per day, and everything stored. Overridable in .env.
        self.max_upload_bytes = _env_mb("WINGLET_MAX_UPLOAD_MB", 50)
        self.device_daily_upload_bytes = _env_mb("WINGLET_DAILY_UPLOAD_MB", 500)
        self.total_upload_bytes = _env_mb("WINGLET_UPLOAD_STORAGE_MB", 4096)
        # Optional providers installed by the adapter (the hub never imports Hermes).
        self.commands_provider: Optional[Callable[[], List[Dict[str, Any]]]] = None
        # Resolves a typed command or alias to Hermes's canonical name ("" when unknown).
        self.command_resolver: Optional[Callable[[str], Optional[str]]] = None
        self.keys = keys.ServerKeys(store)
        # Hermes functions for model, providers, persona, memory and usage (plugin/hermes_api.py),
        # installed by the adapter; None turns those features off.
        self.hermes: Any = None
        # chat id -> the model that chat is really using, when Hermes knows (installed by the adapter).
        self.chat_model: Optional[Callable[[str], Optional[Dict[str, Any]]]] = None
        self._pickers: Dict[str, Dict[str, Any]] = {}
        # Hermes-side callbacks, installed by the adapter.
        self.on_user_message: Optional[InboundFn] = None
        self.on_approval: Optional[ResolveFn] = None
        self.on_answer: Optional[ResolveFn] = None
        # Installed by the adapter; the hub itself never imports Hermes.
        self.hermes_version: Callable[[], str] = lambda: ""
        self.store.ensure_chat(HOME_CHAT_ID, "Updates", kind="home")

    # -- lifecycle -------------------------------------------------------------------

    def build_app(self) -> web.Application:
        app = web.Application(client_max_size=2 * 1024 * 1024, middlewares=[self._cors, self._policy])
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
        r.add_post("/api/chats/{chat_id}/uploads", self.h_upload)
        r.add_get("/api/chats/{chat_id}/export", self.h_export)
        r.add_get("/api/commands", self.h_commands)
        r.add_get("/api/push/prefs", self.h_push_prefs)
        r.add_put("/api/push/prefs", self.h_push_prefs_put)
        r.add_get("/api/inbox", self.h_inbox)
        r.add_post("/api/inbox/{item_id}/respond", self.h_inbox_respond)
        r.add_get("/api/push/vapid", self.h_vapid)
        r.add_post("/api/push/webpush", self.h_webpush_subscribe)
        r.add_delete("/api/push/webpush", self.h_webpush_unsubscribe)
        r.add_get("/api/push/ntfy", self.h_ntfy)
        r.add_post("/api/push/test", self.h_push_test)
        r.add_get("/api/media/{media_id}/{name}", self.h_media)
        r.add_get("/api/server-key", self.h_server_key)
        r.add_get("/api/devices", self.h_devices)
        r.add_patch("/api/devices/{device_id}", self.h_device_update)
        r.add_delete("/api/devices/{device_id}", self.h_device_delete)
        r.add_post("/api/devices/pairing-code", self.h_pairing_code)
        r.add_post("/api/devices/verify", self.h_device_verify)
        r.add_post("/api/devices/me/rotate-token", self.h_rotate_token)
        r.add_get("/api/audit", self.h_audit)
        r.add_get("/api/agent", self.h_agent)
        r.add_post("/api/pickers/{picker_id}/select", self.h_picker_select)
        r.add_get("/api/models", self.h_models)
        r.add_put("/api/models/default", self.h_model_default)
        r.add_get("/api/providers", self.h_providers)
        r.add_post("/api/providers/key", self.h_provider_key)
        r.add_delete("/api/providers/key/{env}", self.h_provider_key_delete)
        r.add_get("/api/identity", self.h_identity)
        r.add_put("/api/identity", self.h_identity_put)
        r.add_get("/api/memory", self.h_memory)
        r.add_post("/api/memory", self.h_memory_edit)
        r.add_get("/api/usage", self.h_usage)
        r.add_get("/{tail:.*}", self.h_static)
        app.on_startup.append(self._start_janitor)
        app.on_shutdown.append(self._close_sockets)
        return app

    async def _start_janitor(self, _app: web.Application) -> None:
        if self._janitor is None:
            self._janitor = asyncio.create_task(self._janitor_loop())

    async def _janitor_loop(self) -> None:
        while True:
            try:
                self.sweep_uploads()
            except Exception:
                logger.warning("[winglet] upload cleanup failed", exc_info=True)
            await asyncio.sleep(JANITOR_SECONDS)

    def sweep_uploads(self, now: Optional[float] = None) -> int:
        """Delete uploads that were never sent within a day: drafts abandoned, sends that never happened."""
        removed = 0
        for row in self.store.stale_uploads((now or time.time()) - UNSENT_UPLOAD_SECONDS):
            self._remove_upload(row)
            removed += 1
        return removed

    def _remove_upload(self, row: Dict[str, Any]) -> None:
        directory = (self.media_dir / row["id"]).resolve()
        if self.media_dir.resolve() in directory.parents:
            shutil.rmtree(directory, ignore_errors=True)
        self.store.delete_upload(row["id"])

    async def _close_sockets(self, _app: web.Application) -> None:
        for ws in list(self._sockets):
            with contextlib.suppress(Exception):
                await ws.close()
        for task in self._push_tasks.values():
            task.cancel()
        self._push_tasks.clear()
        if self._janitor is not None:
            self._janitor.cancel()
            self._janitor = None

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
            resp.headers["Access-Control-Allow-Headers"] = ("Authorization, Content-Type, X-Winglet-Device, "
                                                            "X-Winglet-Time, X-Winglet-Nonce, X-Winglet-Signature")
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            resp.headers.setdefault("Cache-Control", "no-store")
        return resp

    # -- auth ------------------------------------------------------------------------

    def _device(self, request: web.Request) -> Optional[Dict[str, Any]]:
        auth = request.headers.get("Authorization", "")
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else request.query.get("token", "")
        return self.store.device_for_token(token)

    def _require(self, request: web.Request) -> Dict[str, Any]:
        device = request.get("device") or self._device(request)
        if device is None:
            raise web.HTTPUnauthorized(text=json.dumps({"error": "not paired"}), content_type="application/json")
        return device

    @web.middleware
    async def _policy(self, request: web.Request, handler):
        if request.match_info.http_exception is not None:
            return await handler(request)  # 404/405: nothing to protect
        name = getattr(request.match_info.route.handler, "__name__", "")
        level = ROUTE_POLICY.get(name, "owner_signed")
        if level == "public":
            return await handler(request)
        device = self._device(request)
        if device is None:
            return _error(401, "not paired")
        if level in ("owner", "owner_signed") and device["role"] != "owner":
            return _error(403, "Only an owner can do that.")
        if level in ("signed", "owner_signed"):
            problem = await self._signature_problem(request, device)
            if problem:
                logger.warning("[winglet] refused %s %s from %s: %s", request.method, request.path, device["name"], problem)
                self.store.add_audit("refused", device=device, summary=f"{request.method} {request.path}: {problem}",
                                     outcome="refused")
                return _error(403, problem)
        request["device"] = device
        try:
            return await handler(request)
        except Forbidden as exc:
            return _error(403, str(exc))

    async def _signature_problem(self, request: web.Request, device: Dict[str, Any]) -> Optional[str]:
        """Why a control request can't run, or None when it's signed by this device's verified key, fresh,
        and never seen before. A bearer token alone never passes."""
        sign_key = self.store.device_sign_key(device["id"])
        if not sign_key:
            return "Verify this device first: scan a new pairing code from your server or another owner's phone."
        h = request.headers
        stamp, nonce, signature = h.get("X-Winglet-Time", ""), h.get("X-Winglet-Nonce", ""), h.get("X-Winglet-Signature", "")
        if not (stamp and nonce and signature) or h.get("X-Winglet-Device") != device["id"]:
            return "This action needs a signed request from the app."
        try:
            skew = abs(time.time() - float(stamp))
        except ValueError:
            return "This action needs a signed request from the app."
        if skew > keys.CLOCK_SKEW_SECONDS:
            return "This request has expired. Check that this device's clock is right, then try again."
        if not 16 <= len(nonce) <= 64:
            return "This action needs a signed request from the app."
        payload = keys.signing_payload(request.method, request.raw_path, await request.read(), device["id"], stamp, nonce)
        if not keys.verify_device_signature(sign_key, payload, signature):
            return "The request's signature doesn't match this device."
        if not self.store.use_nonce(nonce, keys.CLOCK_SKEW_SECONDS):
            return "This request was already used."
        return None

    # -- who sees what -------------------------------------------------------------------

    @staticmethod
    def can_see(device: Optional[Dict[str, Any]], chat: Optional[Dict[str, Any]]) -> bool:
        """Owners see every chat; a member sees the chats they started."""
        if chat is None or device is None:
            return False
        return device.get("role") == "owner" or chat.get("owner_device") == device["id"]

    def _visible_chat(self, device: Dict[str, Any], chat_id: str) -> Dict[str, Any]:
        chat = self.store.get_chat(chat_id)
        if not self.can_see(device, chat):
            raise web.HTTPNotFound(text=json.dumps({"error": "This chat was deleted."}), content_type="application/json")
        return chat

    def visible_chats(self, device: Dict[str, Any]) -> List[Dict[str, Any]]:
        return [c for c in self.store.list_chats() if self.can_see(device, c)]

    def pending_for(self, device: Dict[str, Any]) -> int:
        if device.get("role") == "owner":
            return self.store.pending_count()
        return sum(1 for i in self.store.pending_items() if self.can_see(device, self.store.get_chat(i["chat_id"])))

    def home_chat(self, device: Dict[str, Any]) -> str:
        """Owners share the main chat. Each member gets one of their own, made on first use."""
        if device.get("role") == "owner":
            return "general"
        chat_id = "m-" + device["id"]
        self.store.ensure_chat(chat_id, device["name"], owner_device=device["id"])
        return chat_id

    def me(self, device: Dict[str, Any]) -> Dict[str, Any]:
        return {"id": device["id"], "name": device["name"], "role": device["role"], "verified": device["verified"],
                "home_chat": self.home_chat(device)}

    def audit(self, action: str, device: Optional[Dict[str, Any]], summary: str = "", outcome: str = "ok") -> None:
        self.store.add_audit(action, device=device, summary=summary, outcome=outcome)

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

    def current_device(self, device_id: str) -> Optional[Dict[str, Any]]:
        """A device as it is now, or None once unpaired. Unpairing or a role change can happen in
        another process (the CLI), so this reads the database, cached for a moment to keep streaming
        broadcasts cheap."""
        now = time.monotonic()
        cached = self._alive_cache.get(device_id)
        if cached and now - cached[1] < ALIVE_CACHE_SECONDS:
            return cached[0]
        device = self.store.get_device(device_id)
        self._alive_cache[device_id] = (device, now)
        return device

    def device_alive(self, device_id: str) -> bool:
        return self.current_device(device_id) is not None

    def features(self) -> Dict[str, bool]:
        """What this server can do. The app hides anything that isn't listed as true."""
        return {"webpush": True, "ntfy": True, "approvals": True, "questions": True, "uploads": True, "voice": True,
                "replies": True, "export": True, "mute": True, "status_updates": True, "roles": True,
                "signed_actions": True, "ws_auth": True, "pickers": True, "agent": self.hermes is not None,
                "commands": self.commands_provider is not None}

    def about(self) -> Dict[str, Any]:
        return {"version": VERSION, "protocol": PROTOCOL, "min_app_protocol": MIN_APP_PROTOCOL,
                "hermes_version": self.hermes_version() or "", "features": self.features()}

    async def h_info(self, request: web.Request) -> web.Response:
        return _json({"app": "winglet", "server_id": self.server_id(), "bot": self.bot(),
                      "connection": self.connection, **self.about()})

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
        sign_key, verified = "", False
        if body.get("sealed"):
            # Current apps seal the request to the server key whose fingerprint was in the QR code, so
            # nobody in between can swap in their own signing key.
            try:
                body = self.keys.unseal_json(str(body["sealed"]), "pair")
            except (keys.SealError, ValueError):
                self._pair_failures[peer] = recent + [now]
                return _error(400, "This pairing request couldn't be opened. Scan a new code and try again.")
            sign_key = str(body.get("sign_key") or "")
            if sign_key and not keys.valid_public_key(sign_key):
                return _error(400, "invalid signing key")
            verified = bool(sign_key) and body.get("pinned") is True
        role = self.store.redeem_pair_code(str(body.get("code") or ""))
        if role is None:
            self._pair_failures[peer] = recent + [now]
            return _error(403, "This pairing code is invalid or expired. Run `hermes winglet pair` for a new one.")
        self._pair_failures.pop(peer, None)
        device, token = self.store.add_device(str(body.get("device_name") or ""), str(body.get("platform") or ""),
                                              role=role, sign_key=sign_key, verified=verified)
        logger.info("[winglet] paired new device %s (%s) as %s", device["name"], device["platform"] or "unknown", role)
        self.audit("device.paired", device, f"{device['name']} ({device['platform'] or 'unknown'}) as {role}"
                   + ("" if verified else ", not verified"))
        address = self._recovery_credentials(device) if device["platform"] == "android" else None
        return _json({"token": token, "device": device, "me": self.me(device), "server_id": self.server_id(),
                      "bot": self.bot(), "recovery": address})

    async def h_server_key(self, request: web.Request) -> web.Response:
        return _json(self.keys.public_info())

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
        return _json({"device": device, "me": self.me(device), "bot": self.bot(), "server_id": self.server_id()})

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
        device = self._require(request)
        return _json({"chats": self.visible_chats(device)})

    async def h_chat_create(self, request: web.Request) -> web.Response:
        device = self._require(request)
        body = await self._body(request)
        chat = self.store.create_chat(str(body.get("title") or ""),
                                      owner_device=None if device["role"] == "owner" else device["id"])
        await self.broadcast({"type": "chat.update", "chat": chat})
        return _json({"chat": chat})

    async def h_chat_rename(self, request: web.Request) -> web.Response:
        device = self._require(request)
        self._visible_chat(device, request.match_info["chat_id"])
        body = await self._body(request)
        chat = self.store.rename_chat(request.match_info["chat_id"], str(body.get("title") or ""))
        if chat is None:
            return _error(404, "no such chat")
        await self.broadcast({"type": "chat.update", "chat": chat})
        return _json({"chat": chat})

    async def h_chat_delete(self, request: web.Request) -> web.Response:
        device = self._require(request)
        chat_id = request.match_info["chat_id"]
        if chat_id == HOME_CHAT_ID:
            return _error(400, "the Updates chat can't be deleted")
        chat = self._visible_chat(device, chat_id)
        if device["role"] != "owner" and chat_id == self.home_chat(device):
            return _error(400, "This is your main chat; it can't be deleted.")
        files = self.store.chat_uploads(chat_id)
        if not self.store.delete_chat(chat_id):
            return _error(404, "no such chat")
        for row in files:
            self._remove_upload(row)
        await self.broadcast({"type": "chat.delete", "chat_id": chat_id, "owner_device": chat.get("owner_device")})
        return _json({"ok": True})

    async def h_messages(self, request: web.Request) -> web.Response:
        device = self._require(request)
        chat_id = request.match_info["chat_id"]
        self._visible_chat(device, chat_id)
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
        self._visible_chat(device, request.match_info["chat_id"])
        attachments = body.get("attachments") or []
        if not isinstance(attachments, list) or not all(isinstance(a, str) for a in attachments):
            return _error(400, "attachments must be a list of upload ids")
        try:
            message = await self.user_message(device, request.match_info["chat_id"], str(body.get("text") or ""),
                                              str(body.get("client_id") or ""), attachments=attachments,
                                              reply_to=str(body.get("reply_to") or ""),
                                              hidden=body.get("hidden") is True)
        except MessageRejected as exc:
            return _error(400, str(exc))
        if message is None:
            return _error(400, "empty message")
        return _json({"message": message})

    async def user_message(self, device: Dict[str, Any], chat_id: str, text: str,
                           client_id: str = "", *, attachments: Optional[List[str]] = None,
                           reply_to: str = "", hidden: bool = False) -> Optional[Dict[str, Any]]:
        text = (text or "").strip()[:MAX_TEXT]
        attachments = list(dict.fromkeys(attachments or []))
        if (not text and not attachments) or not chat_id:
            return None
        if len(attachments) > MAX_ATTACHMENTS:
            raise MessageRejected(f"At most {MAX_ATTACHMENTS} attachments per message.")
        if client_id:
            # A retry of something we already have (the reply to the first try was lost): don't run it twice.
            existing = self.store.find_user_message(chat_id, client_id)
            if existing is not None:
                return existing
        chat = self.store.get_chat(chat_id)
        if not self.can_see(device, chat):
            return None  # deleted (or never created, or someone else's): don't bring it back
        refused = self._refused_command(device, text)
        meta: Dict[str, Any] = {"device": device["name"], "client_id": client_id}
        if hidden and text.startswith("/") and not attachments:
            # A command the app sent for a control (the model chip's /model): kept for the record, not shown.
            meta["hidden"] = True
        reply = None
        if reply_to:
            quoted = self.store.get_message(reply_to)
            if quoted is None or quoted["chat_id"] != chat_id:
                raise MessageRejected("The message you replied to no longer exists.")
            reply = {"id": quoted["id"], "role": quoted["role"], "text": quoted["text"][:REPLY_CONTEXT]}
            meta["reply_to"] = {"id": quoted["id"], "role": quoted["role"], "text": _clip(quoted["text"], REPLY_EXCERPT)}
        message_id = new_id()
        files: List[Dict[str, Any]] = []
        if attachments:
            rows = self.store.claim_uploads(attachments, device["id"], chat_id, message_id)
            if rows is None:
                raise MessageRejected("An attachment is missing, expired, or was already sent. Attach it again.")
            meta["attachments"] = [self._upload_public(row) for row in rows]
            files = [{"path": str(self.media_dir / row["id"] / row["name"]), "name": row["name"], "mime": row["mime"],
                      "kind": row["kind"]} for row in rows]
        message = self.store.add_message(chat_id, "user", text, meta=meta, message_id=message_id)
        await self.broadcast({"type": "message.new", "chat_id": chat_id, "message": message})
        await self.broadcast({"type": "chat.update", "chat": self.store.get_chat(chat_id)})
        if refused:
            # Hermes never sees it: members can't change settings or approve through a slash command either.
            await self.post_message(chat_id, f"Only an owner can use {refused}.", role="system", push=False)
            return message
        if self.on_user_message is not None:
            extra: Dict[str, Any] = {}
            if files:
                extra["files"] = files
            if reply:
                extra["reply"] = reply
            try:
                await self.on_user_message(chat, text, device, message, **extra)
            except Exception:
                logger.exception("[winglet] failed to hand message to Hermes")
                await self.post_message(chat_id, "⚠️ Couldn't reach the agent. Check the gateway logs.",
                                        role="system", push=False)
        return message

    def _refused_command(self, device: Dict[str, Any], text: str) -> str:
        """The slash command a member typed that's for owners only, or "" when the message may go through."""
        if device.get("role") == "owner" or not text.startswith("/"):
            return ""
        typed = text[1:].split(maxsplit=1)[0].split("@")[0].lower() if text[1:].strip() else ""
        if not typed:
            return ""
        name = typed
        if self.command_resolver is not None:
            try:
                name = self.command_resolver(typed) or ""
            except Exception:
                name = ""
        return "" if name in MEMBER_COMMANDS else f"/{typed}"

    # -- uploads, export, commands ---------------------------------------------------------

    def _upload_public(self, row: Dict[str, Any]) -> Dict[str, Any]:
        """What the app sees about an upload: never the server path."""
        return {"id": row["id"], "name": row["name"], "mime": row["mime"], "kind": row["kind"], "size": row["size"],
                "url": f"/api/media/{row['id']}/{quote(row['name'])}?sig={self.media_signature(row['id'])}"}

    async def h_upload(self, request: web.Request) -> web.Response:
        """Receive one file for a chat. It's held for a day until a message attaches it."""
        device = self._require(request)
        chat_id = request.match_info["chat_id"]
        self._visible_chat(device, chat_id)
        day_used = self.store.upload_bytes_since(device["id"], time.time() - 86400)
        day_left = self.device_daily_upload_bytes - day_used
        store_left = self.total_upload_bytes - self.store.total_upload_bytes()
        if day_left <= 0:
            return _error(429, "You've reached today's upload limit for this device. Try again tomorrow.")
        if store_left <= 0:
            return _error(507, "The server's upload storage is full. Delete old chats or raise WINGLET_UPLOAD_STORAGE_MB.")
        limit = min(self.max_upload_bytes, day_left, store_left)
        try:
            reader = await request.multipart()
        except Exception:
            return _error(400, "expected a multipart upload")
        voice = False
        upload_id = secrets.token_urlsafe(12)
        directory = self.media_dir / upload_id
        try:
            async for part in _parts(reader):
                if part.name == "kind":
                    voice = (await part.text()).strip() == "voice"
                    continue
                if part.name != "file":
                    continue
                # Some clients percent-encode the name (RFC 5987); decode before stripping directories.
                name = uploads.safe_name(unquote(part.filename or ""), "voice-note" if voice else "file")
                directory.mkdir(parents=True, exist_ok=True)
                partial = directory / ".partial"
                size, head = 0, b""
                with open(partial, "wb") as out:
                    while chunk := await part.read_chunk(256 * 1024):
                        size += len(chunk)
                        if size > limit:
                            raise _TooLarge()
                        if len(head) < 512:
                            head += chunk[: 512 - len(head)]
                        out.write(chunk)
                if size == 0:
                    raise MessageRejected("That file is empty.")
                mime = uploads.sniff_mime(head, name)
                if voice:
                    mime = uploads.voice_mime(mime)
                partial.rename(directory / name)
                row = self.store.add_upload(upload_id, device["id"], chat_id, name, mime, uploads.kind_of(mime, voice), size)
                return _json({"upload": self._upload_public(row)})
        except _TooLarge:
            shutil.rmtree(directory, ignore_errors=True)
            mb = limit // (1024 * 1024)
            reason = "the per-file limit" if limit == self.max_upload_bytes else "what's left of today's or the server's allowance"
            return _error(413, f"That file is larger than {mb} MB, {reason}.")
        except MessageRejected as exc:
            shutil.rmtree(directory, ignore_errors=True)
            return _error(400, str(exc))
        except Exception:
            shutil.rmtree(directory, ignore_errors=True)
            logger.warning("[winglet] upload failed", exc_info=True)
            return _error(400, "The upload was interrupted. Try again.")
        return _error(400, "no file in the upload")

    async def h_export(self, request: web.Request) -> web.Response:
        """The whole chat as Markdown, to save or share."""
        device = self._require(request)
        chat = self._visible_chat(device, request.match_info["chat_id"])
        bot = self.bot()["title"]
        title = "Updates" if chat["kind"] == "home" else chat["title"]
        lines = [f"# {title}", "", f"_Exported from Winglet · {bot}_", ""]
        for m in self.store.all_messages(chat["id"]):
            if (m.get("meta") or {}).get("hidden"):
                continue
            when = time.strftime("%Y-%m-%d %H:%M", time.localtime(m["created_at"]))
            if m["role"] == "system":
                lines += [f"> {m['text']}", ""]
                continue
            who = bot if m["role"] == "bot" else "You"
            lines += [f"**{who}** · {when}", "", m["text"] or ""]
            for a in (m.get("meta") or {}).get("attachments") or []:
                lines.append(f"- 📎 {a.get('name', 'attachment')}")
            lines.append("")
        safe = uploads.safe_name(f"{title}.md", "chat.md")
        return web.Response(text="\n".join(lines), content_type="text/markdown", charset="utf-8",
                            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(safe)}"})

    async def h_commands(self, request: web.Request) -> web.Response:
        """Slash commands this Hermes accepts from the app, with their hints."""
        device = self._require(request)
        commands: List[Dict[str, Any]] = []
        if self.commands_provider is not None:
            try:
                commands = list(self.commands_provider() or [])
            except Exception:
                logger.debug("[winglet] command list unavailable", exc_info=True)
        commands = commands or _DEFAULT_COMMANDS
        if device["role"] != "owner":
            commands = [c for c in commands if not self._refused_command(device, str(c.get("cmd") or ""))]
        return _json({"commands": commands})

    async def h_push_prefs(self, request: web.Request) -> web.Response:
        device = self._require(request)
        return _json({"prefs": self.store.get_push_prefs(device["id"])})

    async def h_push_prefs_put(self, request: web.Request) -> web.Response:
        """This device's notification preferences: muted chats and quiet hours."""
        device = self._require(request)
        body = await self._body(request)
        try:
            prefs = _clean_push_prefs(body.get("prefs") if isinstance(body.get("prefs"), dict) else body)
        except ValueError as exc:
            return _error(400, str(exc))
        return _json({"prefs": self.store.set_push_prefs(device["id"], prefs)})

    # -- inbox ---------------------------------------------------------------------------

    async def h_inbox(self, request: web.Request) -> web.Response:
        device = self._require(request)
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
        if device["role"] != "owner":
            items = [i for i in items if self.can_see(device, self.store.get_chat(i["chat_id"]))]
        return _json({"items": items, "pending": self.pending_for(device)})

    async def h_inbox_respond(self, request: web.Request) -> web.Response:
        item_id = request.match_info["item_id"]
        body = await self._body(request)
        choice = str(body.get("choice") or request.query.get("choice") or "")
        answer = body.get("answer")
        device = self._device(request)
        if device is None:
            # Older notifications carried signed action links. Only "deny" is honoured from one: an
            # approval must be given from the card itself, where the whole command is visible.
            sig = str(body.get("sig") or request.query.get("sig") or "")
            if not (choice == "deny" and hmac.compare_digest(sig, self.action_signature(item_id, choice))):
                return _error(401, "not paired")
        try:
            ok, item = await self.respond(item_id, choice=choice, answer=answer, device=device)
        except Forbidden as exc:
            return _error(403, str(exc))
        if item is None:
            return _error(404, "no such item")
        return _json({"ok": ok, "item": item}, status=200 if ok else 409)

    async def respond(self, item_id: str, *, choice: str = "", answer: Any = None,
                      device: Optional[Dict[str, Any]] = None) -> tuple[bool, Optional[Dict]]:
        """Answer an inbox card. ``device`` is who's answering; None only for an old notification's
        deny link, which the caller has already checked."""
        item = self.store.get_inbox(item_id)
        if item is None or (device is not None and not self.can_see(device, self.store.get_chat(item["chat_id"]))):
            return False, None
        if item["status"] != "pending":
            return False, item
        if item["kind"] == "approval" and device is not None and device["role"] != "owner":
            raise Forbidden("Only an owner can approve or deny commands. It's waiting in their inbox.")
        ok = False
        if item["kind"] == "approval":
            if choice not in (item["payload"].get("choices") or []):
                return False, item
            ok = bool(self.on_approval and await self.on_approval(item, choice))
            resolution = choice
            if ok:
                self.audit("approval", device, f"{choice}: {_clip(item['payload'].get('command') or item['title'], 120)}")
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
        # Tapping it opens exactly this card in the app.
        url = f"/inbox?server={quote(self.server_id(), safe='')}&item={quote(item['id'], safe='')}"
        return {"title": f"{bot} · {item['title']}", "body": _clip(item["body"], 180),
                "url": url, "kind": item["kind"], "item_id": item["id"],
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
        # Uploads were sniffed on arrival; never trust a file's extension over its bytes.
        upload = self.store.get_upload(media_id)
        mime = upload["mime"] if upload else mimetypes.guess_type(path.name)[0] or "application/octet-stream"
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
        legacy = bool(request.query.get("token")) or request.headers.get("Authorization", "").lower().startswith("bearer ")
        device = self._device(request) if legacy else None
        if legacy and device is None:
            return _error(401, "not paired")
        ws = web.WebSocketResponse(heartbeat=25, max_msg_size=1024 * 1024)
        await ws.prepare(request)
        if device is None:
            # Current apps authenticate in the first frame, so the token never appears in a URL that a
            # proxy or tunnel might log.
            try:
                first = await ws.receive(timeout=10)
                data = json.loads(first.data) if first.type == WSMsgType.TEXT else {}
            except (asyncio.TimeoutError, ValueError, TypeError):
                data = {}
            if isinstance(data, dict) and data.get("type") == "auth":
                device = self.store.device_for_token(str(data.get("token") or ""))
            if device is None:
                await ws.close(code=4401, message=b"not paired")
                return ws
        self._sockets[ws] = {"device": device}
        try:
            await ws.send_json({"type": "hello", "server_id": self.server_id(), "bot": self.bot(), "device": device,
                                "me": self.me(device), **self.about(), "chats": self.visible_chats(device),
                                "typing": sorted(c for c in self._typing if self.can_see(device, self.store.get_chat(c))),
                                "pending": self.pending_for(device)})
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
        device = self.store.get_device(device["id"])
        if device is None:
            await ws.close(code=4401, message=b"unpaired")
            return
        kind = data.get("type")
        if kind == "ping":
            await ws.send_json({"type": "pong", "t": data.get("t")})
        elif kind == "message.send":
            with contextlib.suppress(MessageRejected):
                await self.user_message(device, str(data.get("chat_id") or ""), str(data.get("text") or ""),
                                        str(data.get("client_id") or ""))
        elif kind == "inbox.respond":
            try:
                await self.respond(str(data.get("id") or ""), choice=str(data.get("choice") or ""),
                                   answer=data.get("answer"), device=device)
            except Forbidden as exc:
                await ws.send_json({"type": "error", "message": str(exc)})
        elif kind == "presence":
            self._sockets[ws]["visible"] = bool(data.get("visible", True))

    def live_clients(self) -> int:
        """Sockets whose app is in the foreground (a backgrounded PWA may keep its socket briefly)."""
        return sum(1 for ws, meta in self._sockets.items() if not ws.closed and meta.get("visible", True))

    def _event_visible(self, device: Dict[str, Any], event: Dict[str, Any]) -> bool:
        """Members only hear about their own chats; owners hear everything."""
        if device.get("role") == "owner":
            return True
        if event.get("type") == "chat.delete":
            return event.get("owner_device") == device["id"]
        chat_id = event.get("chat_id")
        if chat_id is None:
            for key in ("chat", "item", "message"):
                value = event.get(key)
                if isinstance(value, dict):
                    chat_id = value.get("id") if key == "chat" else value.get("chat_id")
                    break
        return chat_id is None or self.can_see(device, self.store.get_chat(chat_id))

    async def broadcast(self, event: Dict[str, Any]) -> None:
        dead = []
        for ws, meta in list(self._sockets.items()):
            device = self.current_device(meta["device"]["id"])
            if device is None:
                dead.append(ws)
                with contextlib.suppress(Exception):
                    await ws.close(code=4401, message=b"unpaired")
                continue
            if not self._event_visible(device, event):
                continue
            out = event
            if "pending" in event and device.get("role") != "owner":
                out = {**event, "pending": self.pending_for(device)}
            try:
                await ws.send_json(out)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._sockets.pop(ws, None)

    # -- devices, verification, audit ---------------------------------------------------------

    async def _close_device_sockets(self, device_id: str, code: int, reason: bytes) -> None:
        self._alive_cache.pop(device_id, None)
        for ws, meta in list(self._sockets.items()):
            if meta["device"]["id"] == device_id:
                with contextlib.suppress(Exception):
                    await ws.close(code=code, message=reason)

    async def h_devices(self, request: web.Request) -> web.Response:
        me = self._require(request)
        return _json({"devices": [{**d, "current": d["id"] == me["id"]} for d in self.store.list_devices()]})

    async def h_device_update(self, request: web.Request) -> web.Response:
        me = self._require(request)
        device_id = request.match_info["device_id"]
        body = await self._body(request)
        role = body.get("role")
        if role is not None and role not in ROLES:
            return _error(400, "role must be owner or member")
        before = self.store.get_device(device_id)
        if before is None:
            return _error(404, "no such device")
        try:
            after = self.store.update_device(device_id, name=str(body["name"]) if "name" in body else None, role=role)
        except ValueError as exc:
            return _error(400, str(exc))
        if after["name"] != before["name"]:
            self.audit("device.renamed", me, f"{before['name']} → {after['name']}")
        if after["role"] != before["role"]:
            self.audit("device.role", me, f"{after['name']}: {before['role']} → {after['role']}")
            if after["role"] == "member":
                self.home_chat(after)
            # Its view of chats and the inbox changes: make it reconnect and load them again.
            await self._close_device_sockets(device_id, 4000, b"role changed")
        return _json({"device": after})

    async def h_device_delete(self, request: web.Request) -> web.Response:
        me = self._require(request)
        device = self.store.get_device(request.match_info["device_id"])
        if device is None:
            return _error(404, "no such device")
        try:
            self.store.remove_device(device["id"], keep_an_owner=True)
        except ValueError as exc:
            return _error(400, str(exc))
        self.audit("device.removed", me, f"{device['name']} ({device['role']})")
        await self._close_device_sockets(device["id"], 4401, b"unpaired")
        return _json({"ok": True})

    async def h_pairing_code(self, request: web.Request) -> web.Response:
        """A single-use code for another phone, shown as a QR on this one."""
        me = self._require(request)
        body = await self._body(request)
        role = str(body.get("role") or "member")
        if role not in ROLES:
            return _error(400, "role must be owner or member")
        code = self.store.create_pair_code(role=role)
        self.audit("pairing_code", me, f"for a new {role}")
        return _json({"code": code, "role": role, "fingerprint": self.keys.fingerprint,
                      "expires_at": time.time() + 600})

    async def h_device_verify(self, request: web.Request) -> web.Response:
        """A phone paired before verified pairing (or by typing a code) proves it scanned a fresh code
        from this server, and registers the key it signs owner actions with."""
        device = self._require(request)
        body = await self._body(request)
        try:
            data = self.keys.unseal_json(str(body.get("sealed") or ""), "verify", device["id"])
        except (keys.SealError, ValueError):
            return _error(400, "This verification couldn't be opened. Scan a new code and try again.")
        sign_key = str(data.get("sign_key") or "")
        if data.get("pinned") is not True or not keys.valid_public_key(sign_key):
            return _error(400, "Verify by scanning a code, so this phone can check the server's key.")
        if self.store.redeem_pair_code(str(data.get("code") or "")) is None:
            return _error(403, "This code is invalid or expired. Make a new one and try again.")
        device = self.store.set_device_key(device["id"], sign_key)
        self.audit("device.verified", device, device["name"])
        return _json({"device": device, "me": self.me(device)})

    async def h_rotate_token(self, request: web.Request) -> web.Response:
        device = self._require(request)
        token = self.store.rotate_token(device["id"])
        if token is None:
            return _error(404, "no such device")
        self.audit("token.rotated", device, device["name"])
        return _json({"token": token})

    async def h_audit(self, request: web.Request) -> web.Response:
        self._require(request)
        try:
            before = int(request.query["before"]) if request.query.get("before") else None
            limit = int(request.query.get("limit") or 100)
        except ValueError:
            return _error(400, "before and limit must be numbers")
        return _json({"entries": self.store.list_audit(before=before, limit=limit)})

    # -- pickers (/model, /reasoning, /fast, command confirmations) ------------------------------

    async def post_picker(self, chat_id: str, kind: str, title: str, data: Dict[str, Any],
                          callback: Callable[..., Awaitable[Any]], ttl: float = PICKER_SECONDS) -> Dict[str, Any]:
        """A card in the chat the owner taps to answer. ``callback`` gets the choice and returns the
        reply, which replaces the card's question."""
        picker_id = new_id()
        meta = {"picker": {"id": picker_id, "kind": kind, **data, "status": "open", "expires_at": time.time() + ttl}}
        message = await self.post_message(chat_id, title, role="bot", meta=meta, push=False)
        self._pickers[picker_id] = {"callback": callback, "chat_id": chat_id, "message_id": message["id"],
                                    "kind": kind, "expires": time.monotonic() + ttl}
        return message

    async def _close_picker(self, message_id: str, text: Optional[str], **change: Any) -> Optional[Dict[str, Any]]:
        message = self.store.get_message(message_id)
        if message is None or "picker" not in (message.get("meta") or {}):
            return None
        meta = dict(message["meta"])
        meta["picker"] = {**meta["picker"], **change}
        updated = self.store.update_message(message_id, text if text is not None else message["text"], meta=meta)
        await self.broadcast({"type": "message.update", "chat_id": updated["chat_id"], "message": updated})
        return updated

    async def h_picker_select(self, request: web.Request) -> web.Response:
        device = self._require(request)
        picker_id = request.match_info["picker_id"]
        body = await self._body(request)
        entry = self._pickers.get(picker_id)
        if entry is None or time.monotonic() > entry["expires"]:
            self._pickers.pop(picker_id, None)
            message_id = str(body.get("message_id") or (entry or {}).get("message_id") or "")
            message = self.store.get_message(message_id) if message_id else None
            if message and (message.get("meta") or {}).get("picker", {}).get("id") == picker_id \
                    and self.can_see(device, self.store.get_chat(message["chat_id"])):
                await self._close_picker(message_id, None, status="expired")
            return _error(410, "This choice has expired. Run the command again for a new one.")
        message = self.store.get_message(entry["message_id"])
        if message is None or not self.can_see(device, self.store.get_chat(entry["chat_id"])):
            return _error(404, "no such picker")
        picker = message["meta"]["picker"]
        kind = entry["kind"]
        if kind == "model":
            provider, model = str(body.get("provider") or ""), str(body.get("model") or "")
            allowed = {(p.get("slug"), m) for p in picker.get("providers") or [] for m in p.get("models") or []}
            if (provider, model) not in allowed:
                return _error(400, "pick one of the models offered")
            args, label = (entry["chat_id"], model, provider), model
        else:
            value = str(body.get("value") or "")
            choices = {str(c.get("value")): str(c.get("label") or c.get("value")) for c in picker.get("choices") or []}
            if value not in choices:
                return _error(400, "pick one of the options offered")
            args, label = ((entry["chat_id"], value) if kind == "choice" else (value,)), choices[value]
        self._pickers.pop(picker_id, None)  # one answer per card
        try:
            reply = await entry["callback"](*args)
        except Exception:
            logger.warning("[winglet] picker callback failed", exc_info=True)
            reply = "That didn't work. Try the command again."
        updated = await self._close_picker(entry["message_id"], str(reply or message["text"]), status="done",
                                           selected=label, by=device["name"])
        self.audit("picker", device, f"{kind}: {label}")
        return _json({"message": updated})

    # -- your agent: model, providers, persona, memory, usage ------------------------------------

    def _need_hermes(self):
        if self.hermes is None:
            raise web.HTTPNotFound(text=json.dumps({"error": "This server can't do that yet."}), content_type="application/json")
        return self.hermes

    async def _call(self, fn, *args, **kwargs):
        """Run a Hermes function off the event loop; its refusals become 400s with Hermes's message."""
        h = self._need_hermes()
        try:
            return await asyncio.to_thread(fn, *args, **kwargs)
        except h.HermesRefused as exc:
            raise web.HTTPBadRequest(text=json.dumps({"error": str(exc)}), content_type="application/json")
        except h.HermesUnavailable:
            raise web.HTTPNotFound(text=json.dumps({"error": "This Hermes version can't do that."}), content_type="application/json")

    async def h_agent(self, request: web.Request) -> web.Response:
        """The configured model, and the one a chat is really using when Hermes knows it."""
        device = self._require(request)
        h = self._need_hermes()
        configured = await self._call(h.configured_model)
        chat_id = request.query.get("chat") or ""
        chat = None
        if chat_id and self.chat_model is not None and self.can_see(device, self.store.get_chat(chat_id)):
            chat = self.chat_model(chat_id)
        return _json({"configured": configured, "chat": chat})

    async def h_models(self, request: web.Request) -> web.Response:
        self._require(request)
        data = await self._call(self._need_hermes().model_options)
        data["providers"] = [p for p in data["providers"] if p["authenticated"] and p["models"]]
        return _json(data)

    async def h_model_default(self, request: web.Request) -> web.Response:
        device = self._require(request)
        body = await self._body(request)
        provider, model = str(body.get("provider") or "").strip(), str(body.get("model") or "").strip()
        if not provider or not model:
            return _error(400, "provider and model are required")
        result = await self._call(self._need_hermes().set_default_model, provider, model, confirm=bool(body.get("confirm")))
        if result.get("ok"):
            self.audit("model.default", device, f"{result['provider']} · {result['model']}")
        return _json(result)

    async def h_providers(self, request: web.Request) -> web.Response:
        self._require(request)
        data = await self._call(self._need_hermes().model_options, include_unconfigured=True)
        providers = [{k: p[k] for k in ("slug", "name", "authenticated", "is_current", "auth_type", "key_env", "total_models", "warning")}
                     for p in data["providers"]]
        return _json({"providers": providers, "current": {"model": data["model"], "provider": data["provider"]}})

    async def h_provider_key(self, request: web.Request) -> web.Response:
        """Save a provider's API key. It arrives sealed to the server key and is never sent back."""
        device = self._require(request)
        h = self._need_hermes()
        if device["platform"] == "web" and self.connection.get("mode") == "quick" \
                and os.environ.get("WINGLET_ALLOW_WEB_SECRETS", "").lower() not in ("1", "true", "yes", "on"):
            # Over the automatic tunnel the web app's own code passes through Cloudflare, so it can't
            # promise a typed key stays private. The Android app can; so can a direct connection.
            return _error(403, "For your security, add API keys from the Android app or over a direct connection. "
                               "To allow it from the web app anyway, set WINGLET_ALLOW_WEB_SECRETS=true on the server.")
        body = await self._body(request)
        try:
            data = self.keys.unseal_json(str(body.get("sealed") or ""), "provider-key", device["id"])
        except (keys.SealError, ValueError):
            return _error(400, "The key couldn't be opened. Make sure the app is up to date and try again.")
        env, value = str(data.get("env") or ""), str(data.get("value") or "").strip()
        known = {p["key_env"] for p in (await self._call(h.model_options, include_unconfigured=True))["providers"] if p.get("key_env")}
        if env not in known or not _KEY_ENV.match(env):
            return _error(400, "That isn't a provider key this server knows.")
        if not value or len(value) > 4096 or any(c.isspace() for c in value):
            return _error(400, "That doesn't look like an API key.")
        check = await h.check_provider_key(env, value)
        if not check["ok"] and check["reachable"]:
            self.audit("provider.key", device, f"{env} rejected by the provider", outcome="refused")
            return _error(400, check["message"])
        await self._call(h.save_provider_key, env, value)
        self.audit("provider.key", device, f"{env} set (ends {value[-4:]})")
        return _json({"ok": True, "note": check.get("message", "")})

    async def h_provider_key_delete(self, request: web.Request) -> web.Response:
        device = self._require(request)
        env = request.match_info["env"]
        if not _KEY_ENV.match(env):
            return _error(400, "That isn't a provider key.")
        found = await self._call(self._need_hermes().remove_provider_key, env)
        if not found:
            return _error(404, "That key isn't set.")
        self.audit("provider.key", device, f"{env} removed")
        return _json({"ok": True})

    async def h_identity(self, request: web.Request) -> web.Response:
        self._require(request)
        persona = await self._call(self._need_hermes().read_persona)
        return _json({**persona, "bot": self.bot()})

    async def h_identity_put(self, request: web.Request) -> web.Response:
        device = self._require(request)
        body = await self._body(request)
        content = body.get("content")
        if not isinstance(content, str) or len(content) > MAX_PERSONA:
            return _error(400, f"The persona must be text, at most {MAX_PERSONA:,} characters.")
        await self._call(self._need_hermes().write_persona, content)
        self.audit("persona", device, f"edited ({len(content):,} characters); applies to new chats")
        return _json({"ok": True})

    async def h_memory(self, request: web.Request) -> web.Response:
        self._require(request)
        return _json(await self._call(self._need_hermes().memory))

    async def h_memory_edit(self, request: web.Request) -> web.Response:
        device = self._require(request)
        body = await self._body(request)
        action, target = str(body.get("action") or ""), str(body.get("target") or "")
        data = await self._call(self._need_hermes().edit_memory, action, target,
                                str(body.get("entry") or ""), str(body.get("content") or ""))
        what = "about you" if target == "user" else "in its notes"
        self.audit("memory", device, {"add": "added", "replace": "edited", "remove": "removed"}.get(action, action)
                   + f" an entry {what}")
        return _json(data)

    async def h_usage(self, request: web.Request) -> web.Response:
        self._require(request)
        try:
            days = int(request.query.get("days") or 30)
        except ValueError:
            return _error(400, "days must be a number")
        return _json(await self._call(self._need_hermes().usage, days))

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
        # No approve buttons on notifications: approving needs the card, with the full command in view.
        note = {**note, "tag": tag, "server_id": self.server_id()}
        devices: Dict[str, Optional[Dict[str, Any]]] = {}
        chat = self.store.get_chat(str(note.get("chat_id") or "")) if note.get("chat_id") else None
        for sub in subs:
            if sub["device_id"] not in devices:
                devices[sub["device_id"]] = self.store.get_device(sub["device_id"])
            if not _push_for(devices[sub["device_id"]], chat, note):
                continue
            if not _wants_push(self.store.get_push_prefs(sub["device_id"]), note):
                continue
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
        # body_exists, not can_read_body: a signed request's body has already been read (and cached).
        if not request.body_exists:
            return {}
        try:
            data = await request.json()
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}


class _TooLarge(Exception):
    pass


async def _parts(reader):
    while True:
        part = await reader.next()
        if part is None:
            return
        yield part


# Used when the adapter can't read Hermes's own command list.
_DEFAULT_COMMANDS = [
    {"cmd": "/new", "hint": "Start a fresh conversation"},
    {"cmd": "/stop", "hint": "Stop what the agent is doing"},
    {"cmd": "/retry", "hint": "Retry the last reply"},
    {"cmd": "/undo", "hint": "Remove the last exchange"},
    {"cmd": "/model", "hint": "Show or switch the model"},
    {"cmd": "/compress", "hint": "Compress the conversation context"},
    {"cmd": "/usage", "hint": "Token usage for this session"},
    {"cmd": "/help", "hint": "Everything Hermes can do"},
]


def _clean_push_prefs(raw: Any) -> Dict[str, Any]:
    """Validate notification preferences: {muted: {chat_id|"*": until (0 = until turned off)},
    quiet: {start: "HH:MM", end: "HH:MM", utc_offset_min, allow_urgent}}."""
    if not isinstance(raw, dict):
        raise ValueError("expected an object")
    out: Dict[str, Any] = {}
    muted = raw.get("muted") or {}
    if not isinstance(muted, dict) or len(muted) > 200:
        raise ValueError("muted must be an object of chat id to time")
    now = time.time()
    out["muted"] = {str(k)[:64]: float(v) for k, v in muted.items()
                    if isinstance(v, (int, float)) and (v == 0 or v > now)}
    quiet = raw.get("quiet")
    if quiet:
        if not isinstance(quiet, dict):
            raise ValueError("quiet must be an object")
        for key in ("start", "end"):
            if not (isinstance(quiet.get(key), str) and len(quiet[key]) == 5 and quiet[key][2] == ":"
                    and quiet[key][:2].isdigit() and quiet[key][3:].isdigit()
                    and int(quiet[key][:2]) < 24 and int(quiet[key][3:]) < 60):
                raise ValueError("quiet hours need start and end as HH:MM")
        offset = quiet.get("utc_offset_min", 0)
        if not isinstance(offset, (int, float)) or abs(offset) > 14 * 60:
            raise ValueError("utc_offset_min must be minutes from UTC")
        out["quiet"] = {"start": quiet["start"], "end": quiet["end"], "utc_offset_min": int(offset),
                        "allow_urgent": bool(quiet.get("allow_urgent", True))}
    return out


def _push_for(device: Optional[Dict[str, Any]], chat: Optional[Dict[str, Any]], note: Dict[str, Any]) -> bool:
    """Who a notification is for. A member hears about their own chats, except approvals, which only
    owners can answer. Owners hear about their chats, and approvals from anyone's."""
    if device is None:
        return False
    if note.get("kind") == "test" or chat is None:
        return device["role"] == "owner" or note.get("kind") == "test"
    member_chat = chat.get("owner_device")
    if device["role"] == "owner":
        return not member_chat or note.get("kind") == "approval"
    return member_chat == device["id"] and note.get("kind") != "approval"


def _wants_push(prefs: Dict[str, Any], note: Dict[str, Any], now: Optional[float] = None) -> bool:
    """Whether a device's preferences let this notification through. Approvals and questions block the
    agent, so a mute never silences them; quiet hours do unless urgent ones are allowed."""
    if not prefs:
        return True
    now = time.time() if now is None else now
    urgent = note.get("kind") in ("approval", "question")
    if note.get("kind") == "test":
        return True
    muted = prefs.get("muted") or {}
    if not urgent:
        for key in ("*", str(note.get("chat_id") or "")):
            until = muted.get(key)
            if until is not None and (until == 0 or until > now):
                return False
    quiet = prefs.get("quiet")
    if quiet and not (urgent and quiet.get("allow_urgent", True)):
        minute = int((now // 60 + quiet.get("utc_offset_min", 0)) % (24 * 60))
        start = int(quiet["start"][:2]) * 60 + int(quiet["start"][3:])
        end = int(quiet["end"][:2]) * 60 + int(quiet["end"][3:])
        inside = start <= minute < end if start <= end else (minute >= start or minute < end)
        if inside:
            return False
    return True


_NO_WEB_BUILD = """<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width">
<title>Winglet</title><body style="background:#1e1f22;color:#dbdee1;font:16px system-ui;padding:32px">
<h2>🪽 Winglet is running</h2><p>The web app isn't bundled in this install. Reinstall the plugin from a
release, or use the Android app.</p></body>"""
