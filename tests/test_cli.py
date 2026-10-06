"""CLI readiness checks should never hand out a QR for a stopped gateway."""

import argparse
import io
import json
import sys
from types import ModuleType

import pytest

from plugin import cli
from plugin.store import Store


@pytest.fixture
def config(monkeypatch):
    values = {}
    module = ModuleType("hermes_cli.config")
    module.get_env_value = values.get
    module.save_env_value = lambda key, value: values.update({key: value})
    monkeypatch.setitem(sys.modules, "hermes_cli", ModuleType("hermes_cli"))
    monkeypatch.setitem(sys.modules, "hermes_cli.config", module)
    monkeypatch.setattr(cli, "lan_ip", lambda: "173.249.54.31")
    return values


def test_pair_does_not_open_store_or_print_qr_when_gateway_is_down(monkeypatch, capsys):
    monkeypatch.setattr(cli, "_running", lambda: None)
    monkeypatch.setattr(cli, "_print_qr", lambda _: pytest.fail("QR must not be created"))
    # No adapter/Hermes dependency is available in this test. Trying to create a code
    # before checking readiness would also fail by importing the adapter.
    assert cli.cmd_pair(argparse.Namespace(public_url=None)) == 1
    output = capsys.readouterr().out
    assert "Pairing is not ready" in output
    assert "hermes gateway run" in output
    assert "Link:" not in output


def test_ready_gateway_creates_redeemable_code_for_configured_url(config, monkeypatch, tmp_path):
    config["WINGLET_PUBLIC_URL"] = "https://winglet.example.com"
    monkeypatch.setattr(cli, "_running", lambda: {"app": "winglet", "server_id": "s1"})
    module = ModuleType("plugin.adapter")
    module.open_store = lambda: Store(tmp_path / "data.db")
    monkeypatch.setitem(sys.modules, "plugin.adapter", module)
    links = []
    monkeypatch.setattr(cli, "_print_qr", links.append)
    assert cli.cmd_pair(argparse.Namespace(public_url=None)) == 0
    assert len(links) == 1
    assert links[0].startswith("https://winglet.example.com/#pair=")
    store = Store(tmp_path / "data.db")
    try:
        assert store.redeem_pair_code(links[0].split("#pair=")[1].split("&")[0])
    finally:
        store.close()


@pytest.mark.parametrize("payload", [{"app": "another-service", "server_id": "s1"}, [],
                                    {"app": "winglet"}, {"app": "winglet", "server_id": "s1"}])
def test_unrelated_service_cannot_pass_gateway_readiness(config, monkeypatch, payload):
    opener = cli.urllib.request.build_opener(cli.urllib.request.ProxyHandler({}))
    monkeypatch.setattr(opener, "open", lambda *args, **kwargs: io.BytesIO(json.dumps(payload).encode()))
    monkeypatch.setattr(cli.urllib.request, "build_opener", lambda *args: opener)
    result = cli._running()
    assert bool(result) == (isinstance(payload, dict) and payload.get("app") == "winglet"
                            and bool(payload.get("server_id")))


@pytest.mark.parametrize("running", [None, {"app": "winglet", "server_id": "s1"}])
def test_setup_reports_readiness_without_claiming_phone_connectivity(config, monkeypatch, capsys, running):
    monkeypatch.setattr(cli, "_running", lambda: running)
    assert cli.cmd_setup(argparse.Namespace(port=None, public_url=None, connection="direct")) == 0
    assert config["WINGLET_ENABLED"] == "true"
    output = capsys.readouterr().out
    expected = "Gateway: running locally." if running else "Pairing is not ready"
    assert expected in output
    assert "Phone connectivity: not verified" in output
    assert "same Wi-Fi only" not in output


def test_setup_preserves_https_url_and_port(config, monkeypatch, capsys):
    monkeypatch.setattr(cli, "_running", lambda: None)
    assert cli.cmd_setup(argparse.Namespace(port=9000, public_url="https://winglet.example.com/")) == 0
    assert cli.public_url() == "https://winglet.example.com"
    assert cli._port() == 9000
    assert "HTTPS: not configured" not in capsys.readouterr().out


def test_setup_failure_does_not_enable_or_change_settings(config, monkeypatch, capsys):
    config.update(WINGLET_PORT="8787", WINGLET_PUBLIC_URL="https://old.example.com")
    original = config.copy()
    def fail(*, install=False):
        assert install is True
        return False
    monkeypatch.setattr(cli, "ensure_ready", fail)
    assert cli.cmd_setup(argparse.Namespace(port=9000, public_url="https://new.example.com")) == 1
    assert config == original
    assert "enabled for this profile" not in capsys.readouterr().out


