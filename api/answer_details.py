"""Chat answer details: alternatives, provenance and the per-answer graph.

Security: every document, issue and count here comes from a query that carries
`scope_sql(user)` (country AND department), so nothing outside the user's scope
can appear, not even as a number. The used document itself is re-fetched with
`get_doc_scoped`.
"""

from __future__ import annotations

import sqlite3
from datetime import date
from typing import Any

import checks
from db import parse_iso, scope_sql
from extract import normalise_value
from queries import DOC_SELECT, ZERO_COUNTS, User, get_doc_scoped, person_id, query_issues, trust_for

MAX_ALTERNATIVES = 10
BLOCKING = ("critical", "high")
SOURCE_LABELS = {
    "upload": "Upload", "email": "Email", "google-drive": "Google Drive",
    "sharepoint": "SharePoint", "git": "Git", "teams": "Teams",
}
EVENT_ORDER = {"created": 0, "checked": 1, "flagged": 2, "resolved": 3, "live": 4, "superseded_previous": 5}


def empty_details() -> dict[str, Any]:
    return {"alternatives": [], "provenance": None, "graph": {"nodes": [], "edges": []}}


def answer_details(conn: sqlite3.Connection, user: User, doc_id: str | None) -> dict[str, Any]:
    if not doc_id:
        return empty_details()
    doc = dict(get_doc_scoped(conn, user, doc_id))
    alt_rows = _alternative_rows(conn, user, doc)
    return {
        "alternatives": [_alternative(conn, user, doc, a) for a in alt_rows],
        "provenance": _provenance(conn, user, doc),
        "graph": _graph(conn, user, doc, alt_rows),
    }


# ---------------------------------------------------------------- formatting

def fmt_date(d: str | None) -> str:
    if not d:
        return "an unknown date"
    try:
        p = date.fromisoformat(d[:10])
        return f"{p.day} {p.strftime('%b %Y')}"
    except ValueError:
        return d


def fmt_due(ts: str) -> str:
    try:
        dt = parse_iso(ts)
        return f"{dt.day} {dt.strftime('%b %H:%M')}"
    except ValueError:
        return ts


def date_iso(d: str | None, fallback: str) -> str:
    """Front-matter date (YYYY-MM-DD) -> ISO timestamp for timeline events."""
    if d and len(d) >= 10:
        try:
            return date.fromisoformat(d[:10]).isoformat() + "T00:00:00Z"
        except ValueError:
            pass
    return fallback


def _display_name(conn: sqlite3.Connection, username: str | None) -> str:
    if not username:
        return ""
    row = conn.execute("SELECT display_name FROM users WHERE username = ?", (username,)).fetchone()
    return row["display_name"] if row else username


# ---------------------------------------------------------------- alternatives

def _alternative_rows(conn: sqlite3.Connection, user: User, doc: dict) -> list[dict]:
    """Other in-scope docs on the same topic (same country, or ALL), any status, newest first."""
    clause, params = scope_sql(user)
    rows = conn.execute(
        f"""{DOC_SELECT}
            WHERE d.topic_id = ? AND d.id != ?
              AND (d.country = ? OR d.country = 'ALL' OR ? = 'ALL') AND {clause}
            ORDER BY COALESCE(d.updated_at, substr(d.created_at, 1, 10)) DESC, d.version DESC, d.created_at DESC
            LIMIT ?""",
        [doc["topic_id"], doc["id"], doc["country"], doc["country"], *params, MAX_ALTERNATIVES],
    ).fetchall()
    return [dict(r) for r in rows]


def _differs(conn: sqlite3.Connection, used_id: str, alt_id: str) -> list[dict[str, str]]:
    used = {c["key"]: c["value"] for c in checks.load_claims(conn, used_id)}
    return [
        {"key": c["key"], "value": c["value"], "live_value": used[c["key"]]}
        for c in checks.load_claims(conn, alt_id)
        if c["key"] in used and normalise_value(c["value"]) != normalise_value(used[c["key"]])
    ]


def _scoped_doc(conn: sqlite3.Connection, user: User, doc_id: str | None) -> dict | None:
    if not doc_id:
        return None
    clause, params = scope_sql(user)
    row = conn.execute(f"{DOC_SELECT} WHERE d.id = ? AND {clause}", [doc_id, *params]).fetchone()
    return dict(row) if row else None


