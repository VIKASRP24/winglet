"""Small, defensive calls into Hermes' approval and clarify queues.

Kept apart from the adapter so the matching logic can be tested without a running gateway, and so a
Hermes version that lacks one of these functions degrades to "can't answer from Winglet" instead of
answering the wrong request.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Iterable, List, Optional, Set

logger = logging.getLogger(__name__)


def pick_request_id(entries: Iterable[Dict[str, Any]], command: str, claimed: Set[str]) -> Optional[str]:
    """The queued approval a freshly sent prompt belongs to.

    Hermes queues the request and then asks the adapter to show it, so the prompt's request is the
    newest one no existing card has claimed. Prefer an exact command match when several are waiting.
    """
    unclaimed = [e for e in entries if e.get("request_id") and e["request_id"] not in claimed]
    exact = [e for e in unclaimed if (e.get("command") or "") == command]
    pool = exact or unclaimed
    return str(pool[-1]["request_id"]) if pool else None


def queued_approvals(session_key: str) -> Optional[List[Dict[str, Any]]]:
    """Snapshots of the session's waiting approvals, or None when this Hermes can't list them."""
    try:
        from tools.approval import list_gateway_approvals
    except ImportError:
        return None
    try:
        return list(list_gateway_approvals(session_key))
    except Exception:
        logger.debug("[winglet] could not list approvals", exc_info=True)
        return None


def resolve_approval(session_key: str, request_id: str, choice: str) -> bool:
    """Answer exactly one request. Never falls back to "oldest in the queue"."""
    if not session_key or not request_id:
        return False
    from tools.approval import resolve_gateway_approval
    return resolve_gateway_approval(session_key, choice, request_id=request_id) > 0


def clarify_pending(clarify_id: str) -> Optional[bool]:
    """True while Hermes still waits on this question; None when it can't be checked."""
    try:
        from tools import clarify_gateway as cg
        with cg._lock:
            entry = cg._entries.get(clarify_id)
            return entry is not None and not entry.event.is_set()
    except Exception:
        return None


def clarify_answer(answer: Any, multi_select: bool) -> str:
    """Hermes takes a multi-select answer as a JSON array of the chosen labels."""
    if multi_select:
        picked = answer if isinstance(answer, list) else [answer]
        return json.dumps([str(a) for a in picked if str(a).strip()], ensure_ascii=False)
    return str(answer)


def resolve_clarify(clarify_id: str, answer: str) -> bool:
    if not clarify_id:
        return False
    from tools.clarify_gateway import resolve_gateway_clarify
    return bool(resolve_gateway_clarify(clarify_id, answer))
