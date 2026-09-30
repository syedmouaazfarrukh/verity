"""Question -> best live, in-scope document -> short answer + signed receipt."""

from __future__ import annotations

import logging
import re
import secrets
import sqlite3
from datetime import date
from typing import Any

import llm_client
from crypto_helpers import canonical_json, sha256_hex, sign
from db import iso, now_utc, scope_sql
from extract import normalise_key

log = logging.getLogger("verity.chat")

STOP_WORDS = set("""
a an and are as at be been but by can could do does did for from has have how i if in into is it its
me my of on or our should so than that the their them then there these they this to up us was we what
when where which who whom why will with would you your about any also get got just need know tell please
much many per there's what's whats hi hello verity doc document documents guidance policy rule rules
""".split())
COUNTRY_WORDS = {
    "belgium": "BE", "belgian": "BE", "netherland": "NL", "netherlands": "NL", "dutch": "NL",
    "holland": "NL", "nl": "NL", "france": "FR", "french": "FR", "germany": "DE", "german": "DE",
}
MIN_SCORE = 4


def tokens(text: str) -> set[str]:
    out = set()
    for t in re.findall(r"[a-z0-9]+", (text or "").lower()):
        if len(t) > 3 and t.endswith("s") and not t.endswith("ss"):
            t = t[:-1]
        if len(t) >= 2 and t not in STOP_WORDS:
            out.add(t)
    return out


def _label(key: str) -> str:
    s = key.replace("-", " ")
    return s[:1].upper() + s[1:]


def _fmt_date(d: str | None) -> str:
    if not d:
        return "unknown date"
    try:
        p = date.fromisoformat(d[:10])
        return f"{p.day} {p.strftime('%b %Y')}"
    except ValueError:
        return d


def score_document(q: set[str], doc: dict[str, Any], claims: list[dict[str, str]]) -> tuple[int, bool]:
    """Returns (score, strong_hit). Each question token counts once at its best weight."""
    title = tokens(doc["title"])
    topic = tokens(doc["topic_name"]) | tokens(doc["topic_id"])
    claim_toks = set()
    for c in claims:
        claim_toks |= tokens(c["key"]) | tokens(c["value"])
    content = tokens(doc["content_md"])
    score, strong = 0, False
    for t in q:
        if t in COUNTRY_WORDS:
            continue
        if t in title or t in topic:
            score += 3
            strong = True
        elif t in claim_toks:
            score += 2
            strong = True
        elif t in content:
            score += 1
    mentioned = {COUNTRY_WORDS[t] for t in q if t in COUNTRY_WORDS}
    if mentioned:
        if doc["country"] in mentioned:
            score += 4
        elif doc["country"] != "ALL":
            score -= 4
    return score, strong


def best_document(conn: sqlite3.Connection, user: dict[str, Any], question: str, live_only: bool = True):
    clause, params = scope_sql(user)
    status_sql = "d.status = 'live' AND " if live_only else ""
    rows = conn.execute(
        f"""SELECT d.*, t.name AS topic_name FROM documents d JOIN topics t ON t.id = d.topic_id
            WHERE {status_sql}{clause}""",
        params,
    ).fetchall()
    q = tokens(question)
    best = None
    for r in rows:
        doc = dict(r)
        claims = [dict(c) for c in conn.execute(
            "SELECT key, value FROM claims WHERE document_id = ? ORDER BY id", (doc["id"],)).fetchall()]
        score, strong = score_document(q, doc, claims)
        if not strong or score < MIN_SCORE:
            continue
        # Tie-break: higher score, then the user's own country over ALL, then most recent.
        rank = (score, doc["country"] in user["countries"] and doc["country"] != "ALL", doc.get("updated_at") or "")
        if best is None or rank > best[0]:
            best = (rank, doc, claims)
    if best is None:
        return None, []
    return best[1], best[2]


def matched_claims(question: str, claims: list[dict[str, str]], doc: dict[str, Any] | None = None) -> list[dict[str, str]]:
    """Claims the question is about. Key matches win ("cap" -> monthly-cap); words that only
    name the topic ("home office allowance") don't count, or every claim would match."""
    q = tokens(question) - set(COUNTRY_WORDS)
    if doc:
        q -= tokens(doc["title"]) | tokens(doc.get("topic_name", "")) | tokens(doc.get("topic_id", ""))
    for field in ("key", "value"):
        scored = [(len(tokens(c[field]) & q), c) for c in claims]
        best = max((n for n, _ in scored), default=0)
        if best:
            return [c for n, c in scored if n == best][:4]
    return claims[:3]


# ---------------------------------------------------------------- verbatim quotes

_SECTION = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$")
_BULLET_PREFIX = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9€\"'(])")


