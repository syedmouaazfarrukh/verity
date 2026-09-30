"""Smoke tests for the Verity API (run: uv run --python 3.12 --with-requirements requirements.txt pytest -q).

Uses the real seed/docs and seed/uploads files against a throwaway database.
Tests run in file order and share one database (uploads build on each other).
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

TMP = Path(os.environ.get("VERITY_TEST_TMP", "/tmp/verity-test"))
TMP.mkdir(parents=True, exist_ok=True)
for suffix in ("", "-wal", "-shm"):
    Path(str(TMP / "verity.db") + suffix).unlink(missing_ok=True)
os.environ["VERITY_DB"] = str(TMP / "verity.db")
os.environ["VERITY_KEY_PATH"] = str(TMP / "keys" / "ed25519.pem")
for _var in ("ANTHROPIC_API_KEY", "LLM_PROVIDER", "LLM_BASE_URL", "LLM_API_KEY"):
    os.environ.pop(_var, None)  # deterministic paths only
os.environ.pop("VERITY_RESET", None)
os.environ["DEMO_PASSWORD"] = "verity-demo"

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from auth import limiter  # noqa: E402

UPLOADS = Path(__file__).resolve().parent.parent / "seed" / "uploads"
H = {"X-Requested-With": "verity"}


@pytest.fixture(scope="module")
def app():
    with TestClient(main.app) as c:  # runs lifespan: schema + seed
        yield c.app


def client_for(app, username: str | None) -> TestClient:
    c = TestClient(app)
    if username:
        r = c.post("/api/auth/login", json={"username": username, "password": "verity-demo"}, headers=H)
        assert r.status_code == 200, r.text
    return c


def upload(c: TestClient, filename: str):
    path = UPLOADS / filename
    if not path.exists():
        pytest.skip(f"{filename} not written yet")
    return c.post("/api/documents", files={"file": (filename, path.read_bytes(), "text/markdown")}, headers=H)


def rules_of(issues):
    return {i["rule"] for i in issues}


# ---------------------------------------------------------------- auth

def test_health_and_security_headers(app):
    r = TestClient(app).get("/api/health")
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "same-origin"
    assert "default-src 'self'" in r.headers["Content-Security-Policy"]


def test_login_ok_sets_httponly_cookie(app):
    c = TestClient(app)
    r = c.post("/api/auth/login", json={"username": "sofie", "password": "verity-demo"}, headers=H)
    assert r.status_code == 200
    assert r.json()["user"] == {"username": "sofie", "display_name": "Sofie Claes", "role": "consultant",
                                "countries": ["BE"], "departments": ["payroll", "hr"]}
    cookie = r.headers["set-cookie"].lower()
    assert "verity_session=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert c.get("/api/me").json()["username"] == "sofie"
    assert c.post("/api/auth/logout", headers=H).json() == {"ok": True}
    assert c.get("/api/me").status_code == 401


def test_login_fail(app):
    r = TestClient(app).post("/api/auth/login", json={"username": "sofie", "password": "nope"}, headers=H)
    assert r.status_code == 401 and isinstance(r.json()["detail"], str)
    r = TestClient(app).post("/api/auth/login", json={"username": "ghost", "password": "nope"}, headers=H)
    assert r.status_code == 401


def test_login_rate_limited(app):
    c = TestClient(app)
    for _ in range(10):
        assert c.post("/api/auth/login", json={"username": "mallory", "password": "x"}, headers=H).status_code == 401
    assert c.post("/api/auth/login", json={"username": "mallory", "password": "x"}, headers=H).status_code == 429
    limiter.reset()


def test_unauthenticated_401(app):
    c = TestClient(app)
    for path in ("/api/me", "/api/topics", "/api/documents", "/api/documents/doc-hoa-be-v3", "/api/issues", "/api/graph"):
        r = c.get(path)
        assert r.status_code == 401, path
        assert isinstance(r.json()["detail"], str)
    assert c.post("/api/chat", json={"question": "hi"}, headers=H).status_code == 401


def test_csrf_header_required(app):
    c = client_for(app, "sofie")
    assert c.post("/api/chat", json={"question": "home office cap"}).status_code == 403
    assert c.post("/api/documents", files={"file": ("a.md", b"# x", "text/markdown")}).status_code == 403
    assert TestClient(app).post("/api/auth/login", json={"username": "sofie", "password": "verity-demo"}).status_code == 403


# ---------------------------------------------------------------- scope

def test_seed_state(app):
    c = client_for(app, "admin")
    docs = {d["id"]: d for d in c.get("/api/documents").json()}
    assert docs["doc-hoa-be-v3"]["status"] == "live"
    assert docs["doc-hoa-be-v2"]["status"] == "superseded"
    assert docs["doc-home-office-faq-be"]["status"] == "blocked"
    detail = c.get("/api/documents/doc-hoa-be-v3").json()
    assert [h["version"] for h in detail["history"]] == [3, 2, 1]
    assert {"key": "monthly-cap", "value": "€150"} in detail["claims"]
    faq_rules = rules_of(c.get("/api/documents/doc-home-office-faq-be").json()["issues"])
    assert {"conflict", "no-owner", "stale-version"} <= faq_rules
    assert "review-overdue" in rules_of(c.get("/api/documents/doc-holiday-pay-be-v1").json()["issues"])
    topics = {t["id"]: t for t in c.get("/api/topics").json()}
    assert topics["home-office-allowance"]["trust"] == "red"


def test_nl_consultant_cannot_see_be_docs(app):
    c = client_for(app, "daan")
    assert c.get("/api/documents/doc-hoa-be-v3").status_code == 404
    assert c.get("/api/documents/does-not-exist").status_code == 404
    countries = {d["country"] for d in c.get("/api/documents").json()}
    assert countries <= {"NL", "ALL"} and "NL" in countries
    assert c.get("/api/documents?country=BE").json() == []
    ids = {n["id"] for n in c.get("/api/graph").json()["nodes"]}
    assert "country:BE" not in ids and "topic:home-office-allowance" in ids
    ids = {n["id"] for n in c.get("/api/graph?topic=home-office-allowance").json()["nodes"]}
    assert "doc-hoa-be-v3" not in ids and "doc-hoa-nl-v1" in ids
    assert "country:BE" not in ids
    assert all(i["document_id"] not in ("doc-hoa-be-v3", "doc-home-office-faq-be") for i in c.get("/api/issues?status=all").json())
    for t in c.get("/api/topics").json():
        assert all(d["country"] in ("NL", "ALL") for d in t["live_documents"])


FINANCE_DOC = "doc-client-credit-notes-be-v1"


def test_sofie_cannot_see_finance_doc(app):
    c = client_for(app, "sofie")
    assert c.get("/api/me").json()["departments"] == ["payroll", "hr"]
    assert c.get(f"/api/documents/{FINANCE_DOC}").status_code == 404
    assert FINANCE_DOC not in {d["id"] for d in c.get("/api/documents").json()}
    assert c.get("/api/documents?topic=client-credit-notes").json() == []
    assert {d["department"] for d in c.get("/api/documents").json()} <= {"payroll", "hr"}
    assert "client-credit-notes" not in {t["id"] for t in c.get("/api/topics").json()}
    g = c.get("/api/graph").json()
    ids = {n["id"] for n in g["nodes"]}
    assert "topic:client-credit-notes" not in ids and "department:finance" not in ids
    assert "person:noor-el-amrani" not in ids
    r = c.get("/api/graph?topic=client-credit-notes")
    assert r.status_code == 404 and FINANCE_DOC not in r.text
    assert all(i["document_id"] != FINANCE_DOC for i in c.get("/api/issues?status=all").json())
    body = c.post("/api/chat", json={"question": "credit note approval threshold"}, headers=H).json()
    assert body["document"] is None
    assert body["alternatives"] == [] and body["provenance"] is None and body["graph"]["nodes"] == []
    assert "Noor" not in body["answer"] and "€5,000" not in body["answer"]
    assert "CN-400" not in str(body)


def test_noor_sees_finance_but_not_payroll(app):
    c = client_for(app, "noor")
    me = c.get("/api/me").json()
    assert me["role"] == "owner" and me["departments"] == ["finance"]
    doc = c.get(f"/api/documents/{FINANCE_DOC}").json()
    assert doc["department"] == "finance" and doc["owner"] == "Noor El Amrani"
    assert {"key": "approval-threshold", "value": "€5,000"} in doc["claims"]
    assert c.get("/api/documents/doc-hoa-be-v3").status_code == 404
    assert c.get("/api/documents/doc-sick-leave-be-v1").status_code == 404
    assert {d["department"] for d in c.get("/api/documents").json()} == {"finance"}
    assert [t["id"] for t in c.get("/api/topics").json()] == ["client-credit-notes"]
    assert c.get("/api/graph?topic=home-office-allowance").status_code == 404
    body = c.post("/api/chat", json={"question": "What is the credit note approval threshold?"}, headers=H).json()
    assert body["document"]["id"] == FINANCE_DOC and "€5,000" in body["answer"]
    assert all(a["id"] != "doc-hoa-be-v3" for a in body["alternatives"])
    payroll = c.post("/api/chat", json={"question": "home office allowance monthly cap"}, headers=H).json()
    assert payroll["document"] is None


# ---------------------------------------------------------------- dashboard

SOURCE_ORDER = ["upload", "email", "slack", "github", "notion", "sharepoint", "google-drive", "teams"]


def test_dashboard_requires_session(app):
    r = TestClient(app).get("/api/dashboard")
    assert r.status_code == 401 and isinstance(r.json()["detail"], str)


def _dash_matches_documents(c: TestClient) -> dict:
    dash = c.get("/api/dashboard").json()
    docs = c.get("/api/documents").json()
    t = dash["totals"]
    assert t["documents"] == len(docs)
    for status in ("live", "blocked", "superseded", "rejected"):
        assert t[status] == sum(d["status"] == status for d in docs), status
    upload = dash["sources"][0]
    assert (upload["documents"], upload["live"], upload["blocked"]) == (t["documents"], t["live"], t["blocked"])
    return dash


def test_dashboard_scope_and_sources(app):
    sofie = client_for(app, "sofie")
    dash = _dash_matches_documents(sofie)
    assert set(dash) == {"totals", "sources", "issues", "topics", "activity", "generated_at"}
    assert [s["id"] for s in dash["sources"]] == SOURCE_ORDER
    upload, *soon = dash["sources"]
    assert upload["label"] == "Upload" and upload["status"] == "live" and upload["last_at"]
    assert [s["label"] for s in soon] == ["Gmail", "Slack", "GitHub", "Notion", "SharePoint", "Google Drive",
                                          "Microsoft Teams"]
    assert all(s == {"id": s["id"], "label": s["label"], "status": "coming_soon"} for s in soon)
    # Scope: the finance doc is never counted or mentioned for sofie.
    blob = str(dash)
    assert FINANCE_DOC not in blob and "Client credit notes" not in blob and "Noor" not in blob
    assert all(a["document_id"] != FINANCE_DOC for a in dash["activity"])
    topics = sofie.get("/api/topics").json()
    assert sum(dash["topics"].values()) == len(topics)
    for trust in ("green", "amber", "red"):
        assert dash["topics"][trust] == sum(t["trust"] == trust for t in topics), trust
    open_issues = sofie.get("/api/issues?status=open").json()
    assert sum(dash["issues"]["open"].values()) == len(open_issues)
    assert dash["issues"]["next_due"]["id"] == min(open_issues, key=lambda i: i["due_at"])["id"]
    # Seed documents appear once each as a synthetic "published" event, newest first, max 25.
    acts = dash["activity"]
    assert 0 < len(acts) <= 25 and [a["at"] for a in acts] == sorted((a["at"] for a in acts), reverse=True)
    assert {a["kind"] for a in acts} <= {"published", "uploaded", "resolved", "blocked", "live", "superseded"}
    mob = next(a for a in acts if a["id"] == "seed-doc-mobility-budget-be-v1")
    assert mob["kind"] == "published" and mob["source"] == "notion" and mob["outcome"] is None
    assert mob["text"] == "Lies Vermeulen published 'Mobility budget — Belgium' v1 from Notion."
    assert all({"id", "at", "actor", "kind", "text", "document_id", "source", "outcome"} <= set(a) for a in acts)
    pytest.sofie_upload_blocked = upload["blocked"]

    noor = client_for(app, "noor")
    nd = _dash_matches_documents(noor)
    assert nd["totals"]["documents"] == 1 and nd["sources"][0]["documents"] == 1
    assert [a["document_id"] for a in nd["activity"]] == [FINANCE_DOC]
    assert "doc-hoa-be-v3" not in str(nd)
    admin = _dash_matches_documents(client_for(app, "admin"))
    assert admin["totals"]["documents"] == dash["totals"]["documents"] + 1 + sum(
        d["country"] == "NL" for d in client_for(app, "daan").get("/api/documents").json())
    # The emailed-note demo import was dropped (v3.1): no connector endpoints.
    assert sofie.post("/api/connectors/email/demo-import", headers=H).status_code == 404


def test_consultant_cannot_read_audit(app):
    assert client_for(app, "sofie").get("/api/audit").status_code == 403
    assert client_for(app, "lies").get("/api/audit?limit=5").status_code == 200


# ---------------------------------------------------------------- uploads

def test_upload_validation(app):
    c = client_for(app, "sofie")
    assert c.post("/api/documents", files={"file": ("x.pdf", b"%PDF", "application/pdf")}, headers=H).status_code == 400
    big = b"---\ntitle: x\n---\n" + b"a" * (201 * 1024)
    assert c.post("/api/documents", files={"file": ("big.md", big, "text/markdown")}, headers=H).status_code == 413
    assert c.post("/api/documents", files={"file": ("bin.md", b"\xff\xfe\x00bad", "text/markdown")}, headers=H).status_code == 400
    nl = b"---\ntitle: NL doc\ntopic: holiday-pay\ncountry: NL\nversion: 9\nowner: X\n---\n## Key rules\n- A: b\n"
    assert c.post("/api/documents", files={"file": ("nl.md", nl, "text/markdown")}, headers=H).status_code == 403


def test_upload_to_other_department_forbidden(app):
    doc = ("---\ntitle: Credit notes cheat sheet\ntopic: client-credit-notes\ncountry: BE\ndepartment: {dept}\n"
           "version: 1\nowner: X\neffective_date: 2026-01-01\n---\n## Key rules\n- Approval threshold: €9,000\n")
    r = client_for(app, "sofie").post(
        "/api/documents", files={"file": ("cn.md", doc.format(dept="finance").encode(), "text/markdown")}, headers=H)
    assert r.status_code == 403 and r.json()["detail"] == "You can't publish to the finance department."
    r = client_for(app, "noor").post(
        "/api/documents", files={"file": ("p.md", doc.format(dept="payroll").encode(), "text/markdown")}, headers=H)
    assert r.status_code == 403 and "payroll" in r.json()["detail"]
    r = client_for(app, "sofie").post(
        "/api/documents", files={"file": ("x.md", doc.format(dept="legal").encode(), "text/markdown")}, headers=H)
    assert r.status_code == 400
    # The finance doc is untouched and still the only one on its topic.
    docs = client_for(app, "admin").get("/api/documents?topic=client-credit-notes").json()
    assert [(d["id"], d["status"]) for d in docs] == [(FINANCE_DOC, "live")]


def test_upload_conflict_is_critical_and_blocked(app):
    c = client_for(app, "sofie")
    r = upload(c, "1-conflict-emailed-note-hoa-be.md")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "blocked" and body["document"]["status"] == "blocked"
    conflicts = [i for i in body["issues"] if i["rule"] == "conflict"]
    assert conflicts and conflicts[0]["level"] == "critical"
    assert conflicts[0]["new_value"] == "€130" and conflicts[0]["existing_value"] == "€150"
    assert conflicts[0]["other_document_id"] == "doc-hoa-be-v3"
    assert "€130" in conflicts[0]["message"] and "€150" in conflicts[0]["message"]
    created = datetime.fromisoformat(conflicts[0]["created_at"].replace("Z", "+00:00"))
    due = datetime.fromisoformat(conflicts[0]["due_at"].replace("Z", "+00:00"))
    assert due - created == timedelta(hours=24) and conflicts[0]["overdue"] is False
    pytest.conflict_doc = body["document"]["id"]
    pytest.conflict_issue = conflicts[0]["id"]


def test_dashboard_shows_blocked_upload(app):
    dash = _dash_matches_documents(client_for(app, "sofie"))
    assert dash["sources"][0]["blocked"] == pytest.sofie_upload_blocked + 1
    item = next(a for a in dash["activity"] if a["document_id"] == pytest.conflict_doc)
    assert item["kind"] == "uploaded" and item["outcome"] == "blocked" and item["source"] == "email"
    assert item["actor"] == "Sofie Claes" and item["id"].startswith("audit-")
    assert item["text"] == ("Sofie Claes uploaded 'Home-office allowance — note forwarded by email' from Email "
                            "→ blocked (critical conflict: €130 vs €150).")
    assert dash["activity"][0] == item  # newest first
    # daan (NL) never hears about it.
    assert pytest.conflict_doc not in str(client_for(app, "daan").get("/api/dashboard").json())


def test_chat_details_alternatives_provenance_graph(app):
    c = client_for(app, "sofie")
    r = c.post("/api/chat", json={"question": "What is the home-office allowance cap in Belgium?"}, headers=H)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["document"]["id"] == "doc-hoa-be-v3"
    assert body["answer_mode"] == "template"
    assert body["answer"].startswith("The monthly cap is €150.")
    assert body["answer"] == "The monthly cap is €150."  # source shown separately, not repeated
    assert body["document"]["source"] == "sharepoint" and body["document"]["department"] == "payroll"

    alts = {a["id"]: a for a in body["alternatives"]}
    v2 = alts["doc-hoa-be-v2"]
    assert v2["status"] == "superseded" and v2["reason"] == "Older version: replaced by v3 on 12 Aug 2026."
    assert v2["differs"] == [{"key": "monthly-cap", "value": "€140", "live_value": "€150"}]
    note = alts[pytest.conflict_doc]
    assert note["status"] == "blocked" and note["source"] == "email"
    assert note["source_detail"].startswith("Forwarded by Pieter Janssens")
    assert note["differs"] == [{"key": "monthly-cap", "value": "€130", "live_value": "€150"}]
    assert note["reason"].startswith("Blocked: says €130 but the live document says €150. Waiting for Lies Vermeulen (critical, due ")
    assert "Nobody" not in note["reason"]
    assert alts["doc-home-office-faq-be"]["status"] == "blocked"
    assert all(a["country"] in ("BE", "ALL") for a in body["alternatives"])
    assert "doc-hoa-be-v3" not in alts
    dates = [a["updated_at"] for a in body["alternatives"]]
    assert dates == sorted(dates, reverse=True)  # newest first

    prov = body["provenance"]
    assert prov["source"] == "sharepoint" and prov["uploaded_by"] == "Lies Vermeulen"
    detail = c.get("/api/documents/doc-hoa-be-v3").json()
    assert prov["sha256"] == detail["sha256"]
    kinds = [e["kind"] for e in prov["events"]]
    assert kinds[0] == "created" and "live" in kinds and "superseded_previous" in kinds
    assert [e["at"] for e in prov["events"]] == sorted(e["at"] for e in prov["events"])
    assert all({"at", "actor", "kind", "text"} <= set(e) for e in prov["events"])

    g = body["graph"]
    nodes = {n["id"]: n for n in g["nodes"]}
    assert nodes["doc-hoa-be-v3"]["role"] == "source"
    assert [n["id"] for n in g["nodes"] if n["role"] == "source"] == ["doc-hoa-be-v3"]
    assert nodes[pytest.conflict_doc]["role"] == "alternative"
    assert nodes["topic:home-office-allowance"]["role"] == "context"
    assert set(alts) <= set(nodes)
    assert all(n["type"] != "document" or n["id"] in alts or n["id"] == "doc-hoa-be-v3" for n in g["nodes"])
    edges = {(e["source"], e["target"], e["type"]) for e in g["edges"]}
    assert (pytest.conflict_doc, "doc-hoa-be-v3", "conflicts_with") in edges
    assert ("doc-hoa-be-v3", "doc-hoa-be-v2", "supersedes") in edges
    assert all(e["source"] in nodes and e["target"] in nodes for e in g["edges"])

    # The uploaded (blocked) note's own detail carries its fingerprint.
    up = c.get(f"/api/documents/{pytest.conflict_doc}").json()
    assert up["sha256"] == hashlib.sha256(up["content_md"].encode("utf-8")).hexdigest()
    src = (UPLOADS / "1-conflict-emailed-note-hoa-be.md").read_text(encoding="utf-8")
    assert up["sha256"] == hashlib.sha256(src.encode("utf-8")).hexdigest()


def test_daan_alternatives_never_include_be(app):
    c = client_for(app, "daan")
    for q in ("home office allowance amount", "holiday pay", "sick leave notification", "When is the payroll cut-off?"):
        body = c.post("/api/chat", json={"question": q}, headers=H).json()
        assert body["document"] is None or body["document"]["country"] in ("NL", "ALL"), q
        assert all(a["country"] in ("NL", "ALL") for a in body["alternatives"]), q
        ids = {n["id"] for n in body["graph"]["nodes"]}
        assert "country:BE" not in ids and not any("-be-" in i or i.endswith("-be") for i in ids), q
        assert "doc-hoa-be-v3" not in str(body), q


def test_graph_topic_map_and_drilldown(app):
    c = client_for(app, "lies")
    g = c.get("/api/graph").json()
    types = {n["type"] for n in g["nodes"]}
    assert "document" not in types and "person" not in types
    assert {"topic", "country", "department"} <= types
    topics = {n["id"]: n for n in g["nodes"] if n["type"] == "topic"}
    hoa = topics["topic:home-office-allowance"]
    assert hoa["doc_count"] >= 6 and hoa["open_issue_count"] >= 1 and hoa["trust"] == "red"
    assert "topic:client-credit-notes" not in topics
    edges = {(e["source"], e["target"], e["type"]) for e in g["edges"]}
    assert ("topic:home-office-allowance", "country:BE", "applies_to") in edges
    assert ("topic:home-office-allowance", "department:payroll", "belongs_to") in edges
    assert ("topic:sick-leave-reporting", "department:hr", "belongs_to") in edges

    d = c.get("/api/graph?topic=home-office-allowance").json()
    docs = {n["id"] for n in d["nodes"] if n["type"] == "document"}
    assert {"doc-hoa-be-v3", "doc-hoa-be-v2", "doc-hoa-nl-v1", pytest.conflict_doc} <= docs
    assert [n["id"] for n in d["nodes"] if n["type"] == "topic"] == ["topic:home-office-allowance"]
    covers = {e["source"] for e in d["edges"] if e["type"] == "covers"}
    assert covers == docs
    dedges = {(e["source"], e["target"], e["type"]) for e in d["edges"]}
    assert (pytest.conflict_doc, "doc-hoa-be-v3", "conflicts_with") in dedges
    assert c.get("/api/graph?topic=no-such-topic").status_code == 404
    admin = client_for(app, "admin").get("/api/graph").json()
    assert "topic:client-credit-notes" in {n["id"] for n in admin["nodes"]}


def test_missing_department_defaults_to_payroll(app):
    doc = ("---\ntitle: Company car — Belgium\ntopic: company-car\ncountry: BE\nowner: Lies Vermeulen\n"
           "effective_date: 2026-01-01\nversion: 1\n---\n## Key rules\n- Fuel card: allowed\n")
    body = client_for(app, "lies").post(
        "/api/documents", files={"file": ("car.md", doc.encode(), "text/markdown")}, headers=H).json()
    assert body["document"]["department"] == "payroll" and body["document"]["source"] == "upload"
    mm = [i for i in body["issues"] if i["rule"] == "missing-metadata"]
    assert mm and mm[0]["level"] == "low" and "department" in mm[0]["message"]


def test_upload_duplicate(app):
    r = upload(client_for(app, "sofie"), "2-duplicate-meal-vouchers-be.md")
    body = r.json()
    assert body["outcome"] == "blocked"
    assert {"duplicate", "stale-version"} <= rules_of(body["issues"])
    assert "conflict" not in rules_of(body["issues"])
    pytest.duplicate_issue = next(i["id"] for i in body["issues"] if i["rule"] == "duplicate")


def test_upload_new_version_goes_live_and_supersedes(app):
    c = client_for(app, "lies")
    body = upload(c, "3-new-version-mobility-budget-be.md").json()
    assert body["outcome"] == "superseded_previous", body
    assert body["issues"] == []
    doc = body["document"]
    assert doc["status"] == "live" and doc["version"] == 2
    assert c.get("/api/documents/doc-mobility-budget-be-v1").json()["status"] == "superseded"
    history = c.get(f"/api/documents/{doc['id']}").json()["history"]
    assert [(h["version"], h["status"]) for h in history] == [(2, "live"), (1, "superseded")]
    assert doc["updated_by"] == "Lies Vermeulen"


def test_consultant_new_version_needs_owner_approval(app):
    """A consultant can't silently replace a live rule by bumping the version and
    typing someone else's name into the front-matter."""
    src = (UPLOADS.parent / "docs" / "hoa-be-v3.md").read_text(encoding="utf-8")
    forged = (src.replace("version: 3", "version: 4").replace("Monthly cap: €150", "Monthly cap: €100")
              .replace("change_summary: ", "change_summary: Lowered cap. ", 1))
    c = client_for(app, "sofie")
    r = c.post("/api/documents", files={"file": ("hoa-be-v4.md", forged.encode(), "text/markdown")}, headers=H)
    body = r.json()
    assert body["outcome"] == "blocked", body
    assert "conflict" in rules_of(body["issues"])
    assert body["document"]["updated_by"] == "Sofie Claes"  # the uploader, not the name in the file
    assert c.get("/api/documents/doc-hoa-be-v3").json()["status"] == "live"
    answer = c.post("/api/chat", json={"question": "What is the home-office allowance cap in Belgium?"}, headers=H).json()
    assert answer["document"]["id"] == "doc-hoa-be-v3" and "€150" in answer["answer"]


