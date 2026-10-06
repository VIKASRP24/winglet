"""The server's keys, sealed secrets, and device signatures.

- **Identity key (Ed25519).** Its fingerprint is printed in the pairing QR, so a phone that scans the
  code knows it is talking to this server even if the network in between is not trusted. It never
  changes; replacing it means pairing again.
- **Sealing key (X25519).** Phones encrypt secrets (API keys, the pairing request itself) to it. It is
  signed by the identity key, so it can be rotated without re-pairing: phones check the signature.
- **Device keys (Ed25519).** Each verified phone signs owner actions; the server checks the signature,
  the time and a one-time nonce, so a bearer token alone (say, from a proxy log) can't run them.

Formats are shared with the app (app/src/lib/crypto.ts); tests on both sides pin them.
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
from typing import Any, Dict, Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

SEAL_VERSION = b"winglet-seal-v1"
SEALING_CONTEXT = b"winglet-sealing-key-v1"
SIGNATURE_VERSION = "winglet-sig-v1"
# A sealing key that was just rotated still opens secrets for a day, for phones that sealed with it.
PREVIOUS_KEY_SECONDS = 24 * 3600
CLOCK_SKEW_SECONDS = 60

_RAW = serialization.Encoding.Raw
_RAW_PUB = serialization.PublicFormat.Raw
_RAW_PRIV = serialization.PrivateFormat.Raw
_NOENC = serialization.NoEncryption()


def b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64d(text: str) -> bytes:
    text = (text or "").strip()
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def fingerprint(identity_public: bytes) -> str:
    """Short, URL-safe and unambiguous: what the QR carries and what a phone pins."""
    return b64e(hashlib.sha256(b"winglet-fp-v1" + identity_public).digest()[:16])


class SealError(ValueError):
    """A sealed blob that can't be opened: wrong key, wrong purpose, altered, or malformed."""


class ServerKeys:
    """Keys live in the plugin's database (its file is private to the Hermes user)."""

    def __init__(self, store) -> None:
        self.store = store
        self._identity = Ed25519PrivateKey.from_private_bytes(
            b64d(store.secret("identity_key", lambda: b64e(Ed25519PrivateKey.generate().private_bytes(_RAW, _RAW_PRIV, _NOENC))))
        )

    # -- identity ------------------------------------------------------------------------

    @property
    def identity_public(self) -> bytes:
        return self._identity.public_key().public_bytes(_RAW, _RAW_PUB)

    @property
    def fingerprint(self) -> str:
        return fingerprint(self.identity_public)

    # -- sealing -------------------------------------------------------------------------

    def _sealing(self) -> X25519PrivateKey:
        raw = self.store.secret("sealing_key", lambda: b64e(X25519PrivateKey.generate().private_bytes(_RAW, _RAW_PRIV, _NOENC)))
        return X25519PrivateKey.from_private_bytes(b64d(raw))

    def _previous_sealing(self) -> Optional[X25519PrivateKey]:
        raw = self.store.get_kv("sealing_key_previous")
        if not raw:
            return None
        data = json.loads(raw)
        if time.time() - float(data.get("retired_at", 0)) > PREVIOUS_KEY_SECONDS:
            return None
        return X25519PrivateKey.from_private_bytes(b64d(data["key"]))

    def public_info(self) -> Dict[str, Any]:
        """What phones need: the identity key (to check the fingerprint) and the signed sealing key."""
        sealing = self._sealing().public_key().public_bytes(_RAW, _RAW_PUB)
        return {"v": 1, "identity": b64e(self.identity_public), "fingerprint": self.fingerprint,
                "sealing": b64e(sealing), "sealing_sig": b64e(self._identity.sign(SEALING_CONTEXT + sealing))}

    def rotate_sealing(self) -> None:
        old = self.store.get_kv("sealing_key")
        if old:
            self.store.set_kv("sealing_key_previous", json.dumps({"key": old, "retired_at": time.time()}))
        self.store.set_kv("sealing_key", b64e(X25519PrivateKey.generate().private_bytes(_RAW, _RAW_PRIV, _NOENC)))

    def unseal(self, blob: str, purpose: str, device_id: str = "") -> bytes:
        """Open a sealed blob: ephemeral X25519 public key (32) | nonce (12) | AES-256-GCM ciphertext.
        The purpose and device id are bound in as associated data, so a secret sealed for one use or
        one phone can't be replayed as another."""
        try:
            raw = b64d(blob)
        except Exception as exc:
            raise SealError("not a sealed value") from exc
        if len(raw) < 32 + 12 + 16:
            raise SealError("sealed value is too short")
        eph, nonce, ciphertext = raw[:32], raw[32:44], raw[44:]
        aad = b"|".join([SEAL_VERSION, purpose.encode(), device_id.encode()])
        for key in (self._sealing(), self._previous_sealing()):
            if key is None:
                continue
            shared = key.exchange(X25519PublicKey.from_public_bytes(eph))
            recipient = key.public_key().public_bytes(_RAW, _RAW_PUB)
            secret = HKDF(algorithm=hashes.SHA256(), length=32, salt=eph + recipient, info=SEAL_VERSION).derive(shared)
            try:
                return AESGCM(secret).decrypt(nonce, ciphertext, aad)
            except Exception:
                continue
        raise SealError("this value was sealed for a different key or purpose")

    def unseal_json(self, blob: str, purpose: str, device_id: str = "") -> Dict[str, Any]:
        data = json.loads(self.unseal(blob, purpose, device_id).decode("utf-8"))
        if not isinstance(data, dict):
            raise SealError("expected an object")
        return data


def signing_payload(method: str, path: str, body: bytes, device_id: str, timestamp: str, nonce: str) -> bytes:
    """The exact bytes a phone signs for an owner action."""
    return "\n".join([SIGNATURE_VERSION, method.upper(), path, hashlib.sha256(body).hexdigest(), device_id,
                      timestamp, nonce]).encode("utf-8")


def verify_device_signature(public_key: str, payload: bytes, signature: str) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(b64d(public_key)).verify(b64d(signature), payload)
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


def valid_public_key(value: str) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(b64d(value))
        return True
    except Exception:
        return False
