"""The one place Winglet touches Hermes internals.

Hermes moves quickly, and its internal modules aren't a stable API. Every import of ``hermes_cli``,
``agent``, ``cron`` or ``gateway`` internals that a feature depends on lives here, wrapped so that a
missing or renamed function turns that one feature off instead of breaking the plugin.
"""

from __future__ import annotations

import functools
import logging

logger = logging.getLogger(__name__)


@functools.lru_cache(maxsize=1)
def hermes_version() -> str:
    """Human-readable Hermes version, or "" if this Hermes can't say. Read once: it may run git."""
    try:
        from hermes_cli.version_info import get_version_info
        info = get_version_info()
        for value in (getattr(info, "base_version", ""), getattr(info, "derived_version", "")):
            if value and value != "unknown":
                return str(value)
    except Exception:
        logger.debug("[winglet] version_info unavailable", exc_info=True)
    try:
        from hermes_cli import __release_date__
        return str(__release_date__)
    except Exception:
        return ""


async def cache_media(path: str, name: str, mime: str, voice: bool = False):
    """Hand an uploaded file to Hermes's own media cache, the same way Telegram or Slack do.
    Returns (cached path, media type, kind)."""
    import asyncio
    from pathlib import Path
    from gateway.platforms.base import cache_media_bytes_async
    data = await asyncio.to_thread(Path(path).read_bytes)
    if voice:
        # Hermes files .webm under video by its extension; a voice note is always audio, so it goes
        # straight to the audio cache, where speech-to-text picks it up.
        from gateway.platforms.base import cache_audio_from_bytes_async
        ext = Path(name).suffix.lower()
        ext = {".mp4": ".m4a", "": ".ogg"}.get(ext, ext)
        return await cache_audio_from_bytes_async(data, ext=ext), mime, "audio"
    cached = await cache_media_bytes_async(data, filename=name, mime_type=mime)
    if cached is None:
        raise ValueError(f"Hermes could not read {name} as {mime}")
    return cached.path, cached.media_type, cached.kind


def list_commands() -> list:
    """Gateway slash commands and skill commands, for the app's command palette."""
    out = []
    try:
        from hermes_cli.commands import COMMAND_REGISTRY, _is_gateway_available, _resolve_config_gates
        gates = _resolve_config_gates()
        for cmd in COMMAND_REGISTRY:
            if not _is_gateway_available(cmd, gates):
                continue
            out.append({"cmd": f"/{cmd.name}", "hint": cmd.describe(), "args": cmd.args_hint or "",
                        "category": cmd.category, "kind": "command"})
    except Exception:
        logger.debug("[winglet] command registry unavailable", exc_info=True)
    try:
        from agent.skill_commands import get_skill_commands
        for key, meta in sorted((get_skill_commands() or {}).items()):
            name = key if str(key).startswith("/") else f"/{key}"
            out.append({"cmd": name, "hint": str((meta or {}).get("description") or "Skill")[:160], "args": "",
                        "category": "Skills", "kind": "skill"})
    except Exception:
        logger.debug("[winglet] skill commands unavailable", exc_info=True)
    return out


def resolve_command(name: str) -> str:
    """Hermes's canonical name for a typed command or alias ("reset" -> "new"), or "" if unknown."""
    try:
        from hermes_cli.commands import resolve_command as _resolve
        cmd = _resolve(name)
        return cmd.name if cmd is not None else ""
    except Exception:
        logger.debug("[winglet] command registry unavailable", exc_info=True)
        return ""