def _body_lines(content_md: str) -> list[tuple[str, str]]:
    """(section heading, line) for every non-heading body line, front-matter skipped."""
    lines = content_md.splitlines()
    start = 0
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                start = i + 1
                break
    out, section = [], ""
    for line in lines[start:]:
        m = _SECTION.match(line)
        if m:
            section = m.group(1).strip()
            continue
        if line.strip():
            out.append((section, line))
    return out


def _claim_quotes(doc: dict[str, Any], matched: list[dict[str, str]]) -> list[dict[str, str]]:
    """Verbatim excerpts of `doc` that support the answer: the matched claim lines, plus at most
    one body sentence containing a matched value. Every `text` is a substring of content_md."""
    content = doc["content_md"]
    body = _body_lines(content)
    quotes: list[dict[str, str]] = []
    seen: set[str] = set()

    def add(text: str, section: str) -> None:
        text = text.strip()
        if text and text not in seen and text in content:
            seen.add(text)
            quotes.append({"text": text, "section": section})

    for c in matched:
        for section, line in body:
            item = _BULLET_PREFIX.sub("", line, count=1).strip()
            if ":" in item and normalise_key(item.split(":", 1)[0]) == c["key"] and c["value"] in item:
                add(item, section)
                break
    for c in matched:
        for section, line in body:
            if section.lower() == "key rules" or c["value"] not in line:
                continue
            text = _BULLET_PREFIX.sub("", line, count=1).strip()
            sentence = next((snt for snt in _SENTENCE_END.split(text) if c["value"] in snt), None)
            if sentence:
                add(sentence, section)
                return quotes
    return quotes


_IRREGULAR = {"paid": "pay", "pays": "pay", "paying": "pay"}


def _overlap_tokens(text: str) -> set[str]:
    return {_IRREGULAR.get(t, t) for t in tokens(text)}


def quotes_for(doc: dict[str, Any], matched: list[dict[str, str]], question: str = "") -> list[dict[str, str]]:
    """Claim quotes, plus the body sentence that best matches the question (>= 2 shared words).
    The matched claim alone can miss the point ("who pays for the first days" matched
    "certificate-free days"), so the sentence gives the model and the reader the actual rule."""
    quotes = _claim_quotes(doc, matched)
    q = _overlap_tokens(question)
    # Only when no rule sentence is quoted yet: otherwise it just adds noise.
    if not q or any(x["section"].lower() != "key rules" for x in quotes):
        return quotes
    best, best_score, best_section = None, 1, ""
    for section, line in _body_lines(doc["content_md"]):
        if section.lower() in ("key rules", "purpose", "contact"):
            continue
        text = _BULLET_PREFIX.sub("", line, count=1).strip()
        for snt in _SENTENCE_END.split(text):
            score = len(q & _overlap_tokens(snt))
            if score > best_score and snt.strip() in doc["content_md"]:
                best, best_score, best_section = snt.strip(), score, section
    if best and all(best != x["text"] and best not in x["text"] for x in quotes):
        quotes.append({"text": best, "section": best_section})
    return quotes


# ---------------------------------------------------------------- answers

def _join(parts: list[str]) -> str:
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


def template_answer(doc: dict[str, Any], claims: list[dict[str, str]]) -> str:
    """Deterministic answer that reads like one, e.g. "The monthly cap is €150."
    The source (title, version, who, when) travels next to it in `document`, so it isn't repeated here."""
    facts = [f"the {_label(c['key']).lower()} is {c['value'].rstrip('.')}" for c in claims[:3]]
    if not facts:
        return f"{doc['title']} (v{doc['version']}) covers this; open the document for the details."
    sentence = _join(facts)
    return f"{sentence[:1].upper()}{sentence[1:]}."


# Tested with qwen2.5:1.5b-instruct at temperature 0 (small local model): keep it short and literal.
_SYSTEM = (
    "You answer a consultant's question using ONLY the facts given. Reply in 1-2 plain sentences. "
    "No preamble, no advice, no facts that are not listed. Copy amounts exactly as written."
)
LLM_MAX_TOKENS = 120
UNGROUNDED_NOTE = "AI answer didn't match the document, so it's shown as written in the source."
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
_SENTENCES = re.compile(r"[.!?]+(?:\s|$)")


def llm_prompt(question: str, doc: dict[str, Any], matched: list[dict[str, str]],
               quotes: list[dict[str, str]]) -> str:
    """Only the title, version, matched claims and quotes: small, and nothing else to hallucinate from."""
    facts = [f"{_label(c['key'])}: {c['value']}" for c in matched]
    facts += [q["text"] for q in quotes if q["text"] not in facts]
    lines = "\n".join(f"- {f}" for f in facts) or "- (none)"
    return f"Question: {question}\nDocument: {doc['title']} (v{doc['version']})\nFacts:\n{lines}"


