"""Per-device encrypted address discovery through ntfy; never publish bearer tokens."""
import base64
import json
import secrets
import time

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def credentials(server: str) -> dict:
    if not server.startswith("https://"):
        raise ValueError("Address recovery requires an HTTPS ntfy server.")
    return {"server": server, "topic": "winglet-address-" + secrets.token_hex(16),
            "key": encode(secrets.token_bytes(32))}


def encrypt(data: dict, server_id: str, device_id: str, url: str, revision: int) -> str:
    key = base64.urlsafe_b64decode(data["key"] + "=")
    nonce = secrets.token_bytes(12)
    plaintext = json.dumps({"server_id": server_id, "device_id": device_id, "url": url,
                            "revision": revision, "issued_at": int(time.time())}, separators=(",", ":")).encode()
    aad = f"winglet.connection.v1:{server_id}:{device_id}".encode()
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, aad)
    return json.dumps({"v": 1, "nonce": encode(nonce), "ciphertext": encode(ciphertext)}, separators=(",", ":"))
