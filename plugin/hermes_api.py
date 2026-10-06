"""The one place Winglet touches Hermes internals.

Hermes moves quickly, and its internal modules aren't a stable API. Every import of ``hermes_cli``,
``agent``, ``cron`` or ``gateway`` internals that a feature depends on lives here, wrapped so that a
missing or renamed function turns that one feature off instead of breaking the plugin.
"""

from __future__ import annotations

import contextlib
import functools
import logging
from typing import List, Optional

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


# -- your agent: model, providers, persona, memory, usage ------------------------------------
#
# These mirror what Hermes's own dashboard does, calling the same functions rather than its HTTP
# routes. Each raises HermesUnavailable when this Hermes doesn't have the function, so the hub can
# turn the feature off instead of failing.


@contextlib.contextmanager
def _profile_scope():
    """Read this profile's secrets the way Hermes's own turns do. A gateway that serves several
    profiles refuses unscoped secret reads, and these functions run on worker threads."""
    try:
        from agent.secret_scope import build_profile_secret_scope, current_secret_scope, reset_secret_scope, set_secret_scope
        from hermes_constants import get_hermes_home
    except Exception:
        yield
        return
    if current_secret_scope() is not None:
        yield
        return
    home = get_hermes_home()
    token = set_secret_scope(build_profile_secret_scope(home), profile_home=str(home))
    try:
        yield
    finally:
        reset_secret_scope(token)


