"""Ed25519 keypair management + signature helpers for Verity answer receipts
(adapted from Postura's evidence-pack signing).

Keypair lives at ./data/keys/ed25519.pem (relative to the repo root) or at
env VERITY_KEY_PATH. Generated on first start with 0600 perms; the public key
is derived on read. Never commit the key.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

log = logging.getLogger("verity.crypto")

_REPO_ROOT = Path(__file__).resolve().parent.parent

_lock = threading.Lock()
_cached: tuple[Path, Ed25519PrivateKey, Ed25519PublicKey] | None = None


def key_path() -> Path:
    return Path(os.environ.get("VERITY_KEY_PATH", str(_REPO_ROOT / "data" / "keys" / "ed25519.pem")))


def load_or_create_keypair() -> tuple[Ed25519PrivateKey, Ed25519PublicKey]:
    global _cached
    target = key_path()
    with _lock:
        if _cached is not None and _cached[0] == target:
            return _cached[1], _cached[2]
        if target.exists():
            private = serialization.load_pem_private_key(target.read_bytes(), password=None)
            if not isinstance(private, Ed25519PrivateKey):
                raise RuntimeError(f"{target} is not an Ed25519 private key")
            log.info("loaded signing key from %s", target)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            private = Ed25519PrivateKey.generate()
            pem = private.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
            fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(pem)
            log.info("generated new signing key at %s", target)
        public = private.public_key()
        _cached = (target, private, public)
        return private, public


def public_key_b64() -> str:
    _, public = load_or_create_keypair()
    raw = public.public_bytes(encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw)
    return base64.b64encode(raw).decode("ascii")


def canonical_json(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sign(payload: bytes) -> str:
    private, _ = load_or_create_keypair()
    return base64.b64encode(private.sign(payload)).decode("ascii")


def verify(payload: bytes, signature_b64: str) -> bool:
    _, public = load_or_create_keypair()
    try:
        public.verify(base64.b64decode(signature_b64), payload)
        return True
    except Exception:  # noqa: BLE001
        return False


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