def test_upload_missing_metadata_low_but_live(app):
    assert upload(client_for(app, "lies"), "4-missing-metadata-parental-leave.md").status_code == 403  # company-wide -> admin only
    body = upload(client_for(app, "admin"), "4-missing-metadata-parental-leave.md").json()
    assert body["outcome"] == "live" and body["document"]["status"] == "live"
    assert [(i["rule"], i["level"]) for i in body["issues"]] == [("missing-metadata", "low")]


# ---------------------------------------------------------------- chat + receipts

def test_chat_returns_live_doc_and_verifiable_receipt(app):
    c = client_for(app, "sofie")
    r = c.post("/api/chat", json={"question": "What is the monthly cap for the home-office allowance in Belgium?"}, headers=H)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["document"]["id"] == "doc-hoa-be-v3"
    assert "€150" in body["answer"]
    assert {"key": "monthly-cap", "value": "€150"} in body["matched_claims"]
    rid = body["receipt"]["id"]
    v = c.get(f"/api/receipts/{rid}/verify").json()
    assert v["valid"] is True and v["receipt"]["document_id"] == "doc-hoa-be-v3"
    # Another user cannot read it; tampering breaks it.
    assert client_for(app, "daan").get(f"/api/receipts/{rid}/verify").status_code == 404
    conn = sqlite3.connect(os.environ["VERITY_DB"])
    conn.execute("UPDATE receipts SET answer = 'tampered' WHERE id = ?", (rid,))
    conn.commit()
    conn.close()
    assert c.get(f"/api/receipts/{rid}/verify").json()["valid"] is False


