import asyncio

import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from plugin import webpush
from plugin.hub import HOME_CHAT_ID, Hub
from plugin.store import Store, normalize_code


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path / "data.db")
    yield s
    s.close()


class FakeResponse:
    def __init__(self, status=201):
        self.status_code = status


class FakeHTTP:
    def __init__(self):
        self.posts = []

    async def post(self, url, **kwargs):
        self.posts.append((url, kwargs))
        return FakeResponse()

    async def aclose(self):
        pass


@pytest.fixture
def hub(store, tmp_path):
    return Hub(store, web_root=tmp_path / "web", http_client=FakeHTTP(),
               bot_info=lambda: {"name": "hermes", "title": "Hermes"})


@pytest.fixture
async def client(aiohttp_client, hub):
    return await aiohttp_client(hub.build_app())


async def pair(client, hub, name="Pixel"):
    code = hub.store.create_pair_code()
    resp = await client.post("/api/pair", json={"code": code, "device_name": name, "platform": "android"})
    assert resp.status == 200
    return (await resp.json())["token"]


# -- store -------------------------------------------------------------------------------


def test_pair_code_single_use_and_normalized(store):
    code = store.create_pair_code()
    messy = f"{code[:4].lower()}-{code[4:]}"
    assert normalize_code(messy) == code
    assert store.redeem_pair_code(messy)
    assert not store.redeem_pair_code(code)


def test_pair_code_expires(store):
    code = store.create_pair_code(ttl=-1)
    assert not store.redeem_pair_code(code)


def test_device_tokens_are_hashed(store):
    device, token = store.add_device("Phone")
    assert store.device_for_token(token)["id"] == device["id"]
    raw = store._one("SELECT token_hash FROM devices")["token_hash"]
    assert token not in raw
    assert store.device_for_token("nope") is None


def test_inbox_resolves_once(store):
    item = store.add_inbox("approval", "general", "Approval needed", "rm -rf /tmp/x", {"choices": ["once"]})
    assert store.pending_count() == 1
    assert store.resolve_inbox(item["id"], "resolved", "once")["status"] == "resolved"
    assert store.resolve_inbox(item["id"], "resolved", "once") is None
    assert store.pending_count() == 0


# -- web push crypto -----------------------------------------------------------------------


def test_webpush_roundtrip():
    ua_key = ec.generate_private_key(ec.SECP256R1())
    p256dh = webpush.b64url_encode(webpush._public_bytes(ua_key.public_key()))
    auth = webpush.b64url_encode(b"0123456789abcdef")
    body = webpush.encrypt(b'{"hello":"world"}', p256dh, auth)
    assert webpush.decrypt(body, ua_key, auth) == b'{"hello":"world"}'


def test_vapid_header_shape():
    pem = webpush.generate_vapid_private_key()
    header = webpush.vapid_authorization("https://web.push.apple.com/abc", pem, "https://example.com")
    assert header.startswith("vapid t=") and f"k={webpush.vapid_public_key(pem)}" in header
    token = header.split("t=")[1].split(",")[0]
    assert token.count(".") == 2
    assert len(webpush.b64url_decode(webpush.vapid_public_key(pem))) == 65


def test_webpush_decrypts_with_reference_library():
    http_ece = pytest.importorskip("http_ece")
    ua_key = ec.generate_private_key(ec.SECP256R1())
    p256dh = webpush.b64url_encode(webpush._public_bytes(ua_key.public_key()))
    auth_secret = b"fedcba9876543210"
    body = webpush.encrypt(b"reference check", p256dh, webpush.b64url_encode(auth_secret))
    assert http_ece.decrypt(body, private_key=ua_key, auth_secret=auth_secret, version="aes128gcm") == b"reference check"


# -- HTTP API --------------------------------------------------------------------------------


async def test_info_is_public(client):
    resp = await client.get("/api/info")
    data = await resp.json()
    assert data["app"] == "winglet" and data["bot"]["title"] == "Hermes"


