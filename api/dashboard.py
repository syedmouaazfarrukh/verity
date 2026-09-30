"""GET /api/dashboard: live numbers and an activity feed for the "one door" diagram.

Security: every count and event comes from a query carrying `scope_sql(user)` (country
AND department), so an out-of-scope document is never counted or mentioned. Activity is
built from audit rows JOINed to their document (scope applies to the document), plus one
synthetic "published" event per seed document. Login/chat audit rows are never used.

Cost: seven small queries, no per-row lookups; the UI polls this every 3 seconds.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from answer_details import SOURCE_LABELS, date_iso
from db import LEVEL_RANK, iso, now_utc, scope_sql
from queries import ZERO_COUNTS, User, trust_for

MAX_ACTIVITY = 25
MAX_NOTE = 140
BLOCKING = ("critical", "high")

# Only Upload is a real connector; the rest are shown as "coming soon" (v3.1).
COMING_SOON = [
    ("email", "Gmail"), ("slack", "Slack"), ("github", "GitHub"), ("notion", "Notion"),
    ("sharepoint", "SharePoint"), ("google-drive", "Google Drive"), ("teams", "Microsoft Teams"),
]


def dashboard(conn: sqlite3.Connection, user: User) -> dict[str, Any]:
    clause, params = scope_sql(user)
    now = iso(now_utc())
    return {
        **_totals_and_sources(conn, clause, params),
        "issues": _issues(conn, clause, params, now),
        "topics": _topics(conn, clause, params),
        "activity": _activity(conn, user),
        "generated_at": now,
    }


# ---------------------------------------------------------------- numbers

def _totals_and_sources(conn: sqlite3.Connection, clause: str, params: list) -> dict[str, Any]:
    rows = conn.execute(
        f"SELECT d.status, COUNT(*) AS n, MAX(d.created_at) AS last_at FROM documents d WHERE {clause} GROUP BY d.status",
        params,
    ).fetchall()
    totals = {"documents": 0, "live": 0, "blocked": 0, "superseded": 0, "rejected": 0}
    last_at = None
    for r in rows:
        totals["documents"] += r["n"]
        if r["status"] in totals:
            totals[r["status"]] = r["n"]
        last_at = max(filter(None, (last_at, r["last_at"])), default=None)
    upload = {"id": "upload", "label": "Upload", "status": "live", "documents": totals["documents"],
              "live": totals["live"], "blocked": totals["blocked"], "last_at": last_at}
    return {"totals": totals,
            "sources": [upload, *({"id": i, "label": label, "status": "coming_soon"} for i, label in COMING_SOON)]}


def _issues(conn: sqlite3.Connection, clause: str, params: list, now: str) -> dict[str, Any]:
    rows = conn.execute(
        f"""SELECT i.level, COUNT(*) AS n, SUM(i.due_at < ?) AS overdue
            FROM issues i JOIN documents d ON d.id = i.document_id
            WHERE i.status = 'open' AND {clause} GROUP BY i.level""",
        [now, *params],
    ).fetchall()
    counts, overdue = dict(ZERO_COUNTS), 0
    for r in rows:
        if r["level"] in counts:
            counts[r["level"]] = r["n"]
        overdue += r["overdue"] or 0
    nxt = conn.execute(
        f"""SELECT i.id, i.document_id, d.title AS document_title, i.level, i.due_at
            FROM issues i JOIN documents d ON d.id = i.document_id
            WHERE i.status = 'open' AND {clause} ORDER BY i.due_at, i.created_at LIMIT 1""",
        params,
    ).fetchone()
    return {"open": counts, "overdue": overdue, "next_due": dict(nxt) if nxt else None}


def _topics(conn: sqlite3.Connection, clause: str, params: list) -> dict[str, int]:
    # Same rule as /api/topics: a topic is listed if it has a non-rejected in-scope document;
    # its trust comes from open issues on all its in-scope documents.
    rows = conn.execute(
        f"""SELECT d.topic_id,
                   COALESCE(SUM(i.level = 'critical'), 0) AS critical,
                   COALESCE(SUM(i.level = 'high'), 0) AS high,
                   COALESCE(SUM(i.level = 'medium'), 0) AS medium
            FROM documents d LEFT JOIN issues i ON i.document_id = d.id AND i.status = 'open'
            WHERE {clause} GROUP BY d.topic_id HAVING SUM(d.status != 'rejected') > 0""",
        params,
    ).fetchall()
    out = {"green": 0, "amber": 0, "red": 0}
    for r in rows:
        out[trust_for({"critical": r["critical"], "high": r["high"], "medium": r["medium"], "low": 0})] += 1
    return out


# ---------------------------------------------------------------- activity

def _source_suffix(source: str | None) -> str:
    return f" from {SOURCE_LABELS.get(source, source)}" if source and source != "upload" else ""


def _short(note: str | None) -> str:
    note = " ".join((note or "").split()).rstrip(".")
    return note if len(note) <= MAX_NOTE else note[: MAX_NOTE - 1].rstrip() + "…"


def _block_reasons(conn: sqlite3.Connection, user: User, doc_ids: list[str]) -> dict[str, str]:
    """Most severe issue per document, e.g. "critical conflict: €130 vs €150". The other
    document's value is only shown if that document is in scope too (as in /api/issues)."""
    if not doc_ids:
        return {}
    d_clause, d_params = scope_sql(user, "d")
    o_clause, o_params = scope_sql(user, "o")
    rows = conn.execute(
        f"""SELECT i.document_id, i.rule, i.level, i.status, i.new_value, i.existing_value, i.created_at,
                   o.id AS other_visible_id
            FROM issues i JOIN documents d ON d.id = i.document_id
            LEFT JOIN documents o ON o.id = i.other_document_id AND {o_clause}
            WHERE i.document_id IN ({','.join('?' for _ in doc_ids)}) AND {d_clause}""",
        [*o_params, *doc_ids, *d_params],
    ).fetchall()
    best: dict[str, sqlite3.Row] = {}
    rank = lambda r: (LEVEL_RANK.get(r["level"], 9), r["status"] != "open", r["created_at"])  # noqa: E731
    for r in rows:
        if r["document_id"] not in best or rank(r) < rank(best[r["document_id"]]):
            best[r["document_id"]] = r
    out = {}
    for doc_id, r in best.items():
        reason = f"{r['level']} {r['rule'].replace('-', ' ')}"
        if r["rule"] == "conflict" and r["other_visible_id"] and r["new_value"] and r["existing_value"]:
            reason += f": {r['new_value']} vs {r['existing_value']}"
        out[doc_id] = reason
    return out


