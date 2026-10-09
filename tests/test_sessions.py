"""The sessions browser: past conversations on every platform, read-only and for owners."""

import importlib.util
import json

import pytest

from plugin import hermes_api
from plugin.hub import Hub
from plugin.store import Store
from test_control import Refused, Unavailable
from test_trust import pair_phone


class FakeHermes:
    HermesRefused = Refused
    HermesUnavailable = Unavailable

    def __init__(self):
        self.calls = []

    def sessions_available(self):
        return True

    def list_sessions(self, limit, offset):
        self.calls.append(("list", limit, offset))
        return {"sessions": [{"id": "s1", "title": "Trip", "source": "telegram"}], "total": 1}

    async def search_sessions(self, query):
        self.calls.append(("search", query))
        return [{"id": "s1", "snippet": ">>>trip<<< plans"}]

    async def session_transcript(self, session_id):
        if session_id != "s1":
            raise Refused("Session not found")
        return {"session": {"id": "s1"}, "messages": [{"role": "user", "text": "hi"}], "truncated": False}


@pytest.fixture
def hub(tmp_path):
    store = Store(tmp_path / "data.db")
    h = Hub(store, web_root=tmp_path / "web", bot_info=lambda: {"name": "hermes", "title": "Hermes"})
    h.hermes = FakeHermes()
    yield h
    store.close()


@pytest.fixture
async def client(aiohttp_client, hub):
    return await aiohttp_client(hub.build_app())


async def test_owners_list_search_and_read_sessions(client, hub):
    owner = await pair_phone(client, hub)
    assert (await (await client.get("/api/info")).json())["features"]["sessions"] is True
    page = await (await client.get("/api/sessions?limit=500&offset=-3", headers=owner.auth)).json()
    assert page["total"] == 1 and hub.hermes.calls[-1] == ("list", 100, 0)
    assert (await client.get("/api/sessions?limit=x", headers=owner.auth)).status == 400
    found = await (await client.get("/api/sessions/search?q=%20trip%20", headers=owner.auth)).json()
    assert found["results"][0]["id"] == "s1" and hub.hermes.calls[-1] == ("search", "trip")
    assert (await (await client.get("/api/sessions/search?q=", headers=owner.auth)).json()) == {"results": []}
    assert (await client.get("/api/sessions/search?q=" + "x" * 201, headers=owner.auth)).status == 400
    transcript = await (await client.get("/api/sessions/s1", headers=owner.auth)).json()
    assert transcript["messages"][0]["text"] == "hi"
    assert (await client.get("/api/sessions/nope", headers=owner.auth)).status == 400
    assert (await client.get("/api/sessions/bad%20id%2F..", headers=owner.auth)).status == 404


async def test_members_cant_read_other_peoples_conversations(client, hub):
    member = await pair_phone(client, hub, "Alex", role="member")
    for path in ("/api/sessions", "/api/sessions/search?q=trip", "/api/sessions/s1"):
        assert (await client.get(path, headers=member.auth)).status == 403
    assert (await client.get("/api/sessions")).status == 401
    assert hub.hermes.calls == []


def test_messages_become_plain_text_turns():
    msg = hermes_api._session_message
    assert msg({"role": "system", "content": "secret prompt"}) is None
    assert msg({"role": "assistant", "content": "x", "display_kind": "hidden"}) is None
    assert msg({"role": "user", "content": "hi", "timestamp": "12.5", "id": 3}) == {
        "id": "3", "role": "user", "text": "hi", "at": 12.5, "failed": False}
    calls = json.dumps([{"function": {"name": "web_search"}}, {"name": "terminal"}])
    out = msg({"role": "assistant", "content": "", "tool_calls": calls})
    assert out["tools"] == ["web_search", "terminal"] and out["text"] == ""
    assert msg({"role": "assistant", "content": "", "tool_calls": None}) is None
    tool = msg({"role": "tool", "content": "y" * 5000, "tool_name": "web_search"})
    assert tool["tool"] == "web_search" and len(tool["text"]) == hermes_api.MAX_TOOL_TEXT + 1
    shown = msg({"role": "assistant", "content": "raw", "display_content": "summary", "display_kind": "failed_turn"})
    assert shown["text"] == "summary" and shown["failed"] is True
    parts = msg({"role": "user", "content": [{"type": "text", "text": "look"}, {"type": "image_url"}]})
    assert parts["text"].strip() == "look"


def test_session_rows_keep_only_what_the_list_shows():
    row = hermes_api._session_row({"id": "a", "display_name": "Named", "source": "cron", "preview": "  a\n b  ",
                                   "message_count": "4", "is_active": 1, "system_prompt": "never sent"})
    assert row["title"] == "Named" and row["preview"] == "a b" and row["message_count"] == 4 and row["active"] is True
    assert "system_prompt" not in row


hermes = pytest.mark.skipif(importlib.util.find_spec("hermes_cli") is None
                            or importlib.util.find_spec("hermes_state") is None, reason="needs Hermes Agent installed")


@hermes
async def test_real_hermes_sessions(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))
    (tmp_path / "home").mkdir()
    from hermes_state import SessionDB
    db = SessionDB()
    try:
        db.create_session("trip-1", "telegram")
        db.set_session_title("trip-1", "Trip to Lisbon")
        db.append_message("trip-1", "user", "Find flights to Lisbon in May")
        db.append_message("trip-1", "assistant", "", tool_calls=[{"id": "c1", "type": "function",
                          "function": {"name": "web_search", "arguments": "{}"}}])
        db.append_message("trip-1", "tool", "3 results", tool_name="web_search", tool_call_id="c1")
        db.append_message("trip-1", "assistant", "Here are three options.")
    finally:
        db.close()
    assert hermes_api.sessions_available()
    page = hermes_api.list_sessions(30, 0)
    assert page["total"] == 1 and page["sessions"][0]["title"] == "Trip to Lisbon"
    assert page["sessions"][0]["source"] == "telegram"
    found = await hermes_api.search_sessions("lisbon")
    assert found and found[0]["id"] == "trip-1"
    transcript = await hermes_api.session_transcript("trip-1")
    roles = [(m["role"], m.get("tools") or m.get("tool") or m["text"]) for m in transcript["messages"]]
    assert roles == [("user", "Find flights to Lisbon in May"), ("assistant", ["web_search"]),
                     ("tool", "web_search"), ("assistant", "Here are three options.")]
    with pytest.raises(hermes_api.HermesRefused):
        await hermes_api.session_transcript("missing")