def test_chat_scope_and_no_match(app):
    daan = client_for(app, "daan")
    body = daan.post("/api/chat", json={"question": "home office allowance amount"}, headers=H).json()
    assert body["document"] is None or body["document"]["country"] in ("NL", "ALL")
    assert body["document"]["id"] == "doc-hoa-nl-v1"
    none = daan.post("/api/chat", json={"question": "zebra quantum spaceship"}, headers=H).json()
    assert none["document"] is None and none["receipt"]["id"]
    cutoff = daan.post("/api/chat", json={"question": "When is the payroll cut-off?"}, headers=H).json()
    assert cutoff["document"]["id"] == "doc-payroll-cutoff-all-v1" and "20th" in cutoff["answer"]


# ---------------------------------------------------------------- resolve

def test_consultant_cannot_resolve(app):
    r = client_for(app, "sofie").post(
        f"/api/issues/{pytest.conflict_issue}/resolve", json={"resolution": "accept_new", "note": "ok"}, headers=H)
    assert r.status_code == 403


def test_owner_out_of_scope_and_note_required(app):
    lies = client_for(app, "lies")
    assert lies.post(f"/api/issues/{pytest.duplicate_issue}/resolve",
                     json={"resolution": "keep_existing", "note": "  "}, headers=H).status_code == 422
    assert lies.post("/api/issues/iss-nope/resolve", json={"resolution": "keep_existing", "note": "x"}, headers=H).status_code == 404