def _scoped(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with _profile_scope():
            return fn(*args, **kwargs)
    return wrapper


class HermesUnavailable(RuntimeError):
    """This Hermes version doesn't offer the function a feature needs."""


class HermesRefused(ValueError):
    """Hermes rejected the request (a bad model, a rejected key); the message is for the user."""


def _detail(exc: Exception) -> str:
    return str(getattr(exc, "detail", "") or exc)


@_scoped
def configured_model() -> dict:
    """The model new chats start with, from config.yaml."""
    try:
        from hermes_cli.config import load_config
        cfg = load_config()
    except Exception as exc:
        raise HermesUnavailable("config unavailable") from exc
    model_cfg = cfg.get("model")
    if isinstance(model_cfg, dict):
        model, provider = model_cfg.get("default", model_cfg.get("name", "")), model_cfg.get("provider", "")
    else:
        model, provider = (str(model_cfg) if model_cfg else ""), ""
    agent = cfg.get("agent") if isinstance(cfg.get("agent"), dict) else {}
    return {"model": str(model or ""), "provider": str(provider or ""),
            "reasoning_effort": str(agent.get("reasoning_effort") or ""), "label": provider_label(str(provider or ""))}


def provider_label(slug: str) -> str:
    try:
        from hermes_cli.providers import get_label
        return str(get_label(slug) or slug)
    except Exception:
        return slug


def chat_model(runner, session_key: str) -> Optional[dict]:
    """The model a chat is really using, when Hermes knows: a /model switch for this chat, or the
    model its last turn resolved to (a fallback can change it). None means "the configured one"."""
    try:
        override = (getattr(runner, "_session_model_overrides", None) or {}).get(session_key)
        if isinstance(override, dict) and override.get("model"):
            return {"model": str(override["model"]), "provider": str(override.get("provider") or ""), "source": "chat"}
        last = (getattr(runner, "_last_resolved_model", None) or {}).get(session_key)
        if last:
            return {"model": str(last), "provider": "", "source": "last_turn"}
    except Exception:
        logger.debug("[winglet] session model unavailable", exc_info=True)
    return None


@_scoped
def model_options(include_unconfigured: bool = False) -> dict:
    """Providers and their models, the same list Hermes's model pickers show."""
    try:
        from hermes_cli.inventory import build_model_options_payload, load_picker_context
    except Exception as exc:
        raise HermesUnavailable("model inventory unavailable") from exc
    payload = build_model_options_payload(load_picker_context(), include_unconfigured=include_unconfigured)
    providers = []
    for p in payload.get("providers") or []:
        models = [m if isinstance(m, str) else str((m or {}).get("id") or "") for m in (p.get("models") or [])][:80]
        providers.append({"slug": p.get("slug", ""), "name": p.get("name") or p.get("slug", ""),
                          "authenticated": bool(p.get("authenticated")), "is_current": bool(p.get("is_current")),
                          "auth_type": p.get("auth_type", ""), "key_env": p.get("key_env", ""),
                          "models": [m for m in models if m], "total_models": p.get("total_models") or len(models),
                          "warning": p.get("warning", "")})
    return {"model": payload.get("model", ""), "provider": payload.get("provider", ""), "providers": providers}


@_scoped
def set_default_model(provider: str, model: str, *, confirm: bool = False) -> dict:
    """Make ``model`` the default for new chats, with Hermes's own validation and its warning for
    expensive models (returned as ``confirm_required`` until the user confirms)."""
    try:
        from hermes_cli.web_server_config import _apply_model_assignment_sync, _prepare_main_assignment
        from hermes_cli.config import load_config
    except Exception as exc:
        raise HermesUnavailable("model assignment unavailable") from exc
    if not confirm:
        try:
            from hermes_cli.model_selection_guards import combined_selection_warning
            warning = combined_selection_warning(model, provider=provider, base_url="")
        except Exception:
            warning = None
        if warning is not None:
            return {"ok": False, "confirm_required": True, "confirm_message": str(getattr(warning, "message", warning))}
    try:
        prepared = _prepare_main_assignment(load_config(), provider, model, "", "")
        result = _apply_model_assignment_sync("main", provider, model, "", "", "", prepared=prepared)
    except Exception as exc:
        if type(exc).__name__ == "HTTPException" or isinstance(exc, ValueError):
            raise HermesRefused(_detail(exc)) from exc
        raise
    return {"ok": True, "provider": result.get("provider", provider), "model": result.get("model", model)}


# Cheap read-only calls that reject a bad key, as Hermes's dashboard uses before saving one.
_KEY_PROBES = {
    "OPENROUTER_API_KEY": ("https://openrouter.ai/api/v1/key", "bearer"),
    "OPENAI_API_KEY": ("https://api.openai.com/v1/models", "bearer"),
    "XAI_API_KEY": ("https://api.x.ai/v1/models", "bearer"),
    "ANTHROPIC_API_KEY": ("https://api.anthropic.com/v1/models", "x-api-key"),
    "GEMINI_API_KEY": ("https://generativelanguage.googleapis.com/v1beta/models", "query"),
}


async def check_provider_key(env_var: str, value: str) -> dict:
    """{ok, reachable, message}: ok=False with reachable=True means the provider rejected the key."""
    probe = _KEY_PROBES.get(env_var)
    if not probe:
        return {"ok": True, "reachable": False, "message": ""}
    import httpx
    url, auth = probe
    headers, params = {"Accept": "application/json"}, {}
    if auth == "bearer":
        headers["Authorization"] = f"Bearer {value}"
    elif auth == "x-api-key":
        headers.update({"x-api-key": value, "anthropic-version": "2023-06-01"})
    else:
        params["key"] = value
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers, params=params)
    except Exception:
        return {"ok": True, "reachable": False, "message": "Couldn't reach the provider to check the key; saved anyway."}
    if resp.status_code in (401, 403):
        return {"ok": False, "reachable": True, "message": "The provider rejected that key. Check it and try again."}
    return {"ok": True, "reachable": True, "message": ""}


@_scoped
def save_provider_key(env_var: str, value: str) -> None:
    try:
        from hermes_cli.credential_lifecycle import save_provider_env_credential
    except Exception as exc:
        raise HermesUnavailable("credential storage unavailable") from exc
    save_provider_env_credential(env_var, value)


@_scoped
def remove_provider_key(env_var: str) -> bool:
    try:
        from hermes_cli.credential_lifecycle import remove_provider_env_credential
    except Exception as exc:
        raise HermesUnavailable("credential storage unavailable") from exc
    return bool((remove_provider_env_credential(env_var) or {}).get("found", True))


