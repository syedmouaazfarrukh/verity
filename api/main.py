"""Verity API — one subject, one source, always the latest.

All routes live under /api. In production the built web app (../web/dist or
env WEB_DIST) is served at / with an SPA fallback to index.html.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

import anyio
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

import checks
from auth import (
    COOKIE_NAME,
    SESSION_TTL,
    authenticate,
    cookie_secure,
    create_session,
    current_user,
    delete_session,
    limiter,
    require_role,
)
from answer_details import answer_details
from chat import answer_question, receipt_payload
from crypto_helpers import load_or_create_keypair, public_key_b64, sha256_hex, verify
from db import (
    REPO_ROOT,
    SCHEMA_VERSION,
    audit,
    audit_scope_sql,
    db_path,
    get_conn,
    init_schema,
    iso,
    now_utc,
    schema_version,
    scope_sql,
)
from ingest import DocumentError, ingest_upload, prepare
from queries import DOC_SELECT, ZERO_COUNTS, doc_summary, get_doc_scoped, person_id, query_issues, trust_for
from seed import load_docs, seed_users

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("verity.api")

MAX_UPLOAD_BYTES = 200 * 1024
ALLOWED_EXTENSIONS = {".md", ".txt"}
STATE_CHANGING = {"POST", "PUT", "PATCH", "DELETE"}
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "verity"


# ---------------------------------------------------------------- startup

def init_database() -> None:
    path = db_path()
    if os.environ.get("VERITY_RESET", "").strip() == "1":
        for suffix in ("", "-wal", "-shm"):
            p = Path(str(path) + suffix)
            if p.exists():
                p.unlink()
        log.info("VERITY_RESET=1: wiped %s", path)
    elif path.exists():
        version = schema_version(path)
        if version is not None and version < SCHEMA_VERSION:
            # Older schema (e.g. v1, no departments): move it aside and re-seed rather than
            # run on a database whose rows have no department scope.
            stamp = now_utc().strftime("%Y%m%d%H%M%S")
            for suffix in ("", "-wal", "-shm"):
                p = Path(str(path) + suffix)
                if p.exists():
                    p.replace(Path(f"{path}.schema-v{version}-{stamp}.bak{suffix}"))
            log.warning("database %s had schema v%s (< v%s); moved aside and re-seeding", path, version, SCHEMA_VERSION)
    fresh = not path.exists()
    with get_conn() as conn:
        init_schema(conn)
        if fresh:
            seed_users(conn)
            load_docs(conn)
    load_or_create_keypair()


def web_dist() -> Path | None:
    p = Path(os.environ.get("WEB_DIST", str(REPO_ROOT / "web" / "dist"))).resolve()
    return p if (p / "index.html").is_file() else None


def build_csp() -> str:
    script_src = ["'self'"]
    dist = web_dist()
    if dist:
        html = (dist / "index.html").read_text(encoding="utf-8", errors="replace")
        for body in re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.DOTALL):
            digest = base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode()
            script_src.append(f"'sha256-{digest}'")
    return (
        "default-src 'self'; "
        f"script-src {' '.join(script_src)}; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; "
        "connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_database()
    app.state.csp = build_csp()
    log.info("Verity API ready (db=%s, web=%s)", db_path(), web_dist() or "not built")
    yield


app = FastAPI(title="Verity API", version="1.0.0", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


# ---------------------------------------------------------------- middleware + errors

@app.middleware("http")
async def security_middleware(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and request.method in STATE_CHANGING:
        if request.headers.get(CSRF_HEADER, "").lower() != CSRF_VALUE:
            resp: Response = JSONResponse({"detail": "Missing X-Requested-With header."}, status_code=403)
            return _secure(request, resp)
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_UPLOAD_BYTES + 64 * 1024:
            return _secure(request, JSONResponse({"detail": "Request too large (max 200 KB)."}, status_code=413))
    resp = await call_next(request)
    return _secure(request, resp)


def _secure(request: Request, resp: Response) -> Response:
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "same-origin"
    resp.headers["Content-Security-Policy"] = getattr(request.app.state, "csp", None) or build_csp()
    resp.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    resp.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, exc: StarletteHTTPException):
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return JSONResponse({"detail": detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    parts = []
    for err in exc.errors()[:3]:
        loc = ".".join(str(x) for x in err.get("loc", []) if x not in ("body", "query", "path"))
        parts.append(f"{loc}: {err.get('msg', 'invalid')}" if loc else str(err.get("msg", "invalid")))
    return JSONResponse({"detail": "Invalid request — " + "; ".join(parts)}, status_code=422)


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception):
    log.exception("unhandled error on %s %s", request.method, request.url.path)
    return _secure(request, JSONResponse({"detail": "Something went wrong on the server."}, status_code=500))


# ---------------------------------------------------------------- serializers + scoped queries

User = dict[str, Any]


# ---------------------------------------------------------------- auth routes

class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.post("/api/auth/login")
def login(body: LoginBody, response: Response) -> dict:
    username = body.username.strip().lower()
    if limiter.blocked(username):
        raise HTTPException(status_code=429, detail="Too many failed sign-in attempts. Try again in a few minutes.")
    with get_conn() as conn:
        user = authenticate(conn, username, body.password)
        if user is None:
            limiter.fail(username)
            audit(conn, username[:64], "login:failed", None)
            raise HTTPException(status_code=401, detail="Wrong username or password.")
        token = create_session(conn, user["username"])
        audit(conn, user["username"], "login", None)
    response.set_cookie(
        COOKIE_NAME, token, max_age=int(SESSION_TTL.total_seconds()), httponly=True,
        samesite="lax", secure=cookie_secure(), path="/",
    )
    return {"user": user}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, user: User = Depends(current_user)) -> dict:
    token = request.cookies.get(COOKIE_NAME)
    with get_conn() as conn:
        if token:
            delete_session(conn, token)
        audit(conn, user["username"], "logout", None)
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, samesite="lax", secure=cookie_secure())
    return {"ok": True}


@app.get("/api/me")
def me(user: User = Depends(current_user)) -> dict:
    return user


# ---------------------------------------------------------------- knowledge routes

@app.get("/api/topics")
def topics(user: User = Depends(current_user)) -> list[dict]:
    clause, params = scope_sql(user)
    with get_conn() as conn:
        docs = conn.execute(
            f"""SELECT d.id, d.title, d.country, d.version, d.updated_at, d.updated_by, d.status,
                       t.id AS topic_id, t.name AS topic_name
                FROM documents d JOIN topics t ON t.id = d.topic_id
                WHERE {clause} AND d.status != 'rejected' ORDER BY t.name, d.country, d.version DESC""",
            params,
        ).fetchall()
        counts = conn.execute(
            f"""SELECT d.topic_id, i.level, COUNT(*) AS n FROM issues i JOIN documents d ON d.id = i.document_id
                WHERE i.status = 'open' AND {clause} GROUP BY d.topic_id, i.level""",
            params,
        ).fetchall()
    out: dict[str, dict] = {}
    for d in docs:
        t = out.setdefault(d["topic_id"], {
            "id": d["topic_id"], "name": d["topic_name"], "live_documents": [],
            "open_issues": {"critical": 0, "high": 0, "medium": 0, "low": 0},
        })
        if d["status"] == "live":
            t["live_documents"].append({
                "id": d["id"], "title": d["title"], "country": d["country"], "version": d["version"],
                "updated_at": d["updated_at"] or "", "updated_by": d["updated_by"] or "",
            })
    for c in counts:
        if c["topic_id"] in out and c["level"] in out[c["topic_id"]]["open_issues"]:
            out[c["topic_id"]]["open_issues"][c["level"]] = c["n"]
    for t in out.values():
        t["trust"] = trust_for(t["open_issues"])
    return list(out.values())


@app.get("/api/documents")
def list_documents(
    topic: str | None = Query(None, max_length=80),
    country: str | None = Query(None, max_length=8),
    status: Literal["live", "blocked", "superseded", "rejected"] | None = None,
    user: User = Depends(current_user),
) -> list[dict]:
    clause, params = scope_sql(user)
    where, extra = [clause], list(params)
    if topic:
        where.append("d.topic_id = ?")
        extra.append(topic)
    if country:
        where.append("d.country = ?")
        extra.append(country.upper())
    if status:
        where.append("d.status = ?")
        extra.append(status)
    with get_conn() as conn:
        rows = conn.execute(
            f"{DOC_SELECT} WHERE {' AND '.join(where)} ORDER BY t.name, d.country, d.version DESC, d.created_at DESC",
            extra,
        ).fetchall()
    return [doc_summary(r) for r in rows]


def history_chain(conn: sqlite3.Connection, user: User, doc: sqlite3.Row) -> list[dict]:
    clause, params = scope_sql(user)
    rows = conn.execute(
        f"""SELECT d.id, d.version, d.status, d.updated_at, d.updated_by, d.change_summary, d.supersedes_id,
                   d.created_at
            FROM documents d WHERE d.topic_id = ? AND d.country = ? AND d.department = ? AND {clause}""",
        [doc["topic_id"], doc["country"], doc["department"], *params],
    ).fetchall()
    by_id = {r["id"]: r for r in rows}
    successors: dict[str, list[str]] = {}
    for r in rows:
        if r["supersedes_id"]:
            successors.setdefault(r["supersedes_id"], []).append(r["id"])
    chain = {doc["id"]}
    stack = [doc["id"]]
    while stack:  # walk both directions along supersedes links
        cur = stack.pop()
        neighbours = list(successors.get(cur, []))
        prev = by_id[cur]["supersedes_id"] if cur in by_id else None
        if prev in by_id:
            neighbours.append(prev)
        for n in neighbours:
            if n not in chain:
                chain.add(n)
                stack.append(n)
    items = sorted((by_id[i] for i in chain if i in by_id), key=lambda r: (r["version"], r["created_at"]), reverse=True)
    return [{
        "id": r["id"], "version": r["version"], "status": r["status"], "updated_at": r["updated_at"] or "",
        "updated_by": r["updated_by"] or "", "change_summary": r["change_summary"] or "",
    } for r in items]


def doc_detail(conn: sqlite3.Connection, user: User, doc_id: str) -> dict:
    row = get_doc_scoped(conn, user, doc_id)
    detail = doc_summary(row)
    detail.update({
        "content_md": row["content_md"],
        "effective_date": row["effective_date"],
        "review_by": row["review_by"],
        "sha256": row["sha256"],
        "claims": checks.load_claims(conn, doc_id),
        "history": history_chain(conn, user, row),
        "issues": query_issues(conn, user, "AND i.document_id = ?", [doc_id]),
    })
    return detail


@app.get("/api/documents/{doc_id}")
def get_document(doc_id: str, user: User = Depends(current_user)) -> dict:
    with get_conn() as conn:
        return doc_detail(conn, user, doc_id[:120])


@app.post("/api/documents")
async def upload_document(file: UploadFile = File(...), user: User = Depends(current_user)) -> dict:
    name = Path(file.filename or "").name
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only .md and .txt files can be uploaded.")
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File is too large (max 200 KB).")
    if not raw.strip():
        raise HTTPException(status_code=400, detail="The file is empty.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="The file must be UTF-8 text.") from None
    if "\x00" in text:
        raise HTTPException(status_code=400, detail="The file must be plain text.")
    stem = Path(name).stem[:80] or "document"
    try:
        meta = prepare(text, stem)
    except DocumentError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None

    if meta["country"] == "ALL":
        if user["role"] != "admin":
            why = "has no country, so it would apply company-wide" if "country" in meta["missing"] else "applies to ALL countries"
            raise HTTPException(status_code=403, detail=f"This document {why}; only an admin can publish company-wide documents.")
    elif meta["country"] not in user["countries"]:
        raise HTTPException(status_code=403, detail=f"You can only upload documents for your countries ({', '.join(user['countries'])}).")
    if meta["department"] not in user.get("departments", []):
        raise HTTPException(status_code=403, detail=f"You can't publish to the {meta['department']} department.")

    # Runs synchronously in the threadpool (LLM extraction may take up to 15s).
    doc_id, outcome = await anyio.to_thread.run_sync(_ingest_sync, meta, stem, user)
    with get_conn() as conn:
        doc = doc_summary(get_doc_scoped(conn, user, doc_id))
        issues = query_issues(conn, user, "AND i.document_id = ?", [doc_id])
    return {"document": doc, "issues": issues, "outcome": outcome}


def _ingest_sync(meta: dict, stem: str, user: User) -> tuple[str, str]:
    with get_conn() as conn:
        return ingest_upload(conn, meta, stem, user)


@app.get("/api/issues")
def list_issues(
    status: Literal["open", "resolved", "all"] = "open",
    user: User = Depends(current_user),
) -> list[dict]:
    with get_conn() as conn:
        if status == "all":
            return query_issues(conn, user)
        return query_issues(conn, user, "AND i.status = ?", [status])


class ResolveBody(BaseModel):
    resolution: Literal["accept_new", "keep_existing"]
    note: str = Field(max_length=1000)


@app.post("/api/issues/{issue_id}/resolve")
def resolve_issue(issue_id: str, body: ResolveBody, user: User = Depends(current_user)) -> dict:
    require_role(user, "owner", "admin")
    note = body.note.strip()
    if not note:
        raise HTTPException(status_code=422, detail="A note is required.")
    clause, params = scope_sql(user)
    with get_conn() as conn:
        issue = conn.execute(
            f"""SELECT i.*, d.status AS doc_status, d.country AS doc_country, d.department AS doc_department
                FROM issues i
                JOIN documents d ON d.id = i.document_id WHERE i.id = ? AND {clause}""",
            [issue_id[:64], *params],
        ).fetchone()
        if issue is None:
            raise HTTPException(status_code=404, detail="Issue not found.")
        if issue["status"] != "open":
            raise HTTPException(status_code=409, detail="This issue is already resolved.")
        doc_id = issue["document_id"]
        resolved = (user["display_name"], iso(now_utc()), body.resolution, note)

        if issue["doc_status"] == "live" and issue["other_document_id"] is None:
            # Single-document finding on a live doc (e.g. review overdue): acknowledge it.
            conn.execute(
                """UPDATE issues SET status='resolved', resolved_by=?, resolved_at=?, resolution=?, resolution_note=?
                   WHERE id = ?""", (*resolved, issue["id"]))
        else:
            if body.resolution == "accept_new":
                checks.make_live(conn, doc_id, prefer_superseded=issue["other_document_id"])
            else:
                conn.execute("UPDATE documents SET status = 'rejected' WHERE id = ?", (doc_id,))
            conn.execute(
                """UPDATE issues SET status='resolved', resolved_by=?, resolved_at=?, resolution=?, resolution_note=?
                   WHERE document_id = ? AND status = 'open'""", (*resolved, doc_id))
        audit(conn, user["username"], f"resolve:{body.resolution}", f"{issue['id']} {doc_id}",
              issue["doc_country"], issue["doc_department"])
        out_issue = query_issues(conn, user, "AND i.id = ?", [issue["id"]])[0]
        out_doc = doc_summary(get_doc_scoped(conn, user, doc_id))
    return {"issue": out_issue, "document": out_doc}


# ---------------------------------------------------------------- chat + receipts

class ChatBody(BaseModel):
    question: str = Field(min_length=1, max_length=1000)


@app.post("/api/chat")
async def chat(body: ChatBody, user: User = Depends(current_user)) -> dict:
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="Ask a question first.")
    return await anyio.to_thread.run_sync(_chat_sync, user, question)


def _chat_sync(user: User, question: str) -> dict:
    with get_conn() as conn:
        result = answer_question(conn, user, question)
        doc_id = result.pop("document_id")
        result["document"] = doc_summary(get_doc_scoped(conn, user, doc_id)) if doc_id else None
        result.update(answer_details(conn, user, doc_id))
        audit(conn, user["username"], "chat", result["receipt"]["id"])
    return result


@app.get("/api/receipts/{receipt_id}/verify")
def verify_receipt(receipt_id: str, user: User = Depends(current_user)) -> dict:
    clause, params = scope_sql(user)
    with get_conn() as conn:
        # Own receipts only (admin: all), and never one about a document now outside the user's scope.
        row = conn.execute(
            f"""SELECT * FROM receipts r WHERE r.id = ? AND (r.user = ? OR ? = 'admin')
                AND (r.document_id IS NULL OR EXISTS (SELECT 1 FROM documents d WHERE d.id = r.document_id AND {clause}))""",
            [receipt_id[:64], user["username"], user["role"], *params],
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Receipt not found.")
    payload = receipt_payload(row)
    valid = sha256_hex(payload) == row["payload_sha256"] and verify(payload, row["signature_b64"])
    receipt = dict(row)
    receipt["public_key_b64"] = public_key_b64()
    receipt["algorithm"] = "Ed25519"
    return {"valid": valid, "receipt": receipt}


# ---------------------------------------------------------------- graph + audit

DEPARTMENT_LABELS = {"payroll": "Payroll", "hr": "HR", "finance": "Finance"}


def _topic_counts(conn: sqlite3.Connection, clause: str, params: list) -> dict[str, dict[str, int]]:
    rows = conn.execute(
        f"""SELECT d.topic_id, i.level, COUNT(*) AS n FROM issues i JOIN documents d ON d.id = i.document_id
            WHERE i.status = 'open' AND {clause} GROUP BY d.topic_id, i.level""",
        params,
    ).fetchall()
    counts: dict[str, dict[str, int]] = {}
    for r in rows:
        if r["level"] in ZERO_COUNTS:
            counts.setdefault(r["topic_id"], dict(ZERO_COUNTS))[r["level"]] = r["n"]
    return counts


@app.get("/api/graph")
def graph(topic: str | None = Query(None, max_length=80), user: User = Depends(current_user)) -> dict:
    """No params: topic map (topics, countries, departments). `?topic=`: that topic's documents."""
    return _topic_graph(user, topic) if topic else _topic_map(user)