def _activity(conn: sqlite3.Connection, user: User) -> list[dict[str, Any]]:
    clause, params = scope_sql(user)
    # Upload targets are "<doc_id>"; resolve targets are "<issue_id> <doc_id>".
    audit_rows = conn.execute(
        f"""SELECT a.id, a.at, a.action, COALESCE(u.display_name, a.username) AS actor,
                   d.id AS doc_id, d.title, d.source, d.status AS doc_status,
                   i.rule, i.level, i.resolution_note,
                   EXISTS (SELECT 1 FROM issues j WHERE j.document_id = d.id AND j.resolved_at = i.resolved_at
                           AND j.level IN ('critical','high')) AS was_blocking
            FROM audit_log a
            JOIN documents d ON d.id = CASE WHEN a.action LIKE 'resolve:%'
                                            THEN substr(a.target, instr(a.target, ' ') + 1) ELSE a.target END
            LEFT JOIN users u ON u.username = a.username
            LEFT JOIN issues i ON a.action LIKE 'resolve:%' AND i.document_id = d.id
                               AND i.id = substr(a.target, 1, instr(a.target, ' ') - 1)
            WHERE (a.action LIKE 'upload:%' OR a.action LIKE 'resolve:%') AND {clause}
            ORDER BY a.id DESC LIMIT ?""",
        [*params, MAX_ACTIVITY],
    ).fetchall()
    seed_rows = conn.execute(
        f"""SELECT d.id, d.title, d.version, d.source, d.updated_by, d.owner, d.updated_at, d.created_at
            FROM documents d WHERE d.uploaded_by = 'seed' AND {clause}
            ORDER BY d.updated_at DESC, d.version DESC LIMIT ?""",
        [*params, MAX_ACTIVITY],
    ).fetchall()
    reasons = _block_reasons(conn, user, sorted({r["doc_id"] for r in audit_rows if r["action"] == "upload:blocked"}))

    events: list[dict[str, Any]] = []
    for r in audit_rows:
        title, actor = f"'{r['title']}'", r["actor"]
        base = {"id": f"audit-{r['id']}", "at": r["at"], "actor": actor, "document_id": r["doc_id"],
                "source": r["source"] or "upload"}
        kind, action = r["action"].split(":", 1)
        if kind == "upload":
            if action == "blocked":
                reason = reasons.get(r["doc_id"])
                result, outcome = f"blocked ({reason})" if reason else "blocked", "blocked"
            elif action == "superseded_previous":
                result, outcome = "live, replacing the previous version", "live"
            else:
                result, outcome = "live", "live"
            text = f"{actor} uploaded {title}{_source_suffix(r['source'])} → {result}."
            events.append({**base, "kind": "uploaded", "text": text, "outcome": outcome})
        else:
            note = f" (note: {_short(r['resolution_note'])})" if r["resolution_note"] else ""
            outcome = None
            if action == "accept_new" and r["was_blocking"]:
                text, outcome = f"{actor} accepted the new version of {title}{note}.", "live"
            elif action == "keep_existing" and (r["was_blocking"] or r["doc_status"] == "rejected"):
                text = f"{actor} kept the existing version of {title}{note}."
            else:
                what = f"the {r['rule'].replace('-', ' ')} issue" if r["rule"] else "an issue"
                text = f"{actor} acknowledged {what} on {title}{note}."
            events.append({**base, "kind": "resolved", "text": text, "outcome": outcome})
    for r in seed_rows:
        actor = r["updated_by"] or r["owner"] or "Someone"
        events.append({
            "id": f"seed-{r['id']}", "at": date_iso(r["updated_at"], r["created_at"]), "actor": actor,
            "kind": "published", "document_id": r["id"], "source": r["source"] or "upload", "outcome": None,
            "text": f"{actor} published '{r['title']}' v{r['version']}{_source_suffix(r['source'])}.",
        })
    events.sort(key=lambda e: e["at"], reverse=True)  # stable: ties keep query order
    return events[:MAX_ACTIVITY]