def _home():
    from hermes_constants import get_hermes_home
    return get_hermes_home()


@_scoped
def read_persona() -> dict:
    path = _home() / "SOUL.md"
    if not path.exists():
        return {"content": "", "exists": False}
    return {"content": path.read_text(encoding="utf-8-sig"), "exists": True}


@_scoped
def write_persona(content: str) -> None:
    path = _home() / "SOUL.md"
    try:
        from utils import atomic_write_text
        atomic_write_text(path, content, preserve_mode=True, create_mode=0o644)
    except ImportError:
        tmp = path.with_suffix(".md.tmp")
        tmp.write_text(content, encoding="utf-8")
        tmp.replace(path)


def _memory_store():
    try:
        from tools.memory_tool import load_on_disk_store
    except Exception as exc:
        raise HermesUnavailable("memory unavailable") from exc
    return load_on_disk_store()


@_scoped
def memory() -> dict:
    """What the agent remembers: notes about its world (MEMORY.md) and about you (USER.md)."""
    store = _memory_store()
    out = {}
    for target in ("memory", "user"):
        entries = list(getattr(store, f"{target}_entries", None) or store._entries_for(target))
        try:
            limit = store._char_limit(target)
        except Exception:
            limit = 0
        out[target] = {"entries": entries, "enabled": bool(store.target_enabled(target)), "limit": limit,
                       "used": len("\n§\n".join(entries))}
    return out


@_scoped
def edit_memory(action: str, target: str, entry: str = "", content: str = "") -> dict:
    """Add, replace or remove one memory entry through Hermes's own store (its limits and its scan
    for prompt-injection content apply)."""
    if target not in ("memory", "user") or action not in ("add", "replace", "remove"):
        raise HermesRefused("unknown memory action")
    store = _memory_store()
    if action == "add":
        result = store.add(target, content)
    elif action == "replace":
        result = store.replace(target, entry, content, matched_entry=entry)
    else:
        result = store.remove(target, entry, matched_entry=entry)
    if not result.get("success", False):
        raise HermesRefused(str(result.get("error") or "Hermes didn't accept that change."))
    return memory()


@_scoped
def usage(days: int = 30) -> dict:
    """Tokens and cost per day and per model, as Hermes's dashboard reports them."""
    try:
        from hermes_cli.web_routers.analytics import _get_usage_analytics
    except Exception as exc:
        raise HermesUnavailable("usage analytics unavailable") from exc
    data = _get_usage_analytics(max(1, min(int(days), 365)))
    keep = ("daily", "by_model", "totals", "period_days")
    return {k: data.get(k) for k in keep if k in data} if isinstance(data, dict) else {}


async def resolve_slash_confirm(session_key: str, confirm_id: str, choice: str) -> str:
    try:
        from tools import slash_confirm
    except Exception as exc:
        raise HermesUnavailable("slash confirm unavailable") from exc
    return str(await slash_confirm.resolve(session_key, confirm_id, choice) or "")


# -- control center: health, pause, restart, updates, logs, schedule ------------------------


def system_stats() -> dict:
    """Host health for owners: CPU, memory, disk and uptime, without hostnames or paths."""
    import os
    import platform
    import time as _time
    info: dict = {"system": platform.system(), "arch": platform.machine(), "cpu_count": os.cpu_count()}
    try:
        import psutil
        vm = psutil.virtual_memory()
        info["memory"] = {"total": vm.total, "used": vm.used, "percent": vm.percent}
        du = psutil.disk_usage(str(_home()))
        info["disk"] = {"total": du.total, "used": du.used, "percent": du.percent}
        info["cpu_percent"] = psutil.cpu_percent(interval=0.1)
        info["uptime_seconds"] = int(_time.time() - psutil.boot_time())
    except Exception:
        try:
            info["load_avg"] = list(os.getloadavg())
        except (OSError, AttributeError):
            pass
    return info


def paused() -> Optional[dict]:
    """Whether new work is on hold (Hermes's /pause): {reason, engaged_at}, or None."""
    try:
        from agent import estop
    except Exception as exc:
        raise HermesUnavailable("pause unavailable") from exc
    return estop.get_state()