async def test_pairing_flow(client, hub):
    resp = await client.post("/api/pair", json={"code": "WRONG123"})
    assert resp.status == 403
    token = await pair(client, hub)
    resp = await client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    assert (await resp.json())["device"]["name"] == "Pixel"
    resp = await client.get("/api/chats")
    assert resp.status == 401


async def test_message_reaches_hermes_and_reply_streams(client, hub):
    received = []

    async def on_user_message(chat, text, device, message):
        received.append((chat["id"], text, device["name"]))

    hub.on_user_message = on_user_message
    token = await pair(client, hub)
    ws = await client.ws_connect(f"/api/ws?token={token}")
    hello = await ws.receive_json()
    assert hello["type"] == "hello" and any(c["id"] == HOME_CHAT_ID for c in hello["chats"])

    await ws.send_json({"type": "message.send", "chat_id": "general", "text": "hi there", "client_id": "c1"})
    new = await ws.receive_json()
    assert new["type"] == "message.new" and new["message"]["role"] == "user"
    assert new["message"]["meta"]["client_id"] == "c1"
    assert (await ws.receive_json())["type"] == "chat.update"
    for _ in range(20):
        if received:
            break
        await asyncio.sleep(0.01)
    assert received == [("general", "hi there", "Pixel")]

    msg = await hub.post_message("general", "Hel")
    assert (await ws.receive_json())["message"]["text"] == "Hel"
    await ws.receive_json()  # chat.update
    await hub.edit_message(msg["id"], "Hello!", final=True)
    update = await ws.receive_json()
    assert update["type"] == "message.update" and update["message"]["text"] == "Hello!"
    assert update["message"]["status"] == "final"

    resp = await client.get("/api/chats/general/messages", headers={"Authorization": f"Bearer {token}"})
    texts = [m["text"] for m in (await resp.json())["messages"]]
    assert texts == ["hi there", "Hello!"]
    await ws.close()


async def test_approval_roundtrip_and_signed_action(client, hub):
    decisions = []

    async def on_approval(item, choice):
        decisions.append(choice)
        return True

    hub.on_approval = on_approval
    token = await pair(client, hub)
    item = await hub.add_inbox("approval", "general", "Approval needed", "rm -rf build",
                               {"choices": ["once", "session", "deny"], "session_key": "k"}, push=False)
    auth = {"Authorization": f"Bearer {token}"}
    resp = await client.post(f"/api/inbox/{item['id']}/respond", json={"choice": "always"}, headers=auth)
    assert resp.status == 409  # not an offered choice
    resp = await client.post(f"/api/inbox/{item['id']}/respond", json={"choice": "once"}, headers=auth)
    assert (await resp.json())["item"]["resolution"] == "once"
    assert decisions == ["once"]

    item2 = await hub.add_inbox("approval", "general", "Approval needed", "ls",
                                {"choices": ["once", "deny"], "session_key": "k"}, push=False)
    bad = await client.post(f"/api/inbox/{item2['id']}/respond?choice=once&sig=bad")
    assert bad.status == 401
    sig = hub.action_signature(item2["id"], "deny")
    ok = await client.post(f"/api/inbox/{item2['id']}/respond?choice=deny&sig={sig}")
    assert ok.status == 200 and decisions == ["once", "deny"]


async def test_question_answer(client, hub):
    answers = []

    async def on_answer(item, text):
        answers.append(text)
        return True

    hub.on_answer = on_answer
    token = await pair(client, hub)
    item = await hub.add_inbox("question", "general", "Question", "Which color?",
                               {"choices": ["red", "blue"], "clarify_id": "q1"}, push=False)
    resp = await client.post(f"/api/inbox/{item['id']}/respond", json={"answer": "green"},
                             headers={"Authorization": f"Bearer {token}"})
    assert resp.status == 200 and answers == ["green"]