def test_pair_with_missing_dependencies_does_not_create_code(monkeypatch, capsys):
    monkeypatch.setattr(cli, "_running", lambda: {"app": "winglet", "server_id": "s1"})
    monkeypatch.setattr(cli, "ensure_ready", lambda: False)
    module = ModuleType("plugin.adapter")
    module.open_store = lambda: pytest.fail("No code should be created without QR support")
    monkeypatch.setitem(sys.modules, "plugin.adapter", module)
    assert cli.cmd_pair(argparse.Namespace(public_url=None)) == 1
    assert "Link:" not in capsys.readouterr().out


def test_pair_prints_actual_qr_link_and_redeemable_code(config, monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(cli, "_running", lambda: {"app": "winglet", "server_id": "s1"})
    module = ModuleType("plugin.adapter")
    path = tmp_path / "qr.db"
    module.open_store = lambda: Store(path)
    monkeypatch.setitem(sys.modules, "plugin.adapter", module)
    assert cli.cmd_pair(argparse.Namespace(public_url="https://winglet.example.com")) == 0
    output = capsys.readouterr().out
    assert "█" in output or "▀" in output or "▄" in output
    assert "install `qrcode`" not in output
    link = next(line.split("Link:", 1)[1].strip() for line in output.splitlines() if "Link:" in line)
    code = link.split("#pair=", 1)[1].split("&")[0]
    assert code and f"Code:  {code[:4]}-{code[4:]}" in output
    store = Store(path)
    try:
        assert store.redeem_pair_code(code)
    finally:
        store.close()


@pytest.mark.parametrize("host, expected", [("", "127.0.0.1"), ("0.0.0.0", "127.0.0.1"),
    (" 100.64.0.5 ", "100.64.0.5"), ("::", "[::1]"), ("fd7a:115c:a1e0::5", "[fd7a:115c:a1e0::5]"),
    ("[::1]", "[::1]")])
def test_probe_uses_configured_host_including_ipv6(config, host, expected):
    config.update(WINGLET_HOST=host, WINGLET_PORT="9000")
    assert cli._probe_url() == f"http://{expected}:9000/api/info"


def test_probe_honors_yaml_listener_and_env_overrides(config, monkeypatch):
    module = sys.modules["hermes_cli.config"]
    monkeypatch.setattr(module, "load_config_readonly", lambda: {
        "platforms": {"winglet": {"extra": {"host": "100.64.0.5", "port": 9000}}}}, raising=False)
    assert cli._probe_url() == "http://100.64.0.5:9000/api/info"
    config.update(WINGLET_HOST="127.0.0.1", WINGLET_PORT="9001")
    assert cli._probe_url() == "http://127.0.0.1:9001/api/info"


def test_direct_pairing_url_honors_yaml_with_env_override(config, monkeypatch):
    monkeypatch.setattr(sys.modules["hermes_cli.config"], "load_config_readonly", lambda: {
        "platforms": {"winglet": {"extra": {"public_url": "https://configured.example"}}}}, raising=False)
    assert cli.public_url() == "https://configured.example"
    config["WINGLET_PUBLIC_URL"] = "https://override.example"
    assert cli.public_url() == "https://override.example"


def automatic_setup(config, monkeypatch, tmp_path):
    from plugin import tunnel
    module = ModuleType("plugin.adapter")
    module.data_dir = lambda: tmp_path
    module.open_store = lambda: Store(tmp_path / "data.db")
    monkeypatch.setitem(sys.modules, "plugin.adapter", module)
    monkeypatch.setattr(tunnel, "install", lambda path: tmp_path / "cloudflared")
    return tunnel


def test_default_setup_prepares_tunnel_starts_gateway_and_prints_verified_qr(config, monkeypatch, tmp_path):
    automatic_setup(config, monkeypatch, tmp_path)
    started, links = [], []
    ready = {"app": "winglet", "server_id": "s", "connection": {"mode": "quick", "url": "https://ready.trycloudflare.com"}}
    monkeypatch.setattr(cli, "_running", lambda: ready if started else None)
    monkeypatch.setattr(cli, "_start_gateway", lambda: started.append(True))
    monkeypatch.setattr(cli, "_verify_public", lambda url, identity: url == ready["connection"]["url"] and identity == "s")
    monkeypatch.setattr(cli, "_print_qr", links.append)
    assert cli.cmd_setup(argparse.Namespace(port=None, public_url=None)) == 0
    assert config["WINGLET_CONNECTION"] == "quick" and config["WINGLET_ENABLED"] == "true"
    assert started == [True] and links[0].startswith("https://ready.trycloudflare.com/#pair=")


def test_tunnel_install_failure_does_not_change_configuration(config, monkeypatch, tmp_path):
    tunnel = automatic_setup(config, monkeypatch, tmp_path)
    def failure(path):
        raise RuntimeError("checksum failure")
    monkeypatch.setattr(tunnel, "install", failure)
    config["WINGLET_PUBLIC_URL"] = "http://old"
    old = config.copy()
    assert cli.cmd_setup(argparse.Namespace(port=None, public_url=None)) == 1
    assert config == old


def test_setup_timeout_creates_no_code_and_reports_failed_https(config, monkeypatch, tmp_path, capsys):
    automatic_setup(config, monkeypatch, tmp_path)
    monkeypatch.setattr(cli, "_running", lambda: None)
    monkeypatch.setattr(cli, "_start_gateway", lambda: None)
    monkeypatch.setattr(cli, "_wait_for_quick", lambda: None)
    monkeypatch.setattr(cli, "_print_qr", lambda _: pytest.fail("No QR on failed HTTPS"))
    assert cli.cmd_setup(argparse.Namespace(port=None, public_url=None)) == 1
    assert "No pairing code was created" in capsys.readouterr().out


def test_quick_pair_does_not_fall_back_to_stale_http_or_create_code(config, monkeypatch, tmp_path):
    automatic_setup(config, monkeypatch, tmp_path)
    config.update(WINGLET_CONNECTION="quick", WINGLET_PUBLIC_URL="http://old:8787")
    monkeypatch.setattr(cli, "_running", lambda: {"app": "winglet", "server_id": "s", "connection": {"mode": "quick", "url": None}})
    assert cli.public_url() == ""
    assert cli.cmd_pair(argparse.Namespace(public_url=None)) == 1
    assert not (tmp_path / "data.db").exists()


def test_no_start_setup_and_existing_https_endpoint_are_preserved(config, monkeypatch, tmp_path):
    automatic_setup(config, monkeypatch, tmp_path)
    monkeypatch.setattr(cli, "_running", lambda: None)
    monkeypatch.setattr(cli, "_start_gateway", lambda: pytest.fail("Must not start"))
    assert cli.cmd_setup(argparse.Namespace(port=None, public_url=None, no_start=True)) == 0
    assert config["WINGLET_CONNECTION"] == "quick"
    config.update(WINGLET_CONNECTION="direct", WINGLET_PUBLIC_URL="https://existing.example.com")
    assert cli.cmd_setup(argparse.Namespace(port=None, public_url=None)) == 0
    assert config["WINGLET_CONNECTION"] == "direct"


@pytest.mark.parametrize("address", [None, "http://192.168.1.20:9000"])
def test_legacy_paired_setup_keeps_direct_route_and_device_token(config, monkeypatch, tmp_path, capsys, address):
    tunnel = automatic_setup(config, monkeypatch, tmp_path)
    config.update(WINGLET_HOST="0.0.0.0", WINGLET_PORT="9000")
    if address:
        config["WINGLET_PUBLIC_URL"] = address
    original = config.copy()
    store = Store(tmp_path / "data.db")
    try:
        device, token = store.add_device("Existing phone", "android")
        monkeypatch.setattr(tunnel, "install", lambda _: pytest.fail("Do not download a tunnel for paired LAN users"))
        monkeypatch.setattr(cli, "_start_gateway", lambda: pytest.fail("Do not change the running route"))
        monkeypatch.setattr(cli, "_running", lambda: {"app": "winglet", "server_id": "s1"})
        links = []
        monkeypatch.setattr(cli, "_print_qr", links.append)
        assert cli.cmd_setup(argparse.Namespace(port=None, public_url=None)) == 0
        assert config == {**original, "WINGLET_CONNECTION": "direct", "WINGLET_ENABLED": "true"}
        output = capsys.readouterr().out
        assert "Keeping your existing direct connection" in output
        assert "--connection quick" in output and "re-pair existing phones" in output
        assert "Traffic passes through Cloudflare" not in output
        assert cli.cmd_pair(argparse.Namespace(public_url=None)) == 0
        expected = address or "http://173.249.54.31:9000"
        assert links[0].startswith(expected + "/#pair=")
        assert store.device_for_token(token)["id"] == device["id"]
    finally:
        store.close()


@pytest.mark.parametrize("source", ["env", "yaml"])
@pytest.mark.parametrize("mode", ["direct", "quick"])
def test_setup_preserves_saved_mode_even_with_no_phones(config, monkeypatch, tmp_path, source, mode):
    tunnel = automatic_setup(config, monkeypatch, tmp_path)
    if source == "env":
        config["WINGLET_CONNECTION"] = mode
    else:
        monkeypatch.setattr(sys.modules["hermes_cli.config"], "load_config_readonly", lambda: {
            "platforms": {"winglet": {"extra": {"connection": mode}}}}, raising=False)
    if mode == "direct":
        monkeypatch.setattr(tunnel, "install", lambda _: pytest.fail("Saved direct mode must survive setup"))
    monkeypatch.setattr(cli, "_running", lambda: None)
    monkeypatch.setattr(cli, "_start_gateway", lambda: pytest.fail("--no-start must not restart"))
    assert cli.cmd_setup(argparse.Namespace(port=None, public_url=None, no_start=True)) == 0
    assert config["WINGLET_CONNECTION"] == mode


def test_explicit_quick_can_switch_paired_legacy_install_and_discloses_privacy(config, monkeypatch, tmp_path, capsys):
    tunnel = automatic_setup(config, monkeypatch, tmp_path)
    store = Store(tmp_path / "data.db")
    store.add_device("Existing phone", "android")
    store.close()
    def install(_):
        # The disclosure must appear before starting/downloading the third-party client.
        assert "Traffic passes through Cloudflare, which can read it" in capsys.readouterr().out
        return tmp_path / "cloudflared"
    monkeypatch.setattr(tunnel, "install", install)
    monkeypatch.setattr(cli, "_running", lambda: None)
    assert cli.cmd_setup(argparse.Namespace(port=None, public_url=None, connection="quick", no_start=True)) == 0
    assert config["WINGLET_CONNECTION"] == "quick"


def test_unreadable_device_store_does_not_change_connection_settings(config, monkeypatch, tmp_path, capsys):
    tunnel = automatic_setup(config, monkeypatch, tmp_path)
    config["WINGLET_PUBLIC_URL"] = "http://192.168.1.20:8787"
    original = config.copy()
    def fail():
        raise OSError("device store unavailable")
    monkeypatch.setattr(sys.modules["plugin.adapter"], "open_store", fail)
    monkeypatch.setattr(tunnel, "install", lambda _: pytest.fail("Never assume an unreadable store is fresh"))
    assert cli.cmd_setup(argparse.Namespace(port=None, public_url=None)) == 1
    assert config == original
    assert "Connection settings were not changed" in capsys.readouterr().out


@pytest.mark.parametrize("profile", ["named", "default"])
def test_restart_launcher_preserves_active_profile_and_is_hidden(config, monkeypatch, tmp_path, profile):
    automatic_setup(config, monkeypatch, tmp_path)
    constants = ModuleType("hermes_constants")
    constants.get_hermes_home = lambda: tmp_path / "profiles" / profile if profile != "default" else tmp_path
    monkeypatch.setitem(sys.modules, "hermes_constants", constants)
    sys.modules["hermes_cli.config"].__file__ = str(tmp_path / "hermes-source" / "hermes_cli" / "config.py")
    calls = []
    monkeypatch.setattr(cli.subprocess, "Popen", lambda argv, **kwargs: calls.append((argv, kwargs)))
    cli._start_gateway()
    argv, options = calls[0]
    assert argv == [sys.executable, "-m", "hermes_cli.main", "-p", profile, "gateway", "restart"]
    assert options["env"]["HERMES_HOME"] == str(constants.get_hermes_home())
    assert options["env"]["PYTHONPATH"].startswith(str(tmp_path / "hermes-source"))
    if cli.os.name == "nt":
        assert options["creationflags"] & cli.subprocess.CREATE_NO_WINDOW


@pytest.mark.parametrize("source", ["env", "yaml"])
async def test_pair_with_real_hub_bound_only_to_specific_address(config, monkeypatch, tmp_path, aiohttp_server, source):
    import asyncio
    from plugin.hub import Hub

    path = tmp_path / "bound.db"
    store = Store(path)
    try:
        server = await aiohttp_server(Hub(store).build_app(), host="127.0.0.2")
        if source == "env":
            config.update(WINGLET_HOST="127.0.0.2", WINGLET_PORT=str(server.port))
        else:
            monkeypatch.setattr(sys.modules["hermes_cli.config"], "load_config_readonly", lambda: {
                "platforms": {"winglet": {"extra": {"host": "127.0.0.2", "port": server.port}}}}, raising=False)
        # Deliberately poison the ambient proxy: a local bind check must stay local.
        monkeypatch.setenv("http_proxy", "http://127.0.0.1:1")
        monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:1")
        monkeypatch.setenv("no_proxy", "")
        monkeypatch.setenv("NO_PROXY", "")
        module = ModuleType("plugin.adapter")
        module.open_store = lambda: Store(path)
        monkeypatch.setitem(sys.modules, "plugin.adapter", module)
        links = []
        monkeypatch.setattr(cli, "_print_qr", links.append)
        assert await asyncio.to_thread(cli.cmd_pair, argparse.Namespace(public_url="https://winglet.example.com")) == 0
        assert store.redeem_pair_code(links[0].split("#pair=")[1].split("&")[0])
    finally:
        store.close()