def set_paused(on: bool, reason: str = "") -> Optional[dict]:
    from agent import estop
    if on:
        estop.engage(reason or "paused from Winglet")
    else:
        estop.disengage()
    return estop.get_state()


def spawn_restart() -> int:
    """Restart this profile's gateway the way `hermes gateway restart` does, in a detached process
    (it stops this one). Returns the child's pid."""
    try:
        from hermes_cli.web_server_gateway import _gateway_subcommand, _spawn_hermes_action
    except Exception as exc:
        raise HermesUnavailable("restart unavailable") from exc
    return _spawn_hermes_action(_gateway_subcommand(None, "restart"), "gateway-restart").pid


async def start_hermes_update() -> dict:
    """Start `hermes update` the way the dashboard's button does, with the same checks for installs that
    can't update in place. {ok, action_id} or {ok: False, message, update_command}."""
    try:
        from hermes_cli.web_routers.actions import update_hermes
    except Exception as exc:
        raise HermesUnavailable("update unavailable") from exc
    with _profile_scope():
        return dict(await update_hermes())


async def hermes_update_status() -> dict:
    """{running, exit_code, lines, action_id, receipt}: Hermes's own record of the last update, which
    survives the restart the update ends with."""
    try:
        from hermes_cli.web_routers.actions import get_action_status
    except Exception as exc:
        raise HermesUnavailable("update status unavailable") from exc
    with _profile_scope():
        return dict(await get_action_status("hermes-update", lines=40))


async def check_hermes_update(force: bool = False) -> dict:
    """{install_method, current_version, behind, update_available, can_apply, update_command, message}."""
    try:
        from hermes_cli.web_routers.actions import check_hermes_update as _check
    except Exception as exc:
        raise HermesUnavailable("update check unavailable") from exc
    with _profile_scope():
        return dict(await _check(force=force))


def _plugin_dir():
    from pathlib import Path
    return Path(__file__).resolve().parent


@_scoped
def check_winglet_update() -> dict:
    """Whether a newer Winglet is published where it was installed from: {update_available, current,
    latest, reason}. update_available is None when it can't tell (a copied folder, no network)."""
    try:
        from hermes_cli.plugins_updates import run_checks
    except Exception as exc:
        raise HermesUnavailable("plugin update check unavailable") from exc
    here = _plugin_dir()
    for result in run_checks(here.parent, include_pip=False):
        if result.name in (here.name, "winglet"):
            data = result.to_json()
            return {k: data.get(k) for k in ("update_available", "current", "latest", "reason", "needs_fixing")}
    return {"update_available": None, "current": None, "latest": None, "reason": "not installed from git"}


async def update_winglet(timeout: float = 300) -> tuple:
    """`hermes plugins update` for this plugin, without prompts (new capabilities stay ungranted until
    someone reviews them on the server). Returns (exit code, output tail)."""
    import asyncio as _asyncio
    import os
    try:
        from hermes_cli._launchers import runtime_command
        from hermes_cli.web_server import PROJECT_ROOT
    except Exception as exc:
        raise HermesUnavailable("plugin update unavailable") from exc
    code = ("from hermes_cli.plugins_cmd_update import cmd_update; "
            f"cmd_update({_plugin_dir().name!r}, interactive=False)")
    env = {**os.environ, "HERMES_HOME": str(_home()), "COLUMNS": "200"}
    proc = await _asyncio.create_subprocess_exec(*runtime_command(PROJECT_ROOT, code=code), env=env,
                                                 stdin=_asyncio.subprocess.DEVNULL, stdout=_asyncio.subprocess.PIPE,
                                                 stderr=_asyncio.subprocess.STDOUT)
    try:
        out, _ = await _asyncio.wait_for(proc.communicate(), timeout)
    except _asyncio.TimeoutError:
        proc.kill()
        return -1, ["The update took too long and was stopped."]
    return proc.returncode, out.decode("utf-8", errors="replace").splitlines()[-30:]