def _reason(conn: sqlite3.Connection, user: User, used: dict, alt: dict) -> str:
    clause, params = scope_sql(user)
    status = alt["status"]
    if status == "superseded":
        succ = conn.execute(
            f"""SELECT d.title, d.version, d.updated_at FROM documents d
                WHERE d.supersedes_id = ? AND {clause} ORDER BY d.version DESC, d.created_at DESC LIMIT 1""",
            [alt["id"], *params],
        ).fetchone()
        if succ is None:
            return "Older version: replaced by a newer version."
        name = f"v{succ['version']}" if succ["title"] == alt["title"] else f"{succ['title']} (v{succ['version']})"
        return f"Older version: replaced by {name} on {fmt_date(succ['updated_at'])}."
    if status == "rejected":
        r = conn.execute(
            """SELECT resolved_by, resolved_at, resolution_note FROM issues
               WHERE document_id = ? AND resolution = 'keep_existing' ORDER BY resolved_at DESC LIMIT 1""",
            (alt["id"],),
        ).fetchone()
        if r is None:
            return "Rejected by the topic owner."
        return f"Rejected by {r['resolved_by']} on {fmt_date(r['resolved_at'])}: {r['resolution_note']}"
    if status == "blocked":
        open_issues = query_issues(conn, user, "AND i.document_id = ? AND i.status = 'open'", [alt["id"]])
        blocking = [i for i in open_issues if i["level"] in BLOCKING]
        if not blocking:
            return "Blocked: waiting for the topic owner's review."
        i = blocking[0]
        if i["rule"] == "no-owner":
            return "Blocked: nobody owns this document."
        other = _scoped_doc(conn, user, i["other_document_id"])
        approver = (other or {}).get("owner") or used.get("owner") or "the topic owner"
        when = f"overdue since {fmt_due(i['due_at'])}" if i["overdue"] else f"due {fmt_due(i['due_at'])}"
        wait = f"Waiting for {approver} ({i['level']}, {when})."
        if i["rule"] == "conflict" and other and i["existing_value"] is not None:
            ref = "the live document" if other["status"] == "live" else f"{other['title']} (v{other['version']})"
            return f"Blocked: says {i['new_value']} but {ref} says {i['existing_value']}. {wait}"
        if i["rule"] == "duplicate" and other:
            return f"Blocked: repeats {other['title']} (v{other['version']}) instead of updating it. {wait}"
        return f"Blocked: {i['message']} {wait}"
    # another live document on the same topic
    if alt["country"] == "ALL" and used["country"] != "ALL":
        return f"Also live, but it applies to all countries; {used['title']} is specific to {used['country']}."
    return f"Also live, but {used['title']} was the closer match for your question."


def _alternative(conn: sqlite3.Connection, user: User, used: dict, alt: dict) -> dict[str, Any]:
    return {
        "id": alt["id"], "title": alt["title"], "country": alt["country"], "version": alt["version"],
        "status": alt["status"], "updated_at": alt["updated_at"] or "", "updated_by": alt["updated_by"] or "",
        "source": alt["source"] or "upload", "source_detail": alt["source_detail"] or "",
        "reason": _reason(conn, user, used, alt),
        "differs": _differs(conn, used["id"], alt["id"]),
    }


# ---------------------------------------------------------------- provenance

