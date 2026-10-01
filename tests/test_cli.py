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
        assert store.redeem_pair_code(links[0].split("#pair=")[1])
    finally:
        store.close()


@pytest.mark.parametrize("payload", [{"app": "another-service", "server_id": "s1"}, [],
                                    {"app": "winglet"}, {"app": "winglet", "server_id": "s1"}])
def test_unrelated_service_cannot_pass_gateway_readiness(config, monkeypatch, payload):
    monkeypatch.setattr(cli.urllib.request, "urlopen",
                        lambda *args, **kwargs: io.BytesIO(json.dumps(payload).encode()))
    result = cli._running()
    assert bool(result) == (isinstance(payload, dict) and payload.get("app") == "winglet"
                            and bool(payload.get("server_id")))


@pytest.mark.parametrize("running", [None, {"app": "winglet", "server_id": "s1"}])
def test_setup_reports_readiness_without_claiming_phone_connectivity(config, monkeypatch, capsys, running):
    monkeypatch.setattr(cli, "_running", lambda: running)
    assert cli.cmd_setup(argparse.Namespace(port=None, public_url=None)) == 0
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