_LOG_FILES = {"agent": "agent.log", "gateway": "gateway.log", "errors": "errors.log"}
_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")


def read_log(name: str, *, lines: int = 300, level: str = "", query: str = "") -> dict:
    """The end of one of Hermes's logs, redacted the way Hermes redacts tool output, filtered by
    minimum level and a search string."""
    filename = _LOG_FILES.get(name)
    if filename is None:
        raise HermesRefused("unknown log")
    path = _home() / "logs" / filename
    if not path.exists():
        return {"lines": [], "size": 0}
    size = path.stat().st_size
    with open(path, "rb") as f:
        f.seek(max(0, size - 512 * 1024))
        text = f.read().decode("utf-8", errors="replace")
    rows = text.splitlines()[1:] if size > 512 * 1024 else text.splitlines()
    floor = _LEVELS.index(level) if level in _LEVELS else 0
    q = query.lower()

    def keep(row: str) -> bool:
        if floor:
            found = next((lv for lv in _LEVELS if f" {lv} " in row[:80]), None)
            if found is None or _LEVELS.index(found) < floor:
                return False
        return not q or q in row.lower()

    picked = [r for r in rows if keep(r)][-max(1, min(lines, 1000)):]
    try:
        from agent.redact import redact_sensitive_text
        picked = redact_sensitive_text("\n".join(picked), force=True, redact_url_credentials=True).split("\n")
    except Exception:
        picked = ["(Hermes's redaction is unavailable on this version, so logs aren't shown.)"]
    return {"lines": picked, "size": size}


def _cron():
    try:
        from cron import jobs
    except Exception as exc:
        raise HermesUnavailable("schedule unavailable") from exc
    return jobs


_JOB_FIELDS = ("id", "name", "prompt", "schedule_display", "state", "enabled", "next_run_at", "last_run_at",
               "last_status", "last_error", "deliver", "created_at", "paused_reason")


def _job_view(job: dict) -> dict:
    out = {k: job.get(k) for k in _JOB_FIELDS}
    schedule = job.get("schedule") or {}
    out["kind"] = schedule.get("kind") if isinstance(schedule, dict) else None
    try:
        out["state"] = _cron().effective_job_state(job)
    except Exception:
        pass
    return out


@_scoped
def list_schedule() -> List[dict]:
    return [_job_view(j) for j in _cron().list_jobs(include_disabled=True)]


@_scoped
def parse_schedule(text: str) -> dict:
    jobs = _cron()
    try:
        schedule = jobs.parse_schedule(text)
    except ValueError as exc:
        raise HermesRefused(str(exc)) from exc
    nxt = jobs.compute_next_run(schedule)
    return {"display": schedule.get("display") or text, "kind": schedule.get("kind"), "next_run_at": nxt}


# Routine results arrive in the Winglet Updates chat.
ROUTINE_DELIVERY = "winglet:home"


@_scoped
def create_routine(name: str, prompt: str, schedule: str) -> dict:
    try:
        return _job_view(_cron().create_job(prompt=prompt, schedule=schedule, name=name or None, deliver=ROUTINE_DELIVERY))
    except ValueError as exc:
        raise HermesRefused(str(exc)) from exc


@_scoped
def change_routine(job_id: str, action: str, updates: Optional[dict] = None) -> Optional[dict]:
    jobs = _cron()
    try:
        if action == "update":
            allowed = {k: v for k, v in (updates or {}).items() if k in ("name", "prompt", "schedule")}
            job = jobs.update_job(job_id, allowed)
        elif action == "pause":
            job = jobs.pause_job(job_id, "paused from Winglet")
        elif action == "resume":
            job = jobs.resume_job(job_id)
        elif action == "run":
            job = jobs.trigger_job(job_id)
        elif action == "delete":
            return {"deleted": bool(jobs.remove_job(job_id))}
        else:
            raise HermesRefused("unknown action")
    except ValueError as exc:
        raise HermesRefused(str(exc)) from exc
    return _job_view(job) if job else None
