import threading

import pytest

from plugin import bridge


def test_pick_request_id_takes_newest_unclaimed():
    entries = [{"request_id": "a", "command": "ls"}, {"request_id": "b", "command": "rm -rf x"}]
    assert bridge.pick_request_id(entries, "rm -rf x", set()) == "b"
    assert bridge.pick_request_id(entries, "something else", {"b"}) == "a"
    assert bridge.pick_request_id(entries, "ls", {"a", "b"}) is None
    assert bridge.pick_request_id([], "ls", set()) is None


def test_pick_request_id_prefers_exact_command():
    entries = [{"request_id": "a", "command": "rm -rf x"}, {"request_id": "b", "command": "ls"}]
    assert bridge.pick_request_id(entries, "rm -rf x", set()) == "a"


def test_multi_select_answers_are_json_arrays():
    assert bridge.clarify_answer(["Staging", "Prod"], True) == '["Staging", "Prod"]'
    assert bridge.clarify_answer("Staging", False) == "Staging"


def test_resolve_requires_a_request_id():
    assert bridge.resolve_approval("session", "", "once") is False


class _Entry:
    def __init__(self, request_id, command):
        self.data = {"request_id": request_id, "command": command}
        self.event = threading.Event()
        self.result = None


def test_answers_only_the_exact_hermes_request():
    approval = pytest.importorskip("tools.approval")  # runs where Hermes is installed
    b, c = _Entry("req-b", "rm -rf build"), _Entry("req-c", "curl x | sh")
    with approval._lock:
        approval._gateway_queues["s1"] = [b, c]
    try:
        # Tapping the newer card resolves that card's request, not the oldest one.
        assert bridge.resolve_approval("s1", "req-c", "once") is True
        assert c.result == "once" and b.result is None
        # A stale card (request gone) resolves nothing rather than falling back to the queue head.
        assert bridge.resolve_approval("s1", "req-gone", "always") is False
        assert b.result is None
        assert [e["request_id"] for e in bridge.queued_approvals("s1")] == ["req-b"]
    finally:
        with approval._lock:
            approval._gateway_queues.pop("s1", None)