def test_owner_resolves_keep_existing(app):
    lies = client_for(app, "lies")
    body = lies.post(f"/api/issues/{pytest.duplicate_issue}/resolve",
                     json={"resolution": "keep_existing", "note": "Copy of the live guidance."}, headers=H).json()
    assert body["document"]["status"] == "rejected" and body["issue"]["status"] == "resolved"
    assert body["document"]["open_issue_count"] == 0


def test_owner_resolves_accept_new(app):
    lies = client_for(app, "lies")
    r = lies.post(f"/api/issues/{pytest.conflict_issue}/resolve",
                  json={"resolution": "accept_new", "note": "Client-specific cap confirmed."}, headers=H)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["issue"]["status"] == "resolved" and body["issue"]["resolution"] == "accept_new"
    assert body["document"]["status"] == "live" and body["document"]["open_issue_count"] == 0
    assert lies.get("/api/documents/doc-hoa-be-v3").json()["status"] == "superseded"
    again = lies.post(f"/api/issues/{pytest.conflict_issue}/resolve",
                      json={"resolution": "accept_new", "note": "x"}, headers=H)
    assert again.status_code == 409
    actions = [a["action"] for a in lies.get("/api/audit").json()]
    assert "resolve:accept_new" in actions and "resolve:keep_existing" in actions


