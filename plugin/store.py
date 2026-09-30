"""SQLite-backed state for Winglet: paired devices, pairing codes, chats, messages, inbox, push.

Pure stdlib so it can be unit-tested without Hermes. One connection guarded by a lock; every call is
short, so it is safe to call from the gateway's event loop.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

PAIR_CODE_TTL_SECONDS = 10 * 60
# Crockford-style alphabet: no 0/O/1/I/L so codes survive being read aloud or typed by hand.
_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL UNIQUE, created_at REAL NOT NULL, last_seen REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS pair_codes (
    code_hash TEXT PRIMARY KEY, created_at REAL NOT NULL, expires_at REAL NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'chat',
    created_at REAL NOT NULL, updated_at REAL NOT NULL, preview TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'final', meta TEXT NOT NULL DEFAULT '{}',
    created_at REAL NOT NULL, updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_chat ON messages (chat_id, created_at);
CREATE TABLE IF NOT EXISTS inbox (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, chat_id TEXT NOT NULL, title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
    resolution TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL, updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS inbox_status ON inbox (status, created_at);
CREATE TABLE IF NOT EXISTS push_subs (
    id TEXT PRIMARY KEY, device_id TEXT NOT NULL, kind TEXT NOT NULL, endpoint TEXT NOT NULL,
    data TEXT NOT NULL, created_at REAL NOT NULL, UNIQUE (kind, endpoint)
);
"""


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _now() -> float:
    return time.time()


def new_id() -> str:
    return uuid.uuid4().hex[:16]


def normalize_code(code: str) -> str:
    """Pairing codes are case-insensitive and may be typed with dashes or spaces."""
    return "".join(ch for ch in (code or "").upper() if ch.isalnum())


