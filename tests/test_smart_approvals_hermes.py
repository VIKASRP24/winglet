"""Smart approval round trips through the installed Hermes gateway and Winglet.

Only the auxiliary inference call is stubbed; no command is actually executed.
These tests are collected by the Plugin tests with Hermes CI job.
"""
import asyncio
from types import SimpleNamespace

import pytest

pytest.importorskip("gateway.run_turn_runner")
from gateway.run_turn_runner import TurnRunner
from tools import approval, approval_context
from agent import auxiliary_client
from plugin.adapter import WingletAdapter
from plugin.hub import Hub
from plugin.store import Store
from test_trust import pair_phone, post_signed


COMMAND = "python -c 'print(123)'"  # Hermes flags script execution; never run it.
SESSION = "winglet:smart-integration"


@pytest.fixture
async def smart_gateway(tmp_path, monkeypatch, aiohttp_client):
    home = tmp_path / "hermes"
    home.mkdir()
    (home / "config.yaml").write_text("approvals:\n  mode: smart\n  timeout: 30\n", encoding="utf-8")
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_GATEWAY_SESSION", "1")
    store = Store(tmp_path / "winglet.db")
    store.ensure_chat("general", "General")
    hub = Hub(store, web_root=tmp_path / "web")
    adapter = WingletAdapter.__new__(WingletAdapter)
    adapter.platform = SimpleNamespace(value="winglet")  # Hermes derives adapter.name from it
    adapter._hub = hub
    adapter._typing_paused = set()
    hub.on_approval = adapter._on_approval
    client = await aiohttp_client(hub.build_app())
    phone = await pair_phone(client, hub)
    ctx = SimpleNamespace(_status_adapter=adapter, _status_chat_id="general", session_key=SESSION,
                          _status_thread_metadata=None, stream_consumer_holder=None,
                          _loop_for_step=asyncio.get_running_loop())
    runner = TurnRunner(None, ctx)
    approval.register_gateway_notify(SESSION, runner._approval_notify_sync)
    yield SimpleNamespace(home=home, store=store, hub=hub, client=client, phone=phone)
    # Unblock an in-flight test even when an assertion fails.
    approval.resolve_gateway_approval(SESSION, "deny")
    approval.unregister_gateway_notify(SESSION)
    approval.clear_session(SESSION)
    for task in list(hub._push_tasks.values()):
        task.cancel()
    store.close()


def run_gate():
    token = approval_context.set_current_session_key(SESSION)
    try:
        return approval.check_all_command_guards(COMMAND, "local")
    finally:
        approval_context.reset_current_session_key(token)


def model_reply(text):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


async def wait_for_card(gateway, task):
    async def wait():
        while True:
            cards = gateway.store.pending_items("approval")
            if cards:
                return cards[0]
            if task.done():
                raise AssertionError(f"Gate returned without a card: {task.result()!r}")
            await asyncio.sleep(0.01)
    return await asyncio.wait_for(wait(), timeout=10)


def stub_model(monkeypatch, verdict):
    calls = []
    def call_llm(**kwargs):
        calls.append(kwargs)
        if isinstance(verdict, Exception):
            raise verdict
        return model_reply(verdict)
    monkeypatch.setattr(auxiliary_client, "call_llm", call_llm)
    return calls


async def test_smart_approve_has_no_card_or_pending_request(smart_gateway, monkeypatch):
    calls = stub_model(monkeypatch, "APPROVE")
    result = await asyncio.wait_for(asyncio.to_thread(run_gate), timeout=10)
    assert result["approved"] is True and result["smart_approved"] is True
    assert len(calls) == 1 and calls[0]["task"] == "approval"
    assert smart_gateway.store.pending_count() == 0
    assert smart_gateway.store.list_inbox() == []
    assert approval.list_gateway_approvals(SESSION) == []


async def test_smart_denial_requires_signed_one_time_override(smart_gateway, monkeypatch):
    calls = stub_model(monkeypatch, "DENY")
    task = asyncio.create_task(asyncio.to_thread(run_gate))
    card = await wait_for_card(smart_gateway, task)
    payload = card["payload"]
    assert payload["smart_denied"] is True
    assert payload["choices"] == ["once", "deny"]
    assert len(calls) == 1 and calls[0]["task"] == "approval"
    assert not task.done()
    path = f"/api/inbox/{card['id']}/respond"
    for choice in ("session", "always"):
        response = await post_signed(smart_gateway.client, smart_gateway.phone, path, {"choice": choice})
        assert response.status == 409
        assert not task.done()
    response = await smart_gateway.client.post(path, json={"choice": "once"}, headers=smart_gateway.phone.auth)
    assert response.status == 403
    assert not task.done()
    response = await post_signed(smart_gateway.client, smart_gateway.phone, path, {"choice": "once"})
    assert response.status == 200
    result = await asyncio.wait_for(task, timeout=10)
    assert result["approved"] is True
    assert smart_gateway.store.pending_count() == 0
    assert approval.list_gateway_approvals(SESSION) == []


@pytest.mark.parametrize("verdict", [RuntimeError("guardian unavailable"), "not a verdict"])
async def test_failed_smart_model_escalates_to_normal_card(smart_gateway, monkeypatch, verdict):
    calls = stub_model(monkeypatch, verdict)
    task = asyncio.create_task(asyncio.to_thread(run_gate))
    card = await wait_for_card(smart_gateway, task)
    assert card["payload"]["smart_denied"] is False
    assert card["payload"]["choices"] == ["once", "session", "always", "deny"]
    assert len(calls) == 1 and calls[0]["task"] == "approval"
    assert not task.done()
    response = await post_signed(smart_gateway.client, smart_gateway.phone,
                                 f"/api/inbox/{card['id']}/respond", {"choice": "deny"})
    assert response.status == 200
    result = await asyncio.wait_for(task, timeout=10)
    assert result["approved"] is False
    assert smart_gateway.store.pending_count() == 0
    assert approval.list_gateway_approvals(SESSION) == []


async def test_manual_mode_does_not_call_guardian(smart_gateway, monkeypatch):
    (smart_gateway.home / "config.yaml").write_text("approvals:\n  mode: manual\n  timeout: 30\n", encoding="utf-8")
    calls = stub_model(monkeypatch, "APPROVE")
    task = asyncio.create_task(asyncio.to_thread(run_gate))
    card = await wait_for_card(smart_gateway, task)
    assert not calls and not task.done()
    assert card["payload"]["smart_denied"] is False
    response = await post_signed(smart_gateway.client, smart_gateway.phone,
                                 f"/api/inbox/{card['id']}/respond", {"choice": "deny"})
    assert response.status == 200
    assert (await asyncio.wait_for(task, timeout=10))["approved"] is False
    assert approval.list_gateway_approvals(SESSION) == []