def _provenance(conn: sqlite3.Connection, user: User, doc: dict) -> dict[str, Any]:
    is_seed = doc["uploaded_by"] == "seed"
    uploader = (doc["updated_by"] or doc["owner"] or "") if is_seed else _display_name(conn, doc["uploaded_by"])
    created_at = date_iso(doc["updated_at"], doc["created_at"]) if is_seed else doc["created_at"]
    source = doc["source"] or "upload"
    via = ""
    if source != "upload":
        via = f" from {SOURCE_LABELS.get(source, source)}" + (f" ({doc['source_detail']})" if doc["source_detail"] else "")
    summary = f": {doc['change_summary']}" if doc["change_summary"] else "."
    events: list[dict[str, str]] = [{
        "at": created_at, "actor": uploader or "Unknown", "kind": "created",
        "text": f"{uploader or 'Someone'} {'published' if is_seed else 'uploaded'} v{doc['version']}{via}{summary}",
    }]

    # What it was checked against: in-scope docs on the topic that existed before it.
    clause, params = scope_sql(user)
    before_col, before_val = ("d.updated_at", doc["updated_at"] or "") if is_seed else ("d.created_at", doc["created_at"])
    n = conn.execute(
        f"""SELECT COUNT(*) FROM documents d
            WHERE d.topic_id = ? AND d.id != ? AND (d.country = ? OR d.country = 'ALL' OR ? = 'ALL')
              AND {before_col} < ? AND {clause}""",
        [doc["topic_id"], doc["id"], doc["country"], doc["country"], before_val, *params],
    ).fetchone()[0]
    issues = sorted(query_issues(conn, user, "AND i.document_id = ?", [doc["id"]]), key=lambda i: i["created_at"])
    docs_word = f"{n} document{'s' if n != 1 else ''}"
    found = f"{len(issues)} issue{'s' if len(issues) != 1 else ''} flagged." if issues else "no conflicts."
    events.append({"at": created_at, "actor": "Verity", "kind": "checked",
                   "text": f"Checked against {docs_word} on this topic: {found}"})
    for i in issues:
        events.append({"at": i["created_at"], "actor": "Verity", "kind": "flagged",
                       "text": f"Flagged {i['rule'].replace('-', ' ')} ({i['level']}): {i['message']}"})

    # Resolutions: one event per owner decision (a decision resolves several issues at once).
    decisions: dict[tuple, dict] = {}
    for i in issues:
        if i["status"] != "resolved" or not i["resolved_at"]:
            continue
        key = (i["resolved_at"], i["resolved_by"], i["resolution"], i["resolution_note"])
        d = decisions.setdefault(key, {"blocking": False})
        d["blocking"] |= i["level"] in BLOCKING
    live_at, live_actor, live_text = None, None, None
    for (at, by, resolution, note), d in sorted(decisions.items(), key=lambda kv: kv[0][0]):
        if resolution == "accept_new" and d["blocking"]:
            text = f"Approved as the source: {note}"
            live_at, live_actor = at, by
            live_text = f"Became the live document for {doc['topic_name']} ({doc['country']}) after approval."
        elif resolution == "keep_existing":
            text = f"Kept the existing document: {note}"
        else:
            text = f"Acknowledged: {note}"
        events.append({"at": at, "actor": by or "", "kind": "resolved", "text": text})

    if doc["status"] == "live":
        if live_at is None:
            live_at = created_at
            live_actor = (uploader or "Verity") if is_seed else "Verity"
            live_text = (f"Became the live document for {doc['topic_name']} ({doc['country']})."
                         if is_seed else
                         f"No blocking issues, so it went live for {doc['topic_name']} ({doc['country']}).")
        events.append({"at": live_at, "actor": live_actor or "", "kind": "live", "text": live_text or ""})
        prev = _scoped_doc(conn, user, doc["supersedes_id"])
        if prev:
            events.append({
                "at": live_at, "actor": live_actor or "", "kind": "superseded_previous",
                "text": (f"Replaced v{prev['version']} (updated {fmt_date(prev['updated_at'])} by "
                         f"{prev['updated_by'] or 'unknown'}), which is kept as history."),
            })

    events.sort(key=lambda e: (e["at"], EVENT_ORDER.get(e["kind"], 9)))
    return {
        "source": source, "source_detail": doc["source_detail"] or "", "sha256": doc["sha256"],
        "uploaded_by": uploader, "events": events,
    }


# ---------------------------------------------------------------- answer graph

def _graph(conn: sqlite3.Connection, user: User, doc: dict, alts: list[dict]) -> dict[str, Any]:
    clause, params = scope_sql(user)
    levels = conn.execute(
        f"""SELECT i.level, COUNT(*) AS n FROM issues i JOIN documents d ON d.id = i.document_id
            WHERE i.status = 'open' AND d.topic_id = ? AND {clause} GROUP BY i.level""",
        [doc["topic_id"], *params],
    ).fetchall()
    counts = dict(ZERO_COUNTS)
    for r in levels:
        if r["level"] in counts:
            counts[r["level"]] = r["n"]

    nodes: dict[str, dict] = {}
    edges: dict[str, dict] = {}

    def edge(src: str, dst: str, kind: str) -> None:
        eid = f"{kind}:{src}->{dst}"
        edges[eid] = {"id": eid, "source": src, "target": dst, "type": kind}

    tid = f"topic:{doc['topic_id']}"
    nodes[tid] = {"id": tid, "label": doc["topic_name"], "type": "topic", "trust": trust_for(counts), "role": "context"}
    docs = [(doc, "source")] + [(a, "alternative") for a in alts]
    ids = {d["id"] for d, _ in docs}
    for d, role in docs:
        nodes[d["id"]] = {"id": d["id"], "label": f"{d['title']} (v{d['version']})", "type": "document",
                          "status": d["status"], "role": role}
        edge(d["id"], tid, "covers")
        cid = f"country:{d['country']}"
        nodes.setdefault(cid, {"id": cid, "label": d["country"], "type": "country", "role": "context"})
        edge(d["id"], cid, "applies_to")
        if d["owner"]:
            pid = person_id(d["owner"])
            nodes.setdefault(pid, {"id": pid, "label": d["owner"], "type": "person", "role": "context"})
            edge(d["id"], pid, "owned_by")
        if d["supersedes_id"] in ids:
            edge(d["id"], d["supersedes_id"], "supersedes")
    placeholders = ",".join("?" for _ in ids)
    conflicts = conn.execute(
        f"""SELECT DISTINCT i.document_id, i.other_document_id FROM issues i
            WHERE i.status = 'open' AND i.rule = 'conflict'
              AND i.document_id IN ({placeholders}) AND i.other_document_id IN ({placeholders})""",
        [*ids, *ids],
    ).fetchall()
    for c in conflicts:
        edge(c["document_id"], c["other_document_id"], "conflicts_with")
    return {"nodes": list(nodes.values()), "edges": list(edges.values())}