async def test_webpush_subscription_and_delivery(client, hub):
    token = await pair(client, hub)
    auth = {"Authorization": f"Bearer {token}"}
    vapid = await (await client.get("/api/push/vapid")).json()
    assert len(webpush.b64url_decode(vapid["public_key"])) == 65

    ua_key = ec.generate_private_key(ec.SECP256R1())
    sub = {"endpoint": "https://push.example/abc",
           "keys": {"p256dh": webpush.b64url_encode(webpush._public_bytes(ua_key.public_key())),
                    "auth": webpush.b64url_encode(b"0123456789abcdef")}}
    resp = await client.post("/api/push/webpush", json={"subscription": sub}, headers=auth)
    assert resp.status == 200

    await hub.add_inbox("approval", "general", "Approval needed", "rm -rf build",
                        {"choices": ["once", "deny"], "session_key": "k", "labels": {"once": "Allow once"}})
    url, kwargs = hub._http.posts[-1]
    assert url == sub["endpoint"] and kwargs["headers"]["Urgency"] == "high"
    import json
    note = json.loads(webpush.decrypt(kwargs["content"], ua_key, sub["keys"]["auth"]))
    assert note["kind"] == "approval" and note["actions"][0]["title"] == "Allow once"


async def test_bot_reply_pushes_only_when_app_is_closed(client, hub, monkeypatch):
    monkeypatch.setattr("plugin.hub.PUSH_DEBOUNCE_SECONDS", 0.05)
    token = await pair(client, hub)
    hub.store.add_push_sub("dev", "ntfy", "https://ntfy.sh/t", {"server": "https://ntfy.sh", "topic": "t"})
    ws = await client.ws_connect(f"/api/ws?token={token}")
    await ws.receive_json()
    await hub.post_message("general", "while open")
    await asyncio.sleep(0.5)
    assert hub._http.posts == []
    await ws.close()
    await asyncio.sleep(0.05)
    await hub.post_message("general", "while closed")
    await asyncio.sleep(0.5)
    assert len(hub._http.posts) == 1
    payload = hub._http.posts[0][1]["json"]
    assert payload["topic"] == "t" and "while closed" not in payload["message"]  # generic text only


async def test_static_serving_and_spa_fallback(client, hub):
    root = hub.web_root
    root.mkdir()
    (root / "index.html").write_text("<html>shell</html>")
    (root / "sw.js").write_text("self.x=1")
    assert "shell" in await (await client.get("/")).text()
    assert "shell" in await (await client.get("/chat/general")).text()
    assert "self.x" in await (await client.get("/sw.js")).text()
    resp = await client.get("/../../etc/passwd")
    assert "root:" not in await resp.text()
    assert (await client.get("/api/nope")).status == 404


async def test_media_links_are_signed_and_need_no_token(client, hub, tmp_path):
    token = await pair(client, hub)
    f = tmp_path / "chart.png"
    f.write_bytes(b"\x89PNG fake")
    attachment = hub.add_media(str(f))
    assert attachment["kind"] == "image" and "sig=" in attachment["url"] and token not in attachment["url"]
    resp = await client.get(attachment["url"])
    assert resp.status == 200 and await resp.read() == b"\x89PNG fake"
    assert resp.headers["Content-Disposition"].startswith("inline")
    unsigned = attachment["url"].split("?")[0]
    assert (await client.get(unsigned)).status == 401
    assert (await client.get(unsigned + "?sig=forged")).status == 401
    assert (await client.get(f"{unsigned}?token={token}")).status == 200  # legacy links


async def test_active_documents_are_served_inert(client, hub, tmp_path):
    for name in ("report.html", "logo.svg"):
        f = tmp_path / name
        f.write_text("<script>localStorage.getItem('winglet.servers')</script>")
        attachment = hub.add_media(str(f))
        assert attachment["kind"] == "file"
        resp = await client.get(attachment["url"])
        assert resp.status == 200
        assert resp.headers["Content-Disposition"].startswith("attachment")
        assert resp.headers["Content-Type"] == "application/octet-stream"
        assert "sandbox" in resp.headers["Content-Security-Policy"]
        assert resp.headers["X-Content-Type-Options"] == "nosniff"


