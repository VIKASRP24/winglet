"""Exercise the real adapter with small Hermes interface doubles, without installing the gateway."""

import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

from plugin import bridge
from plugin.hub import Hub
from plugin.store import Store


@pytest.fixture
def adapter(monkeypatch, tmp_path):
    shared = {name: lambda *args, **kwargs: None for name in
              ("extra_or_secret", "get_scoped_secret", "seed_extra_from_env")}
    interfaces = {
        "gateway": {}, "gateway.platforms": {},
        "gateway.config": {"Platform": str, "PlatformConfig": object},
        "gateway.platforms._shared": shared,
        "gateway.platforms.base": {"BasePlatformAdapter": object, "ExecApprovalPrompt": SimpleNamespace,
                                   "SendResult": SimpleNamespace},
        "gateway.platforms.event": {"MessageEvent": SimpleNamespace, "MessageType": SimpleNamespace},
    }
    for name, members in interfaces.items():
        module = ModuleType(name)
        module.__dict__.update(members)
        monkeypatch.setitem(sys.modules, name, module)
    spec = importlib.util.spec_from_file_location("plugin._approval_test_adapter",
                                                 Path(__file__).parents[1] / "plugin" / "adapter.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    instance = module.WingletAdapter.__new__(module.WingletAdapter)
    store = Store(tmp_path / "adapter.db")
    instance.name = "Winglet"
    instance._hub = Hub(store)
    yield instance
    awaitable_tasks = list(instance._hub._push_tasks.values())
    for task in awaitable_tasks:
        task.cancel()
    store.close()


def prompt(**overrides):
    values = {"chat_id": "general", "session_key": "s1", "command": "ls", "description": "Inspect",
              "metadata": {}, "actions": [("Allow once", "once", "primary"), ("Deny", "deny", "danger")],
              "choices": ["once", "deny"], "smart_denied": False}
    return SimpleNamespace(**(values | overrides))


async def test_missing_or_withdrawn_identity_never_creates_an_actionable_card(adapter, monkeypatch):
    queue = [{"request_id": "replacement", "command": "ls"}]
    monkeypatch.setattr(bridge, "queued_approvals", lambda session: queue)
    for p in (prompt(), prompt(metadata={"approval_request_id": "withdrawn"}),
              prompt(command="harmless", metadata={"request_id": "replacement"})):
        result = await adapter._send_exec_approval_prompt(p)
        assert result.success is False  # Hermes uses its existing typed approval fallback
    assert adapter._hub.store.pending_count() == 0
    assert adapter._hub.store.list_messages("general") == []
    assert adapter._hub._http is None


async def test_identical_commands_bind_and_resolve_only_the_supplied_id(adapter, monkeypatch):
    queue = [{"request_id": "a", "command": "ls"}, {"request_id": "b", "command": "ls"}]
    monkeypatch.setattr(bridge, "queued_approvals", lambda session: queue)
    resolved = []
    monkeypatch.setattr(bridge, "resolve_approval", lambda session, identity, choice:
                        resolved.append((session, identity, choice)) or True)
    adapter._hub.on_approval = adapter._on_approval
    for identity in ("b", "a"):
        result = await adapter._send_exec_approval_prompt(prompt(metadata={"approval_request_id": identity}))
        assert result.success
    items = adapter._hub.store.pending_items("approval")
    card_b = next(i for i in items if i["payload"]["request_id"] == "b")
    ok, _ = await adapter._hub.respond(card_b["id"], choice="once")
    assert ok and resolved == [("s1", "b", "once")]
    assert adapter._hub.store.pending_count() == 1


async def test_already_claimed_identity_cannot_create_a_duplicate_card(adapter, monkeypatch):
    monkeypatch.setattr(bridge, "queued_approvals", lambda session: [{"request_id": "a", "command": "ls"}])
    p = prompt(request_id="a")
    assert (await adapter._send_exec_approval_prompt(p)).success
    assert not (await adapter._send_exec_approval_prompt(p)).success
    assert adapter._hub.store.pending_count() == 1