def test_dashboard_resolution_activity(app):
    acts = client_for(app, "lies").get("/api/dashboard").json()["activity"]
    resolved = [a for a in acts if a["kind"] == "resolved"]
    accepted = next(a for a in resolved if a["document_id"] == pytest.conflict_doc)
    assert accepted["text"] == ("Lies Vermeulen accepted the new version of 'Home-office allowance — note forwarded "
                                "by email' (note: Client-specific cap confirmed).")
    assert accepted["outcome"] == "live"
    kept = next(a for a in resolved if "kept the existing version of" in a["text"])
    assert kept["text"].startswith("Lies Vermeulen kept the existing version of '") and kept["outcome"] is None
    assert kept["text"].endswith("(note: Copy of the live guidance).")
    assert not any(a["kind"] in ("imported",) or "login" in a["text"] for a in acts)


def test_unknown_api_route_is_json_404(app):
    r = client_for(app, "sofie").get("/api/nope")
    assert r.status_code == 404 and r.json() == {"detail": "Not found."}


# ---------------------------------------------------------------- LLM path (mocked; no network)

def test_openai_compatible_provider(app, monkeypatch):
    import httpx

    import llm_client

    monkeypatch.setenv("LLM_PROVIDER", "openai-compatible")
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.example.test/v1/")
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODEL", "test-model")
    seen = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        seen.update(url=url, json=json, headers=headers, timeout=timeout)
        return httpx.Response(200, json={"choices": [{"message": {"content": "Report it within 24 hours."},
                                                      "finish_reason": "stop"}]})

    monkeypatch.setattr(httpx, "post", fake_post)
    assert llm_client.llm_enabled()
    c = client_for(app, "sofie")
    body = c.post("/api/chat", json={"question": "sick leave notification deadline"}, headers=H).json()
    assert body["answer"] == "Report it within 24 hours." and body["answer_mode"] == "ai"
    assert seen["url"] == "https://llm.example.test/v1/chat/completions"
    assert seen["headers"]["Authorization"] == "Bearer test-key" and seen["json"]["model"] == "test-model"
    assert seen["timeout"] == 30.0 and seen["json"]["temperature"] == 0.0 and seen["json"]["max_tokens"] == 120
    assert "Sick-leave reporting" in seen["json"]["messages"][1]["content"]

    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(500, json={"error": "down"}))
    body = c.post("/api/chat", json={"question": "sick leave notification deadline"}, headers=H).json()
    assert body["answer_mode"] == "template" and body["answer"].startswith("The notification deadline is")