def _norm_number(tok: str) -> str:
    """"16,500" / "16.500" / "16500" -> "16500"; "2.40" / "2,40" -> "2.4"; "01" -> "1".
    A separator followed by exactly 3 digits is a thousands separator, otherwise a decimal point."""
    parts = re.split(r"[.,]", tok)
    int_part, dec = parts[0], ""
    for p in parts[1:]:
        if len(p) == 3 and not dec:
            int_part += p
        else:
            dec += p
    int_part = int_part.lstrip("0") or "0"
    dec = dec.rstrip("0")
    return f"{int_part}.{dec}" if dec else int_part


def numeric_tokens(text: str) -> set[str]:
    return {_norm_number(m.group(0)) for m in _NUMBER.finditer(text)}


def is_grounded(answer: str, doc: dict[str, Any], facts: str = "") -> bool:
    """Every numeric token in the answer (amounts, percentages, dates, codes) must be among the
    numeric tokens of the used document (title + content_md), compared as numbers, not strings,
    so "1 August 2026" -> "August 1, 2026" passes and "€175" fails. Also 1-3 sentences, non-empty."""
    if not answer.strip():
        return False
    if len([s for s in _SENTENCES.split(answer.strip()) if s.strip()]) > 3:
        return False
    said = numeric_tokens(answer)
    if not said <= numeric_tokens(f"{doc['title']}\n{doc['content_md']}"):
        return False
    # A small model can "answer" without stating the fact it was given (e.g. inventing who pays).
    # If the facts carry numbers, the answer must repeat at least one of them.
    given = numeric_tokens(facts)
    return not given or bool(said & given)


def llm_answer(question: str, doc: dict[str, Any], matched: list[dict[str, str]],
               quotes: list[dict[str, str]]) -> str:
    text = llm_client.complete(_SYSTEM, llm_prompt(question, doc, matched, quotes),
                               max_tokens=LLM_MAX_TOKENS, temperature=0.0)
    return re.sub(r"\s+", " ", text).strip()[:1200]


def make_receipt(conn: sqlite3.Connection, username: str, question: str, answer: str,
                 document_id: str | None, version: int | None) -> dict[str, Any]:
    created_at = iso(now_utc())
    payload = {
        "user": username, "question": question, "answer": answer,
        "document_id": document_id, "version": version, "created_at": created_at,
    }
    body = canonical_json(payload)
    receipt = {
        "id": "rcpt-" + secrets.token_hex(8),
        "signature_b64": sign(body),
        "payload_sha256": sha256_hex(body),
        "created_at": created_at,
    }
    conn.execute(
        """INSERT INTO receipts (id, user, question, answer, document_id, document_version,
             payload_sha256, signature_b64, created_at) VALUES (?,?,?,?,?,?,?,?,?)""",
        (receipt["id"], username, question, answer, document_id, version,
         receipt["payload_sha256"], receipt["signature_b64"], created_at),
    )
    return receipt


def receipt_payload(row: sqlite3.Row) -> bytes:
    return canonical_json({
        "user": row["user"], "question": row["question"], "answer": row["answer"],
        "document_id": row["document_id"], "version": row["document_version"], "created_at": row["created_at"],
    })


def answer_question(conn: sqlite3.Connection, user: dict[str, Any], question: str) -> dict[str, Any]:
    doc, claims = best_document(conn, user, question)
    note = None
    answer_mode = "template"
    if doc is None:
        fallback, _ = best_document(conn, user, question, live_only=False)
        if fallback and fallback.get("owner"):
            answer = (
                f"I couldn't find a trusted live document that answers this. "
                f"Ask {fallback['owner']}, the owner of {fallback['topic_name']}."
            )
        else:
            answer = (
                "I couldn't find a trusted live document that answers this among the documents you can access. "
                "Ask the topic owner, or upload the guidance so Verity can check it."
            )
        note = "No live, in-scope document matched the question."
        matched: list[dict[str, str]] = []
        quotes: list[dict[str, str]] = []
    else:
        matched = matched_claims(question, claims, doc)
        quotes = quotes_for(doc, matched, question)
        answer = template_answer(doc, matched)
        if llm_client.llm_enabled():
            try:
                ai = llm_answer(question, doc, matched, quotes)
            except Exception as e:  # noqa: BLE001 — logged, never returned to the client
                log.warning("LLM answer failed, using template: %s", e)
            else:
                facts = " ".join([c["value"] for c in matched] + [q["text"] for q in quotes])
                if is_grounded(ai, doc, facts):
                    answer, answer_mode = ai, "ai"
                    note = f"Answer written by {llm_client.model_name()} from this document only."
                else:
                    log.warning("LLM answer not grounded in %s, using template: %r", doc["id"], ai[:200])
                    note = UNGROUNDED_NOTE
    receipt = make_receipt(conn, user["username"], question, answer,
                           doc["id"] if doc else None, doc["version"] if doc else None)
    result = {"answer": answer, "answer_mode": answer_mode, "document_id": doc["id"] if doc else None,
              "matched_claims": matched, "quotes": quotes, "receipt": receipt}
    if note:
        result["note"] = note
    return result
