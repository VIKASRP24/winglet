"""Winglet platform adapter: makes the Winglet app a Hermes messaging platform.

Hermes treats Winglet like Telegram or Discord: each app chat is a gateway chat (its own session),
approvals and clarify questions arrive through the standard adapter hooks, and cron routines can
deliver to the ``home`` chat. The adapter owns a :class:`~.hub.Hub` (HTTP + WebSocket + push) and
translates between the two.

Config (``.env`` or ``config.yaml`` ``platforms.winglet.extra``):
  WINGLET_ENABLED   true to start Winglet with the gateway
  WINGLET_HOST      bind address (default 0.0.0.0)
  WINGLET_PORT      port (default 8787)
  WINGLET_PUBLIC_URL  the URL your phone uses to reach this server (used in pairing QR codes)
  WINGLET_NTFY_SERVER ntfy server for Android notifications (default https://ntfy.sh)
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from gateway.config import Platform, PlatformConfig
from gateway.platforms._shared import extra_or_secret, get_scoped_secret, seed_extra_from_env
from gateway.platforms.base import BasePlatformAdapter, ExecApprovalPrompt, SendResult
from gateway.platforms.event import MessageEvent, MessageType

from . import bridge, cli
from .hub import HOME_CHAT_ID, Hub
from .store import Store

logger = logging.getLogger(__name__)

PLATFORM = "winglet"
OWNER_ID = "winglet-owner"
DEFAULT_PORT = 8787
GENERAL_CHAT_ID = "general"
RECONCILE_SECONDS = 5.0
MAX_MESSAGE_LENGTH = 16_000
_TRUTHY = ("1", "true", "yes", "on")

PLATFORM_HINT = (
    "You are talking to your owner through Winglet, their personal mobile app. It renders full "
    "Markdown (headings, lists, tables, code blocks, links and images). Keep replies easy to read on "
    "a phone: lead with the answer, use short paragraphs, and avoid very wide tables."
)


def data_dir() -> Path:
    """Per-profile state directory (``<hermes home>/plugin-data/winglet``)."""
    try:
        from plugins.plugin_storage import plugin_data_dir
        return plugin_data_dir("winglet")
    except Exception:
        from hermes_constants import get_hermes_home
        path = get_hermes_home() / "plugin-data" / "winglet"
        path.mkdir(parents=True, exist_ok=True)
        return path


def open_store() -> Store:
    return Store(data_dir() / "data.db")


def profile_info() -> Dict[str, Any]:
    """Name/title/description of the Hermes profile this gateway serves (its Bot Mode identity)."""
    from hermes_constants import get_hermes_home
    home = get_hermes_home()
    name = home.name if home.parent.name == "profiles" else "hermes"
    info = {"name": name, "title": name.replace("-", " ").title() if name != "hermes" else "Hermes",
            "description": ""}
    try:
        from hermes_cli.profiles import read_profile_meta
        meta = read_profile_meta(home)
        info["title"] = meta.get("bot_title") or meta.get("display_name") or info["title"]
        info["description"] = meta.get("description") or ""
    except Exception:
        logger.debug("[winglet] could not read profile metadata", exc_info=True)
    return info


def check_requirements() -> bool:
    try:
        import aiohttp  # noqa: F401
        import cryptography  # noqa: F401
        return True
    except ImportError:
        return False


def validate_config(config) -> bool:
    return True


def is_connected(config) -> bool:
    extra = getattr(config, "extra", {}) or {}
    if extra.get("enabled"):
        return True
    return str(get_scoped_secret("WINGLET_ENABLED", "") or "").strip().lower() in _TRUTHY


def _env_enablement() -> Optional[dict]:
    if str(get_scoped_secret("WINGLET_ENABLED", "") or "").strip().lower() not in _TRUTHY:
        return None
    seed = seed_extra_from_env((
        ("WINGLET_HOST", "host", None),
        ("WINGLET_PORT", "port", int),
        ("WINGLET_PUBLIC_URL", "public_url", lambda v: v.rstrip("/")),
        ("WINGLET_NTFY_SERVER", "ntfy_server", lambda v: v.rstrip("/")),
    ), home_env="WINGLET_HOME_CHANNEL", home_default=HOME_CHAT_ID)
    return {"enabled": True, **seed}


def _routine_title(job_id: str) -> str:
    try:
        from cron.jobs import get_job
        job = get_job(job_id) or {}
        name = str(job.get("name") or "").strip()
        # Bot Mode names routines "[bot:<name>] <routine>"; the app already shows which bot it is.
        if name.startswith("[bot:") and "]" in name:
            name = name.split("]", 1)[1].strip()
        if name:
            return f"Routine finished: {name}"[:120]
    except Exception:
        pass
    return "Routine finished"


def _strip_cursor(text: str) -> str:
    """Drop the streaming cursor Hermes appends to in-progress previews; the app draws its own."""
    stripped = text.rstrip()
    return stripped[:-1].rstrip() if stripped.endswith("▉") else text


def _strip_skip_hint(question: str) -> str:
    """The text-platform hint ('Reply "skip" to skip…') is noise next to the app's buttons."""
    hints = {'reply "skip" to skip this question.'}
    try:
        from agent.i18n import t
        hints.add(str(t("gateway.clarify.skip_hint")).strip().lower())
    except Exception:
        pass
    lines = [ln for ln in (question or "").splitlines() if ln.strip().lower() not in hints]
    return "\n".join(lines).strip() or question


