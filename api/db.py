"""SQLite schema, connection helpers and scope-aware query helpers.

Every query that returns user-visible rows goes through `scope_sql()` so the
country AND department filter is part of the SQL itself (never applied after
fetching).
All SQL is parameterised.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

API_DIR = Path(__file__).resolve().parent
REPO_ROOT = API_DIR.parent

COUNTRIES = ("BE", "NL", "FR", "DE", "ALL")
DEPARTMENTS = ("payroll", "hr", "finance")
SOURCES = ("upload", "email", "google-drive", "sharepoint", "git", "teams")
# Bump when the schema changes: an older database file is moved aside and re-seeded on start.
SCHEMA_VERSION = 2
LEVEL_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def db_path() -> Path:
    return Path(os.environ.get("VERITY_DB", str(REPO_ROOT / "data" / "verity.db")))


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('consultant','owner','admin')),
  countries_csv TEXT NOT NULL,
  departments_csv TEXT NOT NULL DEFAULT 'payroll',
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id),
  title TEXT NOT NULL,
  country TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT 'payroll',
  owner TEXT,
  status TEXT NOT NULL CHECK (status IN ('live','blocked','superseded','rejected')),
  version INTEGER NOT NULL,
  content_md TEXT NOT NULL,
  effective_date TEXT,
  review_by TEXT,
  updated_by TEXT,
  updated_at TEXT,
  change_summary TEXT,
  supersedes_id TEXT,
  uploaded_by TEXT,
  source TEXT NOT NULL DEFAULT 'upload',
  source_detail TEXT NOT NULL DEFAULT '',
  sha256 TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_topic_country ON documents(topic_id, country, status);
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id TEXT NOT NULL REFERENCES documents(id),
  topic_id TEXT NOT NULL,
  country TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_doc ON claims(document_id);
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  other_document_id TEXT,
  rule TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  new_value TEXT,
  existing_value TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','resolved')),
  created_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TEXT,
  resolution TEXT,
  resolution_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_issues_doc ON issues(document_id, status);
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  document_id TEXT,
  document_version INTEGER,
  payload_sha256 TEXT NOT NULL,
  signature_b64 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  country TEXT,
  department TEXT
);
"""


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


def schema_version(path: Path) -> int | None:
    """user_version of an existing database file (None if it has no tables yet)."""
    conn = sqlite3.connect(str(path), timeout=10)
    try:
        has_tables = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").fetchone()
        if not has_tables:
            return None
        return int(conn.execute("PRAGMA user_version").fetchone()[0])
    finally:
        conn.close()


def _allowed_countries(user: dict) -> list[str]:
    allowed = [c for c in user.get("countries", []) if c in COUNTRIES]
    if "ALL" not in allowed:
        allowed.append("ALL")
    return allowed


def _allowed_departments(user: dict) -> list[str]:
    # An empty list must match nothing: '' is never a stored department.
    return [d for d in user.get("departments", []) if d in DEPARTMENTS] or [""]


def scope_sql(user: dict, alias: str = "d") -> tuple[str, list[str]]:
    """SQL fragment restricting `alias` rows to the user's scope:
    country in the user's countries (or ALL) AND department in the user's departments."""
    countries, departments = _allowed_countries(user), _allowed_departments(user)
    clause = (
        f"({alias}.country IN ({','.join('?' for _ in countries)}) "
        f"AND {alias}.department IN ({','.join('?' for _ in departments)}))"
    )
    return clause, [*countries, *departments]


def audit_scope_sql(user: dict, alias: str = "a") -> tuple[str, list[str]]:
    """Like scope_sql, but audit rows without a country/department (logins, chats) stay visible."""
    countries, departments = _allowed_countries(user), _allowed_departments(user)
    clause = (
        f"(({alias}.country IS NULL OR {alias}.country IN ({','.join('?' for _ in countries)})) "
        f"AND ({alias}.department IS NULL OR {alias}.department IN ({','.join('?' for _ in departments)})))"
    )
    return clause, [*countries, *departments]


def audit(conn: sqlite3.Connection, username: str, action: str, target: str | None,
          country: str | None = None, department: str | None = None) -> None:
    conn.execute(
        "INSERT INTO audit_log (at, username, action, target, country, department) VALUES (?,?,?,?,?,?)",
        (iso(now_utc()), username, action, target, country, department),
    )
