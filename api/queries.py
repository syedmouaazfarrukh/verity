"""Scoped read helpers shared by the routes and the chat answer details.

Every helper takes the signed-in user and puts `scope_sql(user)` (country AND
department) into the SQL, so out-of-scope rows are never fetched.
"""

from __future__ import annotations

import re
import sqlite3
from typing import Any

from fastapi import HTTPException

from db import LEVEL_RANK, iso, now_utc, scope_sql

User = dict[str, Any]

DOC_SELECT = """
SELECT d.*, t.name AS topic_name,
  (SELECT COUNT(*) FROM issues i WHERE i.document_id = d.id AND i.status = 'open') AS open_issue_count
FROM documents d JOIN topics t ON t.id = d.topic_id
"""

ZERO_COUNTS = {"critical": 0, "high": 0, "medium": 0, "low": 0}


def doc_summary(r: sqlite3.Row | dict) -> dict[str, Any]:
    return {
        "id": r["id"], "title": r["title"], "topic_id": r["topic_id"], "topic_name": r["topic_name"],
        "country": r["country"], "department": r["department"], "owner": r["owner"] or "",
        "status": r["status"], "version": r["version"],
        "updated_at": r["updated_at"] or "", "updated_by": r["updated_by"] or "",
        "change_summary": r["change_summary"] or "", "open_issue_count": r["open_issue_count"],
        "source": r["source"] or "upload", "source_detail": r["source_detail"] or "",
    }


def get_doc_scoped(conn: sqlite3.Connection, user: User, doc_id: str) -> sqlite3.Row:
    clause, params = scope_sql(user)
    row = conn.execute(f"{DOC_SELECT} WHERE d.id = ? AND {clause}", [doc_id, *params]).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    return row


def query_issues(conn: sqlite3.Connection, user: User, where: str = "", params: list | None = None) -> list[dict[str, Any]]:
    d_clause, d_params = scope_sql(user, "d")
    o_clause, o_params = scope_sql(user, "o")
    rows = conn.execute(
        f"""SELECT i.*, d.title AS document_title, o.id AS other_visible_id, o.title AS other_document_title
            FROM issues i JOIN documents d ON d.id = i.document_id
            LEFT JOIN documents o ON o.id = i.other_document_id AND {o_clause}
            WHERE {d_clause} {where}""",
        [*o_params, *d_params, *(params or [])],
    ).fetchall()
    now = now_utc()
    out = []
    for r in rows:
        hidden_other = r["other_document_id"] is not None and r["other_visible_id"] is None
        out.append({
            "id": r["id"], "document_id": r["document_id"], "document_title": r["document_title"],
            "other_document_id": None if hidden_other else r["other_document_id"],
            "other_document_title": None if hidden_other else r["other_document_title"],
            "rule": r["rule"], "level": r["level"],
            "message": "Clashes with a document outside your access." if hidden_other else r["message"],
            "new_value": r["new_value"], "existing_value": None if hidden_other else r["existing_value"],
            "status": r["status"], "created_at": r["created_at"], "due_at": r["due_at"],
            "overdue": r["status"] == "open" and r["due_at"] < iso(now),
            "resolved_by": r["resolved_by"], "resolved_at": r["resolved_at"],
            "resolution": r["resolution"], "resolution_note": r["resolution_note"],
        })
    out.sort(key=lambda i: (i["status"] != "open", LEVEL_RANK.get(i["level"], 9), i["due_at"]))
    return out


def trust_for(counts: dict[str, int]) -> str:
    if counts["critical"]:
        return "red"
    if counts["high"] or counts["medium"]:
        return "amber"
    return "green"


def person_id(name: str) -> str:
    return "person:" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
