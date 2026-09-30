"""Seed demo users and load seed/docs/*.md with version history.

Documents with the same topic + country + title form a version chain: the
highest version is live, older ones are superseded (linked via supersedes_id).
Seed docs are loaded without checks; afterwards the checks engine runs across
all live docs so planted problems (e.g. an unowned, outdated FAQ) show up as
open issues exactly as they would for an upload.
"""

from __future__ import annotations

import logging
import os
import sqlite3
from collections import defaultdict
from pathlib import Path

import checks
from auth import hash_password
from db import REPO_ROOT
from extract import parse_key_rules
from ingest import DocumentError, insert_document, prepare, slug

log = logging.getLogger("verity.seed")

DEMO_USERS = [
    # username, display name, role, countries, departments
    ("sofie", "Sofie Claes", "consultant", "BE", "payroll,hr"),
    ("daan", "Daan de Vries", "consultant", "NL", "payroll,hr"),
    ("lies", "Lies Vermeulen", "owner", "BE,NL,ALL", "payroll,hr"),
    ("noor", "Noor El Amrani", "owner", "BE,NL,ALL", "finance"),
    ("admin", "Admin", "admin", "BE,NL,FR,DE,ALL", "payroll,hr,finance"),
]


def seed_dir() -> Path:
    return Path(os.environ.get("VERITY_SEED_DIR", str(REPO_ROOT / "seed" / "docs")))


def seed_users(conn: sqlite3.Connection) -> None:
    password = os.environ.get("DEMO_PASSWORD") or "verity-demo"
    for username, name, role, countries, departments in DEMO_USERS:
        conn.execute(
            """INSERT OR IGNORE INTO users (username, display_name, role, countries_csv, departments_csv, password_hash)
               VALUES (?,?,?,?,?,?)""",
            (username, name, role, countries, departments, hash_password(password)),
        )


def load_docs(conn: sqlite3.Connection, directory: Path | None = None) -> int:
    directory = directory or seed_dir()
    if not directory.exists():
        log.warning("seed directory %s not found; starting with no documents", directory)
        return 0
    chains: dict[tuple[str, str, str, str], list[tuple[str, dict]]] = defaultdict(list)
    for path in sorted(directory.glob("*.md")):
        if path.name.lower() == "readme.md":
            continue
        try:
            meta = prepare(path.read_text(encoding="utf-8"), path.stem)
        except (DocumentError, UnicodeDecodeError) as e:
            log.warning("skipping seed file %s: %s", path.name, e)
            continue
        chains[(meta["topic"], meta["country"], meta["department"], meta["title"].strip().lower())].append((f"doc-{slug(path.stem, 60)}", meta))

    count = 0
    for docs in chains.values():
        docs.sort(key=lambda d: (d[1]["version"], d[1].get("updated_at") or ""))
        previous = None
        for i, (doc_id, meta) in enumerate(docs):
            status = "live" if i == len(docs) - 1 else "superseded"
            insert_document(conn, doc_id, meta, parse_key_rules(meta["body"]), status, "seed", previous)
            previous = doc_id
            count += 1
    run_checks_on_live(conn, {doc_id: meta["missing"] for docs in chains.values() for doc_id, meta in docs})
    log.info("seeded %d documents from %s", count, directory)
    return count


def run_checks_on_live(conn: sqlite3.Connection, missing_by_id: dict[str, list[str]]) -> None:
    """Check each live doc against higher-ranked live docs (highest version first),
    so each clash is reported once, on the weaker document."""
    live = [dict(r) for r in conn.execute(
        "SELECT * FROM documents WHERE status = 'live' ORDER BY version DESC, updated_at DESC, id").fetchall()]
    for d in live:
        d["claims"] = checks.load_claims(conn, d["id"])
    blocked: set[str] = set()
    for i, doc in enumerate(live):
        stronger = [
            o for o in live[:i]
            if o["id"] not in blocked
            and o["topic_id"] == doc["topic_id"]
            and o["department"] == doc["department"]
            and (o["country"] == doc["country"] or "ALL" in (o["country"], doc["country"]))
        ]
        findings = checks.evaluate(doc, doc["claims"], stronger, missing_by_id.get(doc["id"], []))
        checks.store_findings(conn, doc["id"], findings)
        if checks.has_blocking_open_issue(conn, doc["id"]):
            conn.execute("UPDATE documents SET status = 'blocked' WHERE id = ?", (doc["id"],))
            blocked.add(doc["id"])