def test_llm_answer_used_and_falls_back(app, monkeypatch):
    import llm_client

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-not-real")
    calls = []

    def fake_ok(system, user, max_tokens=1024, **kw):
        calls.append(user)
        return "Notify the employer within 24 hours of the start of the absence."

    monkeypatch.setattr(llm_client, "complete", fake_ok)
    c = client_for(app, "sofie")
    body = c.post("/api/chat", json={"question": "sick leave notification deadline"}, headers=H).json()
    assert body["answer"] == "Notify the employer within 24 hours of the start of the absence." and "note" in body
    assert body["answer_mode"] == "ai"
    assert "Sick-leave reporting" in calls[0] and "Netherlands" not in calls[0]  # only the chosen in-scope doc

    def fake_fail(system, user, max_tokens=1024, **kw):
        raise llm_client.LLMTransient("timeout")

    monkeypatch.setattr(llm_client, "complete", fake_fail)
    body = c.post("/api/chat", json={"question": "sick leave notification deadline"}, headers=H).json()
    assert body["answer_mode"] == "template"
    assert body["answer"].startswith("The notification deadline is")
    assert c.get(f"/api/receipts/{body['receipt']['id']}/verify").json()["valid"] is True


# ---------------------------------------------------------------- grounding + quotes (mocked LLM)

