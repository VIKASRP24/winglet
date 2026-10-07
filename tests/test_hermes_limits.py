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


class _Platform:
    value = "winglet"


WINGLET = _Platform()


def winglet_profile(tmp_path, name):
    """One profile's Winglet: its own store of devices, behind its own adapter."""
    from plugin import adapter as adapter_module
    from plugin import hermes_api
    from plugin.hub import Hub
    from plugin.store import Store

    store = Store(tmp_path / f"{name}.db")
    hub = Hub(store, web_root=tmp_path / "web")
    hub.hermes = hermes_api
    owner, _ = store.add_device(f"{name} owner", "android", role="owner")
    member, _ = store.add_device(f"{name} member", "android", role="member")
    adapter = adapter_module.WingletAdapter.__new__(adapter_module.WingletAdapter)
    adapter.platform, adapter._hub = WINGLET, hub
    return SimpleNamespace(hub=hub, store=store, owner=owner, member=member, adapter=adapter)


@pytest.fixture
def runner(hermes, tmp_path):
    """A multiplexed gateway serving two profiles, each with its own Winglet, using Hermes's own routing
    (GatewayAuthorizationMixin) and toolset resolution (GatewayTurnMixin)."""
    from gateway.authz_mixin import GatewayAuthorizationMixin
    from gateway.run_turn import GatewayTurnMixin
    from plugin import hermes_api

    home, work = winglet_profile(tmp_path, "home"), winglet_profile(tmp_path, "work")

    class Runner(GatewayAuthorizationMixin, GatewayTurnMixin):
        pass

    gateway = Runner()
    gateway.config = SimpleNamespace(multiplex_profiles=True)
    gateway._primary_profile_name = "default"
    gateway.adapters = {WINGLET: home.adapter}
    gateway._profile_adapters = {"work": {WINGLET: work.adapter}}
    unlimited = gateway._resolve_enabled_toolsets_for_source
    # Each profile's adapter connects and registers, as connect() does.
    for profile in (home, work):
        profile.hub.limits_members = hermes_api.limit_turn_toolsets(gateway, "winglet")
        assert profile.hub.limits_members

    def resolve(device, profile=None, *, capped=True):
        source = SimpleNamespace(platform=WINGLET, user_id=f"winglet:{device['id']}", chat_id="m-1", profile=profile)
        return (gateway._resolve_enabled_toolsets_for_source if capped else unlimited)(hermes, source, "winglet")

    yield SimpleNamespace(gateway=gateway, home=home, work=work, hub=home.hub, owner=home.owner, member=home.member,
                          resolve=resolve)
    home.store.close()
    work.store.close()


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


def test_each_profile_is_checked_against_its_own_devices(runner):
    home, work = runner.home, runner.work
    for profile, name in ((home, None), (work, "work")):
        owner = runner.resolve(profile.owner, name)
        assert "web" in owner and owner == runner.resolve(profile.owner, name, capped=False)
    # Limits on one profile don't reach the other.
    limit(work.hub, [])
    assert runner.resolve(work.member, "work") == []
    assert runner.resolve(home.member) == runner.resolve(home.member, capped=False)
    assert "web" in runner.resolve(work.owner, "work")


def test_a_replaced_adapter_answers_the_next_turn(runner, tmp_path):
    work = runner.work
    limit(work.hub, ["web"])
    assert runner.resolve(work.member, "work") == ["web"]
    # The profile reconnects with a fresh adapter whose devices limit this member to nothing.
    fresh = winglet_profile(tmp_path, "work-again")
    fresh.store._exec("UPDATE devices SET id = ? WHERE id = ?", (work.member["id"], fresh.member["id"]))
    limit(fresh.hub, [])
    runner.gateway._profile_adapters["work"] = {WINGLET: fresh.adapter}
    assert runner.resolve(work.member, "work") == []
    fresh.store.close()


def test_a_profile_without_its_adapter_gets_nothing(runner):
    runner.gateway._profile_adapters["work"] = {}
    assert runner.resolve(runner.work.owner, "work") == []


def test_the_cap_wraps_once_and_needs_hermes_steps(runner):
    from plugin import hermes_api
    wrapped = runner.gateway._resolve_enabled_toolsets_for_source
    assert hermes_api.limit_turn_toolsets(runner.gateway, "winglet")
    assert runner.gateway._resolve_enabled_toolsets_for_source is wrapped
    assert hermes_api.limit_turn_toolsets(object(), "winglet") is False