async def test_turn_end_finalizes_stale_streaming_messages(hub):
    msg = await hub.post_message("general", "💻 Running ls", status="streaming")
    await hub.set_typing("general", True)
    await hub.set_typing("general", False)
    assert hub.store.get_message(msg["id"])["status"] == "final"


async def test_routine_results_do_not_count_as_needing_you(hub):
    await hub.add_inbox("result", "general", "Routine finished", "All good", {}, push=False)
    assert hub.store.pending_count() == 0
    assert hub.store.list_inbox()[0]["kind"] == "result"


async def test_pairing_is_rate_limited(client, hub):
    for _ in range(10):
        assert (await client.post("/api/pair", json={"code": "NOPE0000"})).status == 403
    assert (await client.post("/api/pair", json={"code": hub.store.create_pair_code()})).status == 429


async def test_unpair_from_another_process_cuts_off_open_socket(client, hub, monkeypatch):
    monkeypatch.setattr("plugin.hub.ALIVE_CACHE_SECONDS", 0)
    received = []

    async def on_user_message(chat, text, device, message):
        received.append(text)

    hub.on_user_message = on_user_message
    token = await pair(client, hub)
    ws = await client.ws_connect(f"/api/ws?token={token}")
    hello = await ws.receive_json()
    hub.store.remove_device(hello["device"]["id"])  # what `hermes winglet unpair` does
    await ws.send_json({"type": "message.send", "chat_id": "general", "text": "still here?"})
    msg = await ws.receive()
    assert msg.type.name in ("CLOSE", "CLOSED", "CLOSING")
    assert received == []


async def test_revoked_socket_gets_no_broadcasts(client, hub, monkeypatch):
    monkeypatch.setattr("plugin.hub.ALIVE_CACHE_SECONDS", 0)
    token = await pair(client, hub)
    ws = await client.ws_connect(f"/api/ws?token={token}")
    hello = await ws.receive_json()
    hub.store.remove_device(hello["device"]["id"])
    await hub.post_message("general", "secret reply", push=False)
    msg = await ws.receive()
    assert msg.type.name in ("CLOSE", "CLOSED", "CLOSING")


async def test_unpairing_voids_notification_action_links(client, hub):
    token = await pair(client, hub)
    item = await hub.add_inbox("approval", "general", "Approval needed", "ls",
                               {"choices": ["once", "deny"], "session_key": "k"}, push=False)
    old_sig = hub.action_signature(item["id"], "once")
    device = (await (await client.get("/api/me", headers={"Authorization": f"Bearer {token}"})).json())["device"]
    hub.store.remove_device(device["id"])
    resp = await client.post(f"/api/inbox/{item['id']}/respond?choice=once&sig={old_sig}")
    assert resp.status == 401


async def test_missing_static_asset_is_404_not_the_app_shell(client, hub):
    root = hub.web_root
    root.mkdir()
    (root / "index.html").write_text("<html>shell</html>")
    resp = await client.get("/assets/node_modules/font.ttf")
    assert resp.status == 404 and "immutable" not in resp.headers.get("Cache-Control", "")
    resp = await client.get("/_expo/static/js/web/gone.js")
    assert resp.status == 404
    assert "shell" in await (await client.get("/inbox")).text()


async def test_retried_send_is_not_run_twice(client, hub):
    calls = []

    async def on_user_message(chat, text, device, message):
        calls.append(text)

    hub.on_user_message = on_user_message
    token = await pair(client, hub)
    auth = {"Authorization": f"Bearer {token}"}
    body = {"text": "deploy it", "client_id": "c-123"}
    first = await (await client.post("/api/chats/general/messages", json=body, headers=auth)).json()
    again = await (await client.post("/api/chats/general/messages", json=body, headers=auth)).json()
    assert first["message"]["id"] == again["message"]["id"]
    assert calls == ["deploy it"]
