"""Members' tool limits through Hermes's own toolset resolver.

Runs only where Hermes is installed (CI has a job for it). Hermes adds to any per-source override:
default-on plugin toolsets, and x_search when xAI keys exist. A limited member must end up with exactly
what the owner allowed, and with nothing when the limit can't be worked out.
"""

import importlib.util
from types import SimpleNamespace

import pytest

pytestmark = pytest.mark.skipif(importlib.util.find_spec("gateway") is None
                                or importlib.util.find_spec("hermes_cli") is None,
                                reason="needs Hermes Agent installed")


@pytest.fixture
def hermes(tmp_path, monkeypatch):
    """A Hermes home whose owner has only web on for Winglet, a newly installed plugin whose toolset is
    on by default, and xAI keys."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "home"))
    (tmp_path / "home").mkdir()
    (tmp_path / "home" / "config.yaml").write_text("platform_toolsets:\n  winglet: [web, todo]\n")
    from hermes_cli import config as config_module
    from hermes_cli import tools_config
    monkeypatch.setattr(tools_config, "_get_plugin_toolset_keys", lambda: {"shell_plugin"})
    monkeypatch.setattr(tools_config, "_xai_credentials_present", lambda: True)
    return config_module.load_config()


@pytest.fixture
def runner(hermes, tmp_path):
    from gateway.run_turn import GatewayTurnMixin
    from plugin import adapter as adapter_module
    from plugin import hermes_api
    from plugin.hub import Hub
    from plugin.store import Store

    store = Store(tmp_path / "winglet.db")
    hub = Hub(store, web_root=tmp_path / "web")
    hub.hermes = hermes_api
    hub.limits_members = True
    owner, _ = store.add_device("Pixel", "android", role="owner")
    member, _ = store.add_device("Alex", "android", role="member")
    adapter = adapter_module.WingletAdapter.__new__(adapter_module.WingletAdapter)
    adapter.platform, adapter._hub = SimpleNamespace(value="winglet"), hub

    class Runner(GatewayTurnMixin):
        def _delivery_adapter_for(self, source):
            return adapter

    gateway = Runner()
    unlimited = gateway._resolve_enabled_toolsets_for_source
    assert hermes_api.limit_turn_toolsets(gateway, adapter._toolset_limit)

    def resolve(device, *, capped=True):
        source = SimpleNamespace(platform=SimpleNamespace(value="winglet"), user_id=f"winglet:{device['id']}",
                                 chat_id="m-1")
        return (gateway._resolve_enabled_toolsets_for_source if capped else unlimited)(hermes, source, "winglet")

    yield SimpleNamespace(hub=hub, owner=owner, member=member, resolve=resolve)
    store.close()


def limit(hub, toolsets, mcp=False):
    hub.store.set_kv("member_tools", '{"limited": true, "toolsets": %s, "mcp": %s}'
                     % (str(list(toolsets)).replace("'", '"'), "true" if mcp else "false"))


def test_hermes_widens_the_override_on_its_own(runner):
    # Why the cap exists: the override alone doesn't hold.
    limit(runner.hub, [])
    widened = runner.resolve(runner.member, capped=False)
    assert {"shell_plugin", "x_search"} & set(widened)


def test_a_member_limited_to_nothing_gets_nothing(runner):
    limit(runner.hub, [])
    assert runner.resolve(runner.member) == []


def test_a_member_gets_exactly_what_was_allowed(runner):
    limit(runner.hub, ["web", "terminal"])  # terminal is off for the owner
    assert runner.resolve(runner.member) == ["web"]


def test_a_failed_lookup_gives_no_tools(runner, monkeypatch):
    limit(runner.hub, ["web"])

    def broken(*args, **kwargs):
        raise RuntimeError("config unreadable")
    monkeypatch.setattr(runner.hub.hermes, "member_toolsets", broken)
    assert runner.resolve(runner.member) == []


def test_owners_and_unlimited_members_are_left_alone(runner):
    owner = runner.resolve(runner.owner)
    assert "web" in owner and owner == runner.resolve(runner.owner, capped=False)
    assert runner.resolve(runner.member) == runner.resolve(runner.member, capped=False)


def test_the_cap_wraps_once_and_needs_the_resolver(runner):
    from gateway.run_turn import GatewayTurnMixin
    from plugin import hermes_api

    class Runner(GatewayTurnMixin):
        pass
    gateway = Runner()
    assert hermes_api.limit_turn_toolsets(gateway, lambda source: None)
    wrapped = gateway._resolve_enabled_toolsets_for_source
    assert hermes_api.limit_turn_toolsets(gateway, lambda source: None)
    assert gateway._resolve_enabled_toolsets_for_source is wrapped
    assert hermes_api.limit_turn_toolsets(object(), lambda source: None) is False