class Store:
    def __init__(self, path: Path | str):
        self.path = str(path)
        self._lock = threading.RLock()
        self._db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        with self._lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.executescript(_SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # -- helpers ---------------------------------------------------------------

    def _one(self, sql: str, args: tuple = ()) -> Optional[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, args).fetchone()

    def _all(self, sql: str, args: tuple = ()) -> List[sqlite3.Row]:
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    def _exec(self, sql: str, args: tuple = ()) -> int:
        with self._lock:
            return self._db.execute(sql, args).rowcount

    # -- key/value ---------------------------------------------------------------

    def get_kv(self, key: str) -> Optional[str]:
        row = self._one("SELECT value FROM kv WHERE key = ?", (key,))
        return row["value"] if row else None

    def set_kv(self, key: str, value: str) -> None:
        self._exec("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                   (key, value))

    def secret(self, key: str, factory=lambda: secrets.token_urlsafe(32)) -> str:
        """Get-or-create a persistent secret (signing keys, ntfy topic, ...)."""
        with self._lock:
            value = self.get_kv(key)
            if value is None:
                value = factory()
                self.set_kv(key, value)
            return value

    # -- pairing -----------------------------------------------------------------

    def create_pair_code(self, ttl: float = PAIR_CODE_TTL_SECONDS) -> str:
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
        now = _now()
        with self._lock:
            self._exec("DELETE FROM pair_codes WHERE expires_at < ? OR used = 1", (now,))
            self._exec("INSERT INTO pair_codes (code_hash, created_at, expires_at) VALUES (?, ?, ?)",
                       (_hash(code), now, now + ttl))
        return code

    def redeem_pair_code(self, code: str) -> bool:
        """Consume a pairing code; True exactly once per valid, unexpired code."""
        code_hash = _hash(normalize_code(code))
        with self._lock:
            changed = self._exec(
                "UPDATE pair_codes SET used = 1 WHERE code_hash = ? AND used = 0 AND expires_at >= ?",
                (code_hash, _now()))
        return changed == 1

    # -- devices -----------------------------------------------------------------

    def add_device(self, name: str, platform: str = "") -> tuple[Dict[str, Any], str]:
        token = secrets.token_urlsafe(32)
        device_id, now = new_id(), _now()
        name = (name or "").strip()[:64] or "My phone"
        self._exec("INSERT INTO devices (id, name, platform, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)",
                   (device_id, name, (platform or "")[:32], _hash(token), now, now))
        return self.get_device(device_id), token

    def device_for_token(self, token: str) -> Optional[Dict[str, Any]]:
        if not token:
            return None
        row = self._one("SELECT * FROM devices WHERE token_hash = ?", (_hash(token),))
        if not row:
            return None
        self._exec("UPDATE devices SET last_seen = ? WHERE id = ?", (_now(), row["id"]))
        return self._device(row)

    def get_device(self, device_id: str) -> Optional[Dict[str, Any]]:
        row = self._one("SELECT * FROM devices WHERE id = ?", (device_id,))
        return self._device(row) if row else None

    def list_devices(self) -> List[Dict[str, Any]]:
        return [self._device(r) for r in self._all("SELECT * FROM devices ORDER BY created_at")]

    def remove_device(self, device_id: str) -> bool:
        with self._lock:
            self._exec("DELETE FROM push_subs WHERE device_id = ?", (device_id,))
            removed = self._exec("DELETE FROM devices WHERE id = ?", (device_id,)) == 1
            if removed:
                # Notification action links are signed with this key; rotating it voids any the
                # removed phone may still hold.
                self._exec("DELETE FROM kv WHERE key = 'action_key'")
            return removed

    @staticmethod
    def _device(row: sqlite3.Row) -> Dict[str, Any]:
        return {"id": row["id"], "name": row["name"], "platform": row["platform"],
                "created_at": row["created_at"], "last_seen": row["last_seen"]}

    # -- chats -------------------------------------------------------------------

    def ensure_chat(self, chat_id: str, title: str = "", kind: str = "chat") -> Dict[str, Any]:
        now = _now()
        self._exec("INSERT OR IGNORE INTO chats (id, title, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                   (chat_id, (title or chat_id)[:80], kind, now, now))
        return self.get_chat(chat_id)

    def create_chat(self, title: str = "") -> Dict[str, Any]:
        return self.ensure_chat("c-" + new_id(), (title or "").strip() or "New chat")

    def get_chat(self, chat_id: str) -> Optional[Dict[str, Any]]:
        row = self._one("SELECT * FROM chats WHERE id = ?", (chat_id,))
        return dict(row) if row else None

    def list_chats(self) -> List[Dict[str, Any]]:
        return [dict(r) for r in self._all("SELECT * FROM chats ORDER BY updated_at DESC")]

    def rename_chat(self, chat_id: str, title: str) -> Optional[Dict[str, Any]]:
        title = (title or "").strip()[:80]
        if not title:
            return self.get_chat(chat_id)
        self._exec("UPDATE chats SET title = ? WHERE id = ?", (title, chat_id))
        return self.get_chat(chat_id)

    def delete_chat(self, chat_id: str) -> bool:
        with self._lock:
            self._exec("DELETE FROM messages WHERE chat_id = ?", (chat_id,))
            return self._exec("DELETE FROM chats WHERE id = ?", (chat_id,)) == 1

    def _touch_chat(self, chat_id: str, preview: str) -> None:
        preview = " ".join((preview or "").split())[:140]
        self._exec("UPDATE chats SET updated_at = ?, preview = ? WHERE id = ?", (_now(), preview, chat_id))

    # -- messages ----------------------------------------------------------------

    def add_message(self, chat_id: str, role: str, text: str, *, status: str = "final",
                    meta: Optional[Dict[str, Any]] = None, message_id: Optional[str] = None) -> Dict[str, Any]:
        self.ensure_chat(chat_id)
        message_id, now = message_id or new_id(), _now()
        self._exec("INSERT INTO messages (id, chat_id, role, text, status, meta, created_at, updated_at) "
                   "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                   (message_id, chat_id, role, text, status, json.dumps(meta or {}), now, now))
        self._touch_chat(chat_id, text)
        return self.get_message(message_id)

    def update_message(self, message_id: str, text: str, *, status: Optional[str] = None) -> Optional[Dict[str, Any]]:
        with self._lock:
            current = self.get_message(message_id)
            if current is None:
                return None
            self._exec("UPDATE messages SET text = ?, status = ?, updated_at = ? WHERE id = ?",
                       (text, status or current["status"], _now(), message_id))
            self._touch_chat(current["chat_id"], text)
            return self.get_message(message_id)

    def delete_message(self, message_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            current = self.get_message(message_id)
            if current is not None:
                self._exec("DELETE FROM messages WHERE id = ?", (message_id,))
            return current

    def find_user_message(self, chat_id: str, client_id: str) -> Optional[Dict[str, Any]]:
        """A message this chat already received with the app's ``client_id`` (retry detection)."""
        row = self._one("SELECT * FROM messages WHERE chat_id = ? AND role = 'user' "
                        "AND json_extract(meta, '$.client_id') = ?", (chat_id, client_id))
        return self._message(row) if row else None

    def streaming_messages(self, chat_id: str) -> List[Dict[str, Any]]:
        rows = self._all("SELECT * FROM messages WHERE chat_id = ? AND status = 'streaming'", (chat_id,))
        return [self._message(r) for r in rows]

    def get_message(self, message_id: str) -> Optional[Dict[str, Any]]:
        row = self._one("SELECT * FROM messages WHERE id = ?", (message_id,))
        return self._message(row) if row else None

    def list_messages(self, chat_id: str, *, before: Optional[float] = None, limit: int = 50) -> List[Dict[str, Any]]:
        limit = max(1, min(int(limit or 50), 200))
        if before:
            rows = self._all("SELECT * FROM messages WHERE chat_id = ? AND created_at < ? "
                             "ORDER BY created_at DESC LIMIT ?", (chat_id, float(before), limit))
        else:
            rows = self._all("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?",
                             (chat_id, limit))
        return [self._message(r) for r in reversed(rows)]

    @staticmethod
    def _message(row: sqlite3.Row) -> Dict[str, Any]:
        out = dict(row)
        out["meta"] = json.loads(out.get("meta") or "{}")
        return out

    # -- inbox -------------------------------------------------------------------

    def add_inbox(self, kind: str, chat_id: str, title: str, body: str = "",
                  payload: Optional[Dict[str, Any]] = None, status: str = "pending") -> Dict[str, Any]:
        item_id, now = new_id(), _now()
        self._exec("INSERT INTO inbox (id, kind, chat_id, title, body, payload, status, created_at, updated_at) "
                   "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                   (item_id, kind, chat_id, title[:200], body, json.dumps(payload or {}), status, now, now))
        return self.get_inbox(item_id)

    def get_inbox(self, item_id: str) -> Optional[Dict[str, Any]]:
        row = self._one("SELECT * FROM inbox WHERE id = ?", (item_id,))
        return self._inbox(row) if row else None

    def list_inbox(self, *, status: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        limit = max(1, min(int(limit or 100), 500))
        if status:
            rows = self._all("SELECT * FROM inbox WHERE status = ? ORDER BY created_at DESC LIMIT ?", (status, limit))
        else:
            rows = self._all("SELECT * FROM inbox ORDER BY created_at DESC LIMIT ?", (limit,))
        return [self._inbox(r) for r in rows]

    def resolve_inbox(self, item_id: str, status: str, resolution: str = "") -> Optional[Dict[str, Any]]:
        """Move a pending item to ``status``; returns None if it was not pending (already handled)."""
        with self._lock:
            changed = self._exec("UPDATE inbox SET status = ?, resolution = ?, updated_at = ? "
                                 "WHERE id = ? AND status = 'pending'", (status, resolution, _now(), item_id))
            return self.get_inbox(item_id) if changed == 1 else None

    def expire_pending(self, kind: str, *, chat_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Mark pending items of ``kind`` expired (e.g. when a new approval supersedes old ones)."""
        with self._lock:
            if chat_id:
                rows = self._all("SELECT id FROM inbox WHERE kind = ? AND chat_id = ? AND status = 'pending'",
                                 (kind, chat_id))
            else:
                rows = self._all("SELECT id FROM inbox WHERE kind = ? AND status = 'pending'", (kind,))
            return [item for r in rows if (item := self.resolve_inbox(r["id"], "expired"))]

    def pending_items(self, kind: Optional[str] = None) -> List[Dict[str, Any]]:
        """Every pending item, however old: these are the ones that still need an answer."""
        if kind:
            rows = self._all("SELECT * FROM inbox WHERE status = 'pending' AND kind = ? ORDER BY created_at DESC",
                             (kind,))
        else:
            rows = self._all("SELECT * FROM inbox WHERE status = 'pending' ORDER BY created_at DESC")
        return [self._inbox(r) for r in rows]

    def pending_count(self) -> int:
        row = self._one("SELECT COUNT(*) AS n FROM inbox WHERE status = 'pending'")
        return int(row["n"]) if row else 0

    @staticmethod
    def _inbox(row: sqlite3.Row) -> Dict[str, Any]:
        out = dict(row)
        out["payload"] = json.loads(out.get("payload") or "{}")
        return out

    # -- push subscriptions --------------------------------------------------------

    def add_push_sub(self, device_id: str, kind: str, endpoint: str, data: Dict[str, Any]) -> Dict[str, Any]:
        sub_id = new_id()
        with self._lock:
            self._exec("DELETE FROM push_subs WHERE kind = ? AND endpoint = ?", (kind, endpoint))
            self._exec("INSERT INTO push_subs (id, device_id, kind, endpoint, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                       (sub_id, device_id, kind, endpoint, json.dumps(data), _now()))
        return {"id": sub_id, "device_id": device_id, "kind": kind, "endpoint": endpoint}

    def list_push_subs(self, kind: Optional[str] = None) -> List[Dict[str, Any]]:
        if kind:
            rows = self._all("SELECT * FROM push_subs WHERE kind = ?", (kind,))
        else:
            rows = self._all("SELECT * FROM push_subs")
        return [{**dict(r), "data": json.loads(r["data"])} for r in rows]

    def remove_push_sub(self, *, endpoint: str, device_id: Optional[str] = None) -> int:
        if device_id:
            return self._exec("DELETE FROM push_subs WHERE endpoint = ? AND device_id = ?", (endpoint, device_id))
        return self._exec("DELETE FROM push_subs WHERE endpoint = ?", (endpoint,))
