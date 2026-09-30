"""Password hashing, server-side sessions, login rate limiting, role checks."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from datetime import timedelta
from typing import Any

from fastapi import HTTPException, Request

from db import get_conn, iso, now_utc

COOKIE_NAME = "verity_session"
SESSION_TTL = timedelta(hours=8)
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}

RATE_LIMIT_ATTEMPTS = 10
RATE_LIMIT_WINDOW_S = 300


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, **_SCRYPT)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_b64, digest_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        digest = hashlib.scrypt(password.encode("utf-8"), salt=base64.b64decode(salt_b64), **_SCRYPT)
        return hmac.compare_digest(digest, base64.b64decode(digest_b64))
    except Exception:  # noqa: BLE001
        return False


# Used to spend the same time on unknown usernames (no user enumeration by timing).
_DUMMY_HASH = hash_password(secrets.token_hex(8))


class LoginRateLimiter:
    """Failed-attempt limiter: RATE_LIMIT_ATTEMPTS per RATE_LIMIT_WINDOW_S per username."""

    def __init__(self) -> None:
        self._fails: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque[float]:
        q = self._fails[key]
        while q and now - q[0] > RATE_LIMIT_WINDOW_S:
            q.popleft()
        return q

    def blocked(self, username: str) -> bool:
        with self._lock:
            return len(self._prune(username, time.monotonic())) >= RATE_LIMIT_ATTEMPTS

    def fail(self, username: str) -> None:
        with self._lock:
            self._prune(username, time.monotonic()).append(time.monotonic())

    def reset(self) -> None:
        with self._lock:
            self._fails.clear()


limiter = LoginRateLimiter()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_view(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    return {
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row["role"],
        "countries": [c for c in row["countries_csv"].split(",") if c],
        "departments": [d for d in (row["departments_csv"] or "").split(",") if d],
    }


def authenticate(conn: sqlite3.Connection, username: str, password: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if row is None:
        verify_password(password, _DUMMY_HASH)
        return None
    if not verify_password(password, row["password_hash"]):
        return None
    return user_view(row)


def create_session(conn: sqlite3.Connection, username: str) -> str:
    token = secrets.token_urlsafe(32)
    now = now_utc()
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (iso(now),))
    conn.execute(
        "INSERT INTO sessions (token_hash, username, created_at, expires_at) VALUES (?,?,?,?)",
        (_token_hash(token), username, iso(now), iso(now + SESSION_TTL)),
    )
    return token


def delete_session(conn: sqlite3.Connection, token: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


def cookie_secure() -> bool:
    return os.environ.get("COOKIE_SECURE", "0").strip().lower() in ("1", "true", "yes")


def current_user(request: Request) -> dict[str, Any]:
    """FastAPI dependency: the signed-in user or 401."""
    token = request.cookies.get(COOKIE_NAME)
    if not token or len(token) > 200:
        raise HTTPException(status_code=401, detail="Please sign in.")
    with get_conn() as conn:
        row = conn.execute(
            """SELECT u.* FROM sessions s JOIN users u ON u.username = s.username
               WHERE s.token_hash = ? AND s.expires_at > ?""",
            (_token_hash(token), iso(now_utc())),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="Your session has expired. Please sign in again.")
    return user_view(row)


def require_role(user: dict[str, Any], *roles: str) -> None:
    if user["role"] not in roles:
        raise HTTPException(status_code=403, detail="Your role is not allowed to do this.")
