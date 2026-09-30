"""Turn a markdown file into a stored document (shared by seed + upload)."""

from __future__ import annotations

import hashlib
import re
import secrets
import sqlite3
from typing import Any

import checks
from db import COUNTRIES, DEPARTMENTS, SOURCES, audit, iso, now_utc
from extract import extract_claims, normalise_key, parse_metadata, split_front_matter


class DocumentError(ValueError):
    """User-facing validation problem with an uploaded file (-> HTTP 400)."""


def slug(s: str, max_len: int = 40) -> str:
    return (normalise_key(s) or "document")[:max_len].strip("-") or "document"


def prepare(text: str, filename_stem: str) -> dict[str, Any]:
    """Parse text into document fields. Missing metadata becomes defaults plus a
    `missing` list (never an exception); malformed values raise DocumentError."""
    try:
        fm, body = split_front_matter(text)
        meta = parse_metadata(fm, body, fallback_title=filename_stem)
    except ValueError as e:
        raise DocumentError(str(e)) from e

    missing: list[str] = []
    if not meta["country"]:
        missing.append("country")
        meta["country"] = "ALL"
    elif meta["country"] not in COUNTRIES:
        raise DocumentError(f"Unknown country '{meta['country'][:10]}'. Use one of: {', '.join(COUNTRIES)}.")
    if not meta["effective_date"]:
        missing.append("effective_date")
    if not meta["department"]:
        missing.append("department")
        meta["department"] = "payroll"
    elif meta["department"] not in DEPARTMENTS:
        raise DocumentError(f"Unknown department '{meta['department'][:20]}'. Use one of: {', '.join(DEPARTMENTS)}.")
    if not meta["source"]:
        meta["source"] = "upload"
    elif meta["source"] not in SOURCES:
        raise DocumentError(f"Unknown source '{meta['source'][:20]}'. Use one of: {', '.join(SOURCES)}.")
    meta["source_detail"] = meta["source_detail"] or ""
    if not meta["topic"]:
        meta["topic"] = slug(meta.get("topic_name") or meta["title"], 60)
    if not meta["topic_name"]:
        meta["topic_name"] = meta["topic"].replace("-", " ").capitalize()
    if meta["version"] is None:
        meta["version"] = 1
    meta["missing"] = missing
    meta["body"] = body
    meta["content_md"] = text
    return meta


def upsert_topic(conn: sqlite3.Connection, topic_id: str, name: str) -> None:
    conn.execute("INSERT OR IGNORE INTO topics (id, name) VALUES (?, ?)", (topic_id, name))


def insert_document(
    conn: sqlite3.Connection, doc_id: str, meta: dict[str, Any], claims: list[dict[str, str]],
    status: str, uploaded_by: str, supersedes_id: str | None = None,
) -> None:
    upsert_topic(conn, meta["topic"], meta["topic_name"])
    conn.execute(
        """INSERT INTO documents (id, topic_id, title, country, department, owner, status, version, content_md,
             effective_date, review_by, updated_by, updated_at, change_summary, supersedes_id,
             uploaded_by, source, source_detail, sha256, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (doc_id, meta["topic"], meta["title"], meta["country"], meta["department"], meta.get("owner"), status,
         meta["version"], meta["content_md"], meta.get("effective_date"), meta.get("review_by"),
         meta.get("updated_by"), meta.get("updated_at"), meta.get("change_summary"), supersedes_id, uploaded_by,
         meta.get("source") or "upload", meta.get("source_detail") or "",
         hashlib.sha256(meta["content_md"].encode("utf-8")).hexdigest(), iso(now_utc())),
    )
    for c in claims:
        conn.execute(
            "INSERT INTO claims (document_id, topic_id, country, key, value) VALUES (?,?,?,?,?)",
            (doc_id, meta["topic"], meta["country"], c["key"], c["value"]),
        )


def ingest_upload(conn: sqlite3.Connection, meta: dict[str, Any], filename_stem: str, user: dict[str, Any]) -> tuple[str, str]:
    """Store an uploaded document, run the checks, apply the outcome.
    Returns (document_id, outcome)."""
    # "Who changed it, when" must be the signed-in uploader, never a name typed into the file.
    meta["updated_by"] = user["display_name"]
    meta["updated_at"] = now_utc().date().isoformat()

    known_keys = [r["key"] for r in conn.execute(
        """SELECT DISTINCT c.key FROM claims c JOIN documents d ON d.id = c.document_id
           WHERE c.topic_id = ? AND d.department = ?""", (meta["topic"], meta["department"])).fetchall()]
    claims = extract_claims(meta["content_md"], meta["body"], known_keys)

    doc_id = f"doc-{slug(re.sub(r'^[0-9]+-', '', filename_stem))}-{secrets.token_hex(3)}"
    candidates = checks.live_candidates(conn, meta["topic"], meta["country"], meta["department"], doc_id)
    insert_document(conn, doc_id, meta, claims, status="blocked", uploaded_by=user["username"])
    doc_view = {**meta, "id": doc_id}
    # Only owners/admins may publish a new version directly; a consultant's version goes to the owner.
    can_publish = user["role"] in ("owner", "admin")
    findings = checks.evaluate(doc_view, claims, candidates, meta["missing"], allow_updates=can_publish)
    checks.store_findings(conn, doc_id, findings)
    outcome = checks.apply_outcome(conn, doc_id)
    audit(conn, user["username"], f"upload:{outcome}", doc_id, meta["country"], meta["department"])
    return doc_id, outcome