class WingletAdapter(BasePlatformAdapter):
    MAX_MESSAGE_LENGTH = MAX_MESSAGE_LENGTH
    # Always get the closing edit of a streamed reply so the app can mark it complete.
    REQUIRES_EDIT_FINALIZE = True

    def __init__(self, config: PlatformConfig):
        super().__init__(config=config, platform=Platform(PLATFORM))
        extra = config.extra or {}
        self._host = str(extra_or_secret(extra, "host", "WINGLET_HOST", "0.0.0.0") or "0.0.0.0")
        try:
            self._port = int(extra_or_secret(extra, "port", "WINGLET_PORT", DEFAULT_PORT) or DEFAULT_PORT)
        except (TypeError, ValueError):
            self._port = DEFAULT_PORT
        self._ntfy_server = str(extra_or_secret(extra, "ntfy_server", "WINGLET_NTFY_SERVER", "https://ntfy.sh"))
        self._hub: Optional[Hub] = None
        self._runner = None
        self._reconcile_task: Optional[asyncio.Task] = None

    # -- lifecycle -------------------------------------------------------------------------

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        if not check_requirements():
            logger.warning("[%s] aiohttp/cryptography missing: pip install aiohttp cryptography", self.name)
            return False
        try:
            store = open_store()
            store.ensure_chat(GENERAL_CHAT_ID, "General")
            # Hermes keeps waiting approvals/questions in memory: after a restart none of the old cards
            # can be answered any more.
            for kind in ("approval", "question"):
                store.expire_pending(kind)
            hub = Hub(store, web_root=Path(__file__).parent / "web", bot_info=profile_info,
                      ntfy_server=self._ntfy_server)
            hub.on_user_message = self._on_user_message
            hub.on_approval = self._on_approval
            hub.on_answer = self._on_answer
            from gateway.platforms.shared_ingress import bind_listener
            # No access log: device tokens ride in WebSocket/media query strings and must not reach log files.
            self._runner = await bind_listener(self, hub.build_app(), self._host, self._port, "/api/ws",
                                               access_log=None)
            self._hub = hub
        except OSError as exc:
            logger.error("[%s] could not listen on %s:%s: %s", self.name, self._host, self._port, exc)
            self._set_fatal_error("winglet_bind_failed", f"Port {self._port} is unavailable: {exc}. "
                                  "Set WINGLET_PORT to a free port.", retryable=False)
            return False
        self._reconcile_task = asyncio.ensure_future(self._reconcile_loop())
        self._mark_connected()
        self._wire_plugin_handlers(None)
        logger.info("[%s] Winglet is listening on %s:%s — pair a phone with `hermes winglet pair`",
                    self.name, self._host, self._port)
        return True

    async def disconnect(self) -> None:
        self._running = False
        self._mark_disconnected()
        if self._reconcile_task is not None:
            self._reconcile_task.cancel()
            self._reconcile_task = None
        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None
        if self._hub is not None:
            await self._hub.aclose()
            self._hub.store.close()
            self._hub = None

    # -- inbound -----------------------------------------------------------------------------

    async def _on_user_message(self, chat: Dict[str, Any], text: str, device: Dict[str, Any],
                               message: Dict[str, Any]) -> None:
        source = self.build_source(
            chat_id=chat["id"], chat_name=chat.get("title") or chat["id"], chat_type="dm", user_id=OWNER_ID,
            user_name=device.get("name") or "Owner", message_id=message["id"],
            # The device proved itself with its pairing token before reaching this point.
            role_authorized=True)
        event = MessageEvent(
            text=text, message_type=MessageType.COMMAND if text.startswith("/") else MessageType.TEXT,
            source=source, message_id=message["id"], raw_message=message, timestamp=datetime.now(tz=timezone.utc))
        await self.handle_message(event)

    async def _on_approval(self, item: Dict[str, Any], choice: str) -> bool:
        # Only the exact request this card was shown for; a stale card must never approve a newer one.
        payload = item["payload"]
        return bridge.resolve_approval(payload.get("session_key") or "", payload.get("request_id") or "", choice)

    async def _on_answer(self, item: Dict[str, Any], answer: str) -> bool:
        from tools.clarify_gateway import resolve_gateway_clarify
        return bool(resolve_gateway_clarify(item["payload"].get("clarify_id") or "", answer))

    # -- outbound ----------------------------------------------------------------------------

    async def send(self, chat_id: str, content: str, reply_to: Optional[str] = None,
                   metadata: Optional[Dict[str, Any]] = None) -> SendResult:
        hub = self._hub
        if hub is None:
            return SendResult(success=False, error="Winglet is not running", retryable=True)
        metadata = metadata or {}
        text = _strip_cursor(content or "")
        if metadata.get("job_id"):
            # A routine (cron job) delivered its result: keep it in the chat and surface it in the inbox.
            message = await hub.post_message(chat_id, text, push=False)
            await hub.add_inbox("result", chat_id, _routine_title(str(metadata["job_id"])), text,
                                {"message_id": message["id"], "job_id": metadata["job_id"]})
        elif metadata.get("expect_edits"):
            message = await hub.post_message(chat_id, text, status="streaming")
        else:
            message = await hub.post_message(chat_id, text)
        return SendResult(success=True, message_id=message["id"])

    async def edit_message(self, chat_id: str, message_id: str, content: str, *,
                           finalize: bool = False) -> SendResult:
        hub = self._hub
        if hub is None:
            return SendResult(success=False, error="Winglet is not running")
        current = hub.store.get_message(message_id)
        inbox_id = (current or {}).get("meta", {}).get("inbox_id")
        if inbox_id:
            # Hermes edits an approval card when its request times out: the card is dead from here on.
            await hub.expire_item(inbox_id, _strip_cursor(content or ""))
        message = await hub.edit_message(message_id, _strip_cursor(content or ""), final=finalize)
        return SendResult(success=message is not None, message_id=message_id,
                          error=None if message else "message not found")

    async def delete_message(self, chat_id: str, message_id: str) -> bool:
        return bool(self._hub and await self._hub.delete_message(message_id))

    async def send_typing(self, chat_id: str, metadata=None) -> None:
        if self._hub is not None:
            await self._hub.set_typing(chat_id, True)

    async def stop_typing(self, chat_id: str) -> None:
        if self._hub is not None:
            await self._hub.set_typing(chat_id, False)

    async def get_chat_info(self, chat_id: str) -> Dict[str, Any]:
        chat = self._hub.store.get_chat(chat_id) if self._hub else None
        return {"name": (chat or {}).get("title") or chat_id, "type": "dm", "chat_id": chat_id}

    # -- approvals & questions ------------------------------------------------------------------

    async def _send_exec_approval_prompt(self, prompt: ExecApprovalPrompt) -> SendResult:
        hub = self._hub
        if hub is None:
            return SendResult(success=False, error="Winglet is not running")
        labels = {choice: label for label, choice, _style in prompt.actions}
        styles = {choice: style for _label, choice, style in prompt.actions}
        claimed = {i["payload"].get("request_id") for i in hub.store.pending_items("approval")
                   if i["payload"].get("session_key") == prompt.session_key}
        request_id = bridge.pick_request_id(bridge.queued_approvals(prompt.session_key) or [], prompt.command,
                                            {r for r in claimed if r})
        if request_id is None:
            logger.warning("[%s] could not match an approval request; answer it with /approve in the chat",
                           self.name)
        item = await hub.add_inbox(
            "approval", prompt.chat_id, "Approval needed", prompt.command,
            {"command": prompt.command, "description": prompt.description, "choices": prompt.choices,
             "labels": labels, "styles": styles, "session_key": prompt.session_key,
             "request_id": request_id, "smart_denied": prompt.smart_denied})
        message = await hub.post_message(prompt.chat_id, prompt.description or "Approval needed", role="system",
                                         meta={"inbox_id": item["id"], "kind": "approval"}, push=False)
        return SendResult(success=True, message_id=message["id"])

    async def send_clarify(self, chat_id: str, question: str, choices: Optional[list], clarify_id: str,
                           session_key: str, metadata: Optional[Dict[str, Any]] = None) -> SendResult:
        hub = self._hub
        if hub is None:
            return SendResult(success=False, error="Winglet is not running")
        multi = False
        try:
            from tools import clarify_gateway as _cg
            with _cg._lock:
                multi = bool(getattr(_cg._entries.get(clarify_id), "multi_select", False))
        except Exception:
            pass
        question = _strip_skip_hint(question)
        item = await hub.add_inbox(
            "question", chat_id, "Question", question,
            {"question": question, "choices": [str(c) for c in (choices or [])], "clarify_id": clarify_id,
             "session_key": session_key, "multi_select": multi})
        message = await hub.post_message(chat_id, question, role="system",
                                         meta={"inbox_id": item["id"], "kind": "question"}, push=False)
        return SendResult(success=True, message_id=message["id"])

    async def retire_clarify_card(self, clarify_id: str, notice: Optional[str] = None) -> None:
        hub = self._hub
        if hub is None:
            return
        for item in hub.store.pending_items("question"):
            if item["payload"].get("clarify_id") == clarify_id:
                await hub.expire_item(item["id"], notice or "")

    async def _reconcile_loop(self) -> None:
        """Expire cards whose request ended elsewhere (timeout, /stop, answered in another client)."""
        while True:
            await asyncio.sleep(RECONCILE_SECONDS)
            try:
                await self._reconcile_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.debug("[%s] inbox reconcile failed", self.name, exc_info=True)

    async def _reconcile_once(self) -> None:
        hub = self._hub
        if hub is None:
            return
        for item in hub.store.pending_items():
            payload = item["payload"]
            if item["kind"] == "approval":
                queued = bridge.queued_approvals(payload.get("session_key") or "")
                if queued is not None and payload.get("request_id") not in {e.get("request_id") for e in queued}:
                    await hub.expire_item(item["id"])
            elif item["kind"] == "question" and bridge.clarify_pending(payload.get("clarify_id") or "") is False:
                await hub.expire_item(item["id"])

    # -- media ------------------------------------------------------------------------------------

    async def _send_attachment(self, chat_id: str, path: str, caption: Optional[str],
                               name: Optional[str] = None) -> SendResult:
        hub = self._hub
        if hub is None:
            return SendResult(success=False, error="Winglet is not running")
        try:
            attachment = hub.add_media(path, name)
        except OSError as exc:
            return SendResult(success=False, error=f"could not read {path}: {exc}")
        message = await hub.post_message(chat_id, caption or "", meta={"attachments": [attachment]})
        return SendResult(success=True, message_id=message["id"])

    async def send_image(self, chat_id: str, image_url: str, caption: Optional[str] = None,
                         reply_to: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None) -> SendResult:
        text = f"![image]({image_url})" + (f"\n\n{caption}" if caption else "")
        return await self.send(chat_id, text, reply_to=reply_to, metadata=metadata)

    async def send_image_file(self, chat_id: str, image_path: str, caption: Optional[str] = None,
                              reply_to: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None,
                              **kwargs) -> SendResult:
        return await self._send_attachment(chat_id, image_path, caption)

    async def send_document(self, chat_id: str, file_path: str, caption: Optional[str] = None,
                            file_name: Optional[str] = None, reply_to: Optional[str] = None,
                            metadata: Optional[Dict[str, Any]] = None, **kwargs) -> SendResult:
        return await self._send_attachment(chat_id, file_path, caption, file_name)

    async def send_voice(self, chat_id: str, audio_path: str, caption: Optional[str] = None,
                         reply_to: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None,
                         **kwargs) -> SendResult:
        return await self._send_attachment(chat_id, audio_path, caption)

    async def send_video(self, chat_id: str, video_path: str, caption: Optional[str] = None,
                         reply_to: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None,
                         **kwargs) -> SendResult:
        return await self._send_attachment(chat_id, video_path, caption)


def register(ctx) -> None:
    ctx.register_platform(
        name=PLATFORM, label="Winglet", adapter_factory=lambda cfg: WingletAdapter(cfg),
        check_fn=check_requirements, validate_config=validate_config, is_connected=is_connected,
        required_env=[], install_hint="pip install aiohttp  # included in hermes-agent[messaging]",
        env_enablement_fn=_env_enablement, cron_deliver_env_var="WINGLET_HOME_CHANNEL",
        max_message_length=MAX_MESSAGE_LENGTH, emoji="🪽", pii_safe=True, allow_update_command=True,
        platform_hint=PLATFORM_HINT)
    ctx.register_cli_command(
        name="winglet", help="Pair phones and manage the Winglet app",
        setup_fn=cli.setup_parser, handler_fn=cli.main,
        description="Winglet: your Hermes agents on your phone. Start with `hermes winglet setup`.")
