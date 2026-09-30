"""Deterministic conflict / SLA rules engine.

Pattern ported from Postura's mapper engine: a declarative rule table (id,
level) plus a single evaluation pass that produces findings ("issues") for one
document against the live documents it could clash with. Storage and the
live/blocked/superseded outcome are separate steps so the engine stays pure.

| rule             | level    | SLA |
|------------------|----------|-----|
| conflict         | critical | 24h |
| duplicate        | high     | 72h |
| no-owner         | high     | 72h |
| stale-version    | medium   | 7d  |
| review-overdue   | medium   | 7d  |
| missing-metadata | low      | 30d |
"""

from __future__ import annotations

import secrets
import sqlite3
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from db import iso, now_utc
from extract import normalise_value

RULE_LEVEL = {
    "conflict": "critical",
    "duplicate": "high",
    "no-owner": "high",
    "stale-version": "medium",
    "review-overdue": "medium",
    "missing-metadata": "low",
}
SLA = {
    "critical": timedelta(hours=24),
    "high": timedelta(hours=72),
    "medium": timedelta(days=7),
    "low": timedelta(days=30),
}
BLOCKING_LEVELS = ("critical", "high")


@dataclass
class Finding:
    rule: str
    message: str
    other_document_id: str | None = None
    new_value: str | None = None
    existing_value: str | None = None

    @property
    def level(self) -> str:
        return RULE_LEVEL[self.rule]


def _label(key: str) -> str:
    return key.replace("-", " ")


def _fmt_date(d: str) -> str:
    try:
        parsed = date.fromisoformat(d[:10])
        return f"{parsed.day} {parsed.strftime('%b %Y')}"
    except ValueError:
        return d


def _ref(doc: dict[str, Any]) -> str:
    return f"'{doc['title']}' (v{doc['version']})"


def is_newer_version_of(doc: dict[str, Any], other: dict[str, Any]) -> bool:
    """A legitimate update: same exact country, higher version, and the author
    explained what changed. Value differences are then expected, not conflicts."""
    return (
        doc["country"] == other["country"]
        and doc["version"] > other["version"]
        and bool((doc.get("change_summary") or "").strip())
    )


def evaluate(
    doc: dict[str, Any],
    claims: list[dict[str, str]],
    candidates: list[dict[str, Any]],
    missing: list[str],
    today: date | None = None,
    allow_updates: bool = True,
) -> list[Finding]:
    """Run every rule for `doc`. `candidates` are LIVE docs of the same topic with a
    compatible country (same, or either is ALL), each with a `claims` list."""
    today = today or now_utc().date()
    findings: list[Finding] = []
    new_claims = {c["key"]: c["value"] for c in claims}

    for other in candidates:
        other_claims = {c["key"]: c["value"] for c in other["claims"]}
        # conflict
        newer = is_newer_version_of(doc, other)
        if not (newer and allow_updates):
            for key, value in new_claims.items():
                if key in other_claims and normalise_value(value) != normalise_value(other_claims[key]):
                    msg = (
                        f"Says {_label(key)} is {value}, but the live document {_ref(other)} "
                        f"says {other_claims[key]}."
                    )
                    if newer:
                        msg = (
                            f"Proposes changing {_label(key)} from {other_claims[key]} to {value} "
                            f"(replacing {_ref(other)}). New versions from consultants need the topic owner's approval."
                        )
                    elif doc["country"] == other["country"] and doc["version"] > other["version"]:
                        msg += " It has a higher version number but no change summary explaining the change."
                    findings.append(Finding("conflict", msg, other["id"], value, other_claims[key]))
        # duplicate
        if (
            new_claims
            and doc["version"] <= other["version"]
            and all(k in other_claims and normalise_value(v) == normalise_value(other_claims[k]) for k, v in new_claims.items())
        ):
            findings.append(Finding(
                "duplicate",
                f"Every rule in this document already exists in the live document {_ref(other)}. "
                f"Update that document instead of publishing a copy.",
                other["id"],
            ))

    # stale-version: against the highest live version for the exact same topic+country
    same_country = [c for c in candidates if c["country"] == doc["country"]]
    if same_country:
        top = max(same_country, key=lambda c: c["version"])
        if doc["version"] <= top["version"]:
            findings.append(Finding(
                "stale-version",
                f"This is version {doc['version']}, but the live document {_ref(top)} is already at "
                f"version {top['version']}, so this looks like an older or parallel copy.",
                top["id"], f"v{doc['version']}", f"v{top['version']}",
            ))

    if not (doc.get("owner") or "").strip():
        findings.append(Finding(
            "no-owner",
            "No owner is set, so nobody is accountable for keeping this document correct. Add an `owner:` line.",
        ))

    review_by = doc.get("review_by")
    if review_by:
        try:
            rb = date.fromisoformat(review_by[:10])
        except ValueError:
            rb = None
        if rb and rb < today:
            days = (today - rb).days
            findings.append(Finding(
                "review-overdue",
                f"The review date ({_fmt_date(review_by)}) passed {days} day{'s' if days != 1 else ''} ago. "
                f"The owner should confirm the content is still correct.",
                None, None, review_by,
            ))

    if missing:
        nice = {"country": "country", "effective_date": "effective date", "department": "department"}
        parts = [nice.get(m, m) for m in missing]
        what = ", ".join(parts[:-1]) + " and " + parts[-1] if len(parts) > 1 else parts[0]
        notes = []
        if "country" in missing:
            notes.append("treated as company-wide for now")
        if "department" in missing:
            notes.append("filed under payroll for now")
        findings.append(Finding(
            "missing-metadata",
            f"Missing {what}, so Verity cannot tell exactly where, for whom or from when this applies"
            + (f" ({'; '.join(notes)})." if notes else "."),
        ))
    return findings