SICK_Q = "What is the medical certificate deadline for sick leave in Belgium?"


def test_grounded_ai_answer_is_kept(app, monkeypatch):
    import llm_client

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-not-real")
    prompts = []

    def fake(system, user, max_tokens=1024, temperature=None):
        prompts.append((system, user, max_tokens, temperature))
        return "The medical certificate is due within 2 working days."

    monkeypatch.setattr(llm_client, "complete", fake)
    c = client_for(app, "sofie")
    body = c.post("/api/chat", json={"question": SICK_Q}, headers=H).json()
    live = body["document"]["id"]
    assert live == "doc-sick-leave-be-v1"
    assert body["answer_mode"] == "ai" and body["answer"] == "The medical certificate is due within 2 working days."
    system, user, max_tokens, temperature = prompts[0]
    assert max_tokens == 120 and temperature == 0.0 and "1-2 plain sentences" in system
    # Only title, version, matched claims and quotes: never the whole document.
    content = c.get(f"/api/documents/{live}").json()["content_md"]
    assert "Medical certificate deadline: within 2 working days" in user
    assert "## Purpose" not in user and "Netherlands" not in user and len(user) < len(content) / 2


def test_hallucinated_number_falls_back_to_template(app, monkeypatch):
    import llm_client

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test-not-real")
    c = client_for(app, "sofie")
    for bad in ("The certificate is due within 2 working days and costs €175.", "Within 48 hours.", "",
                "One. Two. Three. Four sentences here."):
        monkeypatch.setattr(llm_client, "complete", lambda *a, _bad=bad, **k: _bad)
        body = c.post("/api/chat", json={"question": SICK_Q}, headers=H).json()
        assert body["answer_mode"] == "template", bad
        assert body["note"] == "AI answer didn't match the document, so it's shown as written in the source.", bad
        assert body["answer"].startswith("The medical certificate deadline is within 2 working days."), bad
        assert "€175" not in body["answer"] and "48" not in body["answer"], bad


