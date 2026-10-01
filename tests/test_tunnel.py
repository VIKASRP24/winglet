import asyncio
import hashlib
import io
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from plugin import tunnel


@pytest.mark.parametrize("host, expected", [("0.0.0.0", "127.0.0.1"), ("::", "[::1]"),
    ("[::1]", "[::1]"), ("100.64.0.2", "100.64.0.2"), ("fd00::1", "[fd00::1]")])
def test_origin_uses_actual_bind(host, expected):
    assert tunnel.origin_url(host, 8787) == f"http://{expected}:8787"


@pytest.mark.parametrize("system, machine, name", [("Windows", "AMD64", "cloudflared-windows-amd64.exe"),
    ("Windows", "x86", "cloudflared-windows-386.exe"), ("Linux", "aarch64", "cloudflared-linux-arm64"),
    ("Darwin", "arm64", "cloudflared-darwin-arm64.tgz")])
def test_official_platform_asset(monkeypatch, system, machine, name):
    monkeypatch.setattr(tunnel.platform, "system", lambda: system)
    monkeypatch.setattr(tunnel.platform, "machine", lambda: machine)
    asset, digest = tunnel.asset()
    assert asset == name and len(digest) == 64


def test_unsupported_platform_fails_before_download(monkeypatch):
    monkeypatch.setattr(tunnel.platform, "system", lambda: "Windows")
    monkeypatch.setattr(tunnel.platform, "machine", lambda: "ARM64")
    with pytest.raises(RuntimeError, match="do not support"):
        tunnel.asset()


def test_installer_verifies_download_and_reuses_untouched_binary(tmp_path, monkeypatch):
    content = b"trusted-cloudflare-binary"
    expected = hashlib.sha256(content).hexdigest()
    monkeypatch.setattr(tunnel, "asset", lambda: ("cloudflared-windows-amd64.exe", expected))
    monkeypatch.setattr(tunnel.urllib.request, "urlopen", lambda request, **kw: io.BytesIO(content))
    binary = tunnel.install(tmp_path)
    assert binary.read_bytes() == content
    modified = binary.stat().st_mtime_ns
    monkeypatch.setattr(tunnel.urllib.request, "urlopen", lambda *a, **kw: pytest.fail("must reuse verified cache"))
    assert tunnel.install(tmp_path, download=False) == binary
    assert binary.stat().st_mtime_ns == modified
    binary.write_bytes(b"tampered")
    tunnel.install(tmp_path, download=False)
    assert binary.read_bytes() == content


def test_bad_checksum_is_never_installed_or_executed(tmp_path, monkeypatch):
    monkeypatch.setattr(tunnel, "asset", lambda: ("cloudflared-windows-amd64.exe", "0" * 64))
    monkeypatch.setattr(tunnel.urllib.request, "urlopen", lambda *a, **kw: io.BytesIO(b"wrong"))
    with pytest.raises(RuntimeError, match="checksum"):
        tunnel.install(tmp_path)
    assert list((tmp_path / "cloudflared" / tunnel.VERSION).iterdir()) == []


def test_gateway_does_not_download_missing_binary(tmp_path):
    with pytest.raises(RuntimeError, match="hermes winglet setup"):
        tunnel.install(tmp_path, download=False)


@pytest.mark.parametrize("status, payload, expected", [(200, {"app": "winglet", "server_id": "s"}, True),
    (200, {"app": "winglet", "server_id": "other"}, False), (200, [], False),
    (302, {"app": "winglet", "server_id": "s"}, False), (502, {}, False)])
async def test_public_verification_identifies_own_server(monkeypatch, status, payload, expected):
    def handler(request):
        assert not request.headers.get("authorization")
        return httpx.Response(status, json=payload)
    original = httpx.AsyncClient
    monkeypatch.setattr(tunnel.httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(handler), **kw))
    assert await tunnel.verify_url("https://some-name.trycloudflare.com", "s") is expected


@pytest.mark.parametrize("url", ["http://some-name.trycloudflare.com", "https://evil.example", 
    "https://some-name.trycloudflare.com.evil.example", "https://some-name.trycloudflare.com/path"])
async def test_public_verification_rejects_untrusted_url(url):
    assert not await tunnel.verify_url(url, "s")


async def test_stop_closes_parent_pipe_and_waits_for_worker(tmp_path):
    closed = []
    async def wait():
        assert closed == [True]
        return 0
    manager = tunnel.QuickTunnel(tmp_path, "http://127.0.0.1:8787", "s", None)
    manager.process = SimpleNamespace(stdin=SimpleNamespace(close=lambda: closed.append(True)), wait=wait)
    await manager._stop_process()
    assert manager.process is None


async def test_supervisor_clears_address_and_restarts_after_exit(tmp_path, monkeypatch):
    addresses, attempts = [], []
    async def changed(url):
        addresses.append(url)
    manager = tunnel.QuickTunnel(tmp_path, "http://127.0.0.1:8787", "s", changed)
    monkeypatch.setattr(tunnel, "install", lambda *a, **kw: Path("verified-binary"))
    async def session(binary):
        attempts.append(binary)
        if len(attempts) == 1:
            await changed("https://first.trycloudflare.com")
        else:
            raise asyncio.CancelledError
    monkeypatch.setattr(manager, "_session", session)
    original_sleep = asyncio.sleep
    monkeypatch.setattr(tunnel.asyncio, "sleep", lambda delay: original_sleep(0))
    with pytest.raises(asyncio.CancelledError):
        await manager.run()
    assert len(attempts) == 2
    assert addresses == ["https://first.trycloudflare.com", None, None]