def _topic_map(user: User) -> dict:
    clause, params = scope_sql(user)
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT d.topic_id, t.name AS topic_name, d.country, d.department, COUNT(*) AS n
                FROM documents d JOIN topics t ON t.id = d.topic_id
                WHERE {clause} GROUP BY d.topic_id, d.country, d.department""",
            params,
        ).fetchall()
        counts = _topic_counts(conn, clause, params)
    nodes: dict[str, dict] = {}
    edges: dict[str, dict] = {}
    for r in rows:
        tid = f"topic:{r['topic_id']}"
        c = counts.get(r["topic_id"], ZERO_COUNTS)
        node = nodes.setdefault(tid, {
            "id": tid, "label": r["topic_name"], "type": "topic", "trust": trust_for(c),
            "doc_count": 0, "open_issue_count": sum(c.values()),
        })
        node["doc_count"] += r["n"]
        cid = f"country:{r['country']}"
        nodes.setdefault(cid, {"id": cid, "label": r["country"], "type": "country"})
        did = f"department:{r['department']}"
        nodes.setdefault(did, {"id": did, "label": DEPARTMENT_LABELS.get(r["department"], r["department"]),
                               "type": "department"})
        for dst, kind in ((cid, "applies_to"), (did, "belongs_to")):
            eid = f"{kind}:{tid}->{dst}"
            edges[eid] = {"id": eid, "source": tid, "target": dst, "type": kind}
    return {"nodes": list(nodes.values()), "edges": list(edges.values())}


def _topic_graph(user: User, topic_id: str) -> dict:
    clause, params = scope_sql(user)
    with get_conn() as conn:
        docs = conn.execute(
            f"""SELECT d.id, d.title, d.topic_id, d.country, d.owner, d.status, d.version, d.supersedes_id,
                       t.name AS topic_name
                FROM documents d JOIN topics t ON t.id = d.topic_id
                WHERE d.topic_id = ? AND {clause}""",
            [topic_id, *params],
        ).fetchall()
        if not docs:
            raise HTTPException(status_code=404, detail="Topic not found.")
        conflicts = conn.execute(
            f"""SELECT DISTINCT i.document_id, i.other_document_id FROM issues i
                JOIN documents d ON d.id = i.document_id
                WHERE i.status = 'open' AND i.rule = 'conflict' AND d.topic_id = ? AND {clause}""",
            [topic_id, *params],
        ).fetchall()
        counts = _topic_counts(conn, clause, params)

    nodes: dict[str, dict] = {}
    edges: dict[str, dict] = {}

    def edge(src: str, dst: str, kind: str) -> None:
        eid = f"{kind}:{src}->{dst}"
        edges[eid] = {"id": eid, "source": src, "target": dst, "type": kind}

    visible = {d["id"] for d in docs}
    for d in docs:
        tid = f"topic:{d['topic_id']}"
        nodes.setdefault(tid, {"id": tid, "label": d["topic_name"], "type": "topic",
                               "trust": trust_for(counts.get(d["topic_id"], ZERO_COUNTS))})
        nodes[d["id"]] = {"id": d["id"], "label": f"{d['title']} (v{d['version']})", "type": "document", "status": d["status"]}
        cid = f"country:{d['country']}"
        nodes.setdefault(cid, {"id": cid, "label": d["country"], "type": "country"})
        edge(d["id"], tid, "covers")
        edge(d["id"], cid, "applies_to")
        if d["owner"]:
            pid = person_id(d["owner"])
            nodes.setdefault(pid, {"id": pid, "label": d["owner"], "type": "person"})
            edge(d["id"], pid, "owned_by")
        if d["supersedes_id"] and d["supersedes_id"] in visible:
            edge(d["id"], d["supersedes_id"], "supersedes")
    for c in conflicts:
        if c["document_id"] in visible and c["other_document_id"] in visible:
            edge(c["document_id"], c["other_document_id"], "conflicts_with")
    return {"nodes": list(nodes.values()), "edges": list(edges.values())}


@app.get("/api/audit")
def audit_log(limit: int = Query(50, ge=1, le=500), user: User = Depends(current_user)) -> list[dict]:
    require_role(user, "owner", "admin")
    clause, params = audit_scope_sql(user, "a")
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT a.id, a.at, a.username, a.action, a.target FROM audit_log a
                WHERE {clause} ORDER BY a.id DESC LIMIT ?""",
            [*params, limit],
        ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------- web app (production)

@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
def api_not_found(rest: str) -> dict:
    raise HTTPException(status_code=404, detail="Not found.")


@app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def spa(full_path: str):
    dist = web_dist()
    if dist is None:
        return JSONResponse({"detail": "Web app not built. Run `npm run build` in web/ or use the Vite dev server."}, status_code=404)
    candidate = (dist / full_path).resolve()
    if full_path and candidate.is_file() and candidate.is_relative_to(dist):
        return FileResponse(candidate)
    return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})