def test_quotes_are_verbatim(app):
    c = client_for(app, "sofie")
    for q in ("What is the home-office allowance cap in Belgium?", "sick leave notification deadline",
              "meal voucher face value", "When is the payroll cut-off?"):
        body = c.post("/api/chat", json={"question": q}, headers=H).json()
        assert body["document"], q
        content = c.get(f"/api/documents/{body['document']['id']}").json()["content_md"]
        assert body["quotes"], q
        for quote in body["quotes"]:
            assert set(quote) == {"text", "section"} and quote["text"] in content, (q, quote)
        assert sum(1 for x in body["quotes"] if x["section"].lower() != "key rules") <= 2
    # The quote carries the actual rule even when the best-matching claim misses the point.
    body = c.post("/api/chat", json={"question": "Who pays for the first days of sick leave?"}, headers=H).json()
    assert any("paid by the employer for the first 30 days" in x["text"] for x in body["quotes"]), body["quotes"]
    body = c.post("/api/chat", json={"question": "sick leave notification deadline"}, headers=H).json()
    assert {"text": "Notification deadline: within 24 hours of the start of absence", "section": "Key rules"} in body["quotes"]
    none = c.post("/api/chat", json={"question": "zebra quantum spaceship"}, headers=H).json()
    assert none["quotes"] == [] and none["answer_mode"] == "template"


def test_grounding_compares_numbers_not_strings():
    from chat import is_grounded, numeric_tokens

    assert numeric_tokens("16,500 16.500 16500 €2.40 2,40 01") == {"16500", "2.4", "1"}
    src = (UPLOADS.parent / "docs" / "hoa-be-v3.md").read_text(encoding="utf-8")
    doc = {"title": "Home-office allowance — Belgium", "content_md": src}
    assert is_grounded("The cap is €150 per month from August 1, 2026.", doc)  # reformatted date
    assert is_grounded("It rose from €140 to €150.", doc)
    assert not is_grounded("The cap is €175 per month.", doc)
    assert not is_grounded("The cap is €150 from August 2, 2026.", doc)
    assert not is_grounded("   ", doc)


def test_grounding_rejects_answer_without_the_given_fact():
    """Seen live with the local model: a fluent answer that states no fact at all ("covered by the
    employee's health insurance") passed the number check. It must repeat a number from the facts."""
    from chat import is_grounded

    src = (UPLOADS.parent / "docs" / "sick-leave-be-v1.md").read_text(encoding="utf-8")
    doc = {"title": "Sick-leave reporting — Belgium", "content_md": src}
    facts = "3 per calendar year Guaranteed salary is paid by the employer for the first 30 days"
    bad = "The first days of sick leave are typically covered by the employee's health insurance."
    good = "The employer pays guaranteed salary for the first 30 days of sick leave."
    assert not is_grounded(bad, doc, facts)
    assert is_grounded(good, doc, facts)
    assert is_grounded("The owner is Pieter Janssens.", doc, "Pieter Janssens")  # no numbers given: not required


def test_identical_file_is_rejected_by_fingerprint(app):
    """Dropping the same file twice must not create a second blocked copy: the fingerprint already exists."""
    c = client_for(app, "lies")
    first = upload(c, "2-duplicate-meal-vouchers-be.md")
    assert first.status_code in (200, 409), first.text  # may already exist from an earlier test
    again = upload(c, "2-duplicate-meal-vouchers-be.md")
    assert again.status_code == 409 and "already in Verity" in again.json()["detail"], again.text