# ---- storage helpers ----

def load_claims(conn: sqlite3.Connection, doc_id: str) -> list[dict[str, str]]:
    rows = conn.execute("SELECT key, value FROM claims WHERE document_id = ? ORDER BY id", (doc_id,)).fetchall()
    return [{"key": r["key"], "value": r["value"]} for r in rows]


def live_candidates(conn: sqlite3.Connection, topic_id: str, country: str, department: str,
                    exclude_id: str) -> list[dict[str, Any]]:
    """Live docs a new doc is checked against: same topic AND same department (a doc
    can never clash with, or replace, another department's document)."""
    rows = conn.execute(
        """SELECT * FROM documents
           WHERE status = 'live' AND topic_id = ? AND department = ? AND id != ?
             AND (country = ? OR country = 'ALL' OR ? = 'ALL')
           ORDER BY version DESC, updated_at DESC""",
        (topic_id, department, exclude_id, country, country),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["claims"] = load_claims(conn, d["id"])
        out.append(d)
    return out


def store_findings(conn: sqlite3.Connection, doc_id: str, findings: list[Finding]) -> list[str]:
    created = now_utc()
    ids = []
    for f in findings:
        issue_id = "iss-" + secrets.token_hex(6)
        conn.execute(
            """INSERT INTO issues (id, document_id, other_document_id, rule, level, message, new_value,
                                   existing_value, status, created_at, due_at)
               VALUES (?,?,?,?,?,?,?,?, 'open', ?, ?)""",
            (issue_id, doc_id, f.other_document_id, f.rule, f.level, f.message, f.new_value,
             f.existing_value, iso(created), iso(created + SLA[f.level])),
        )
        ids.append(issue_id)
    return ids


def has_blocking_open_issue(conn: sqlite3.Connection, doc_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM issues WHERE document_id = ? AND status = 'open' AND level IN ('critical','high') LIMIT 1",
        (doc_id,),
    ).fetchone()
    return row is not None


def make_live(conn: sqlite3.Connection, doc_id: str, prefer_superseded: str | None = None) -> list[str]:
    """Set doc live; supersede other live docs of the same topic+country.
    Returns the ids that were superseded (highest version first)."""
    doc = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    others = conn.execute(
        """SELECT id, version FROM documents
           WHERE status = 'live' AND topic_id = ? AND country = ? AND department = ? AND id != ?
           ORDER BY version DESC, updated_at DESC""",
        (doc["topic_id"], doc["country"], doc["department"], doc_id),
    ).fetchall()
    ids = [r["id"] for r in others]
    for oid in ids:
        conn.execute("UPDATE documents SET status = 'superseded' WHERE id = ?", (oid,))
    supersedes = prefer_superseded if prefer_superseded in ids else (ids[0] if ids else doc["supersedes_id"])
    conn.execute("UPDATE documents SET status = 'live', supersedes_id = ? WHERE id = ?", (supersedes, doc_id))
    return ids


def apply_outcome(conn: sqlite3.Connection, doc_id: str) -> str:
    """Contract outcome: blocked if any open critical/high; else supersede lower
    live versions of the same topic+country; else plain live."""
    if has_blocking_open_issue(conn, doc_id):
        conn.execute("UPDATE documents SET status = 'blocked' WHERE id = ?", (doc_id,))
        return "blocked"
    doc = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    lower = conn.execute(
        """SELECT id FROM documents WHERE status = 'live' AND topic_id = ? AND country = ? AND department = ?
           AND id != ? AND version < ? ORDER BY version DESC""",
        (doc["topic_id"], doc["country"], doc["department"], doc_id, doc["version"]),
    ).fetchall()
    if lower:
        for r in lower:
            conn.execute("UPDATE documents SET status = 'superseded' WHERE id = ?", (r["id"],))
        conn.execute("UPDATE documents SET status = 'live', supersedes_id = ? WHERE id = ?", (lower[0]["id"], doc_id))
        return "superseded_previous"
    conn.execute("UPDATE documents SET status = 'live' WHERE id = ?", (doc_id,))
    return "live"
