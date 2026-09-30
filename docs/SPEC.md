# Verity: build spec and status

**As of 30 Sep 2026 · commit `1ad2588` and later on `main`.** This document says what we set out to build, what is
built, where each piece lives, and how to verify it. It is written so a reviewer (human or AI) can check every claim
against the code. Claims point to files; section 9 lists commands with expected results.

Verity is our entry for the SD Worx challenge "Unlock the Knowledge Within" (Tectonic Hackathon; judged 30% originality,
30% technical ability, 30% fit to the case, 10% security, with an Aikido scan). Tagline: **One subject. One source.
Always the latest.**

---

## 1. The problem and our answer

SD Worx's own story: a consultant gets a client question. Search returns several documents (one recently updated,
one with no owner, one for another country) and a colleague forwards something different by email. The information
exists, but nobody knows which version to trust.

Verity fixes this in two places:

1. **At the door (upload).** Every new document is compared, rule by rule, with the live document on the same topic,
   country and department. Clashes become issues with a severity and an SLA deadline. A document with an open critical
   or high issue is blocked: it can't be used in answers until its owner decides.
2. **At the question (chat).** The answer comes from the single live document the person is allowed to see. It shows
   the exact lines it came from, the other documents found and why they weren't used, how the source became the
   source (who, when, from where, what the check found), and a signed receipt.

The AI runs **on-premise** (a small open model in its own container), so documents and questions never go to a
third-party AI provider. The rules, not the AI, decide what is true. The AI only rewords facts, and a grounding check
guards it.

---

## 2. Aimed vs built

The plan lives in [`CONTRACT.md`](../CONTRACT.md) (v1, then a v2 addendum). Status of every item:

| # | Aimed | Status | Where |
|---|---|---|---|
| 1 | Knowledge space: topics, one live doc per topic/country, trust colour, open-issue counts | Built | `api/main.py` `/api/topics`; `web/src/pages/knowledge.tsx` |
| 2 | Upload with deterministic checks (6 rules, SLA levels) | Built | `api/checks.py`, `api/ingest.py`; `web/src/pages/upload.tsx` |
| 3 | Owner decision: accept new / keep existing, note required, audited | Built | `/api/issues/{id}/resolve` in `api/main.py`; `web/src/pages/issues.tsx` |
| 4 | Chat answer from one live, in-scope document, with signed receipt | Built | `api/chat.py`, `api/crypto_helpers.py` |
| 5 | Document page: rendered doc, metadata, version history, claims, issues | Built | `web/src/pages/document.tsx`, `web/src/components/verity/markdown.tsx` |
| 6 | Graph of topics, documents, people, countries | Built, then redesigned (#11) | `web/src/pages/graph.tsx` |
| 7 | Login, roles, per-country scope enforced in SQL | Built | `api/auth.py`, `api/queries.py`, `api/db.py` |
| 8 | Security baseline (see §6) | Built | `api/main.py`, `api/auth.py` |
| 9 | Answer **Details**: source, how it became the source, other documents + why not used, receipt, answer graph | Built (v2) | `api/answer_details.py`; `web/src/components/verity/answer.tsx`, `web/src/components/graph/answer-graph.tsx` |
| 10 | Department access (Payroll / HR / Finance) as a second scope | Built (v2) | `api/queries.py`, `api/db.py`; seed `client-credit-notes-be-v1.md` |
| 11 | Graph that scales: topic map by default, drill-down per topic | Built (v2) | `/api/graph`, `/api/graph?topic=`; `web/src/pages/graph.tsx` |
| 12 | Sources + fingerprints (email, SharePoint, Drive, Git, Teams; SHA-256) | Built (v2) | `documents.source/source_detail/sha256`; `SourceBadge`, `Fingerprint` in `badges.tsx` |
| 13 | On-premise AI for answer wording + grounding check + verbatim quotes | Built (v2) | `docker-compose.yml` service `llm`; `api/llm_client.py`, `api/chat.py` |
| 14 | Consultants can't silently publish over a live rule; "updated by" = real uploader | Built (fix) | `api/ingest.py`, `api/checks.py` |
| 15 | Real connectors (Gmail, Slack, GitHub, Notion, SharePoint, Drive, Teams) | **Not built**: shown as "Coming soon" on the dashboard; documents carry an origin label from front-matter | brief: "Many sources, one door" |
| 16 | PDF / image upload | **Not built** (only `.md`, `.txt`) | `api/main.py` `ALLOWED_EXTENSIONS` |
| 17 | Aikido scan + fixes | Done: 1 real finding (Docker root) fixed; SQL injection, nanoid and file-inclusion findings assessed as false positives with evidence. `npm audit` 0, `pip-audit` 0 | §6 |
| 18 | Cloud deployment | **Pending** (target not chosen) | |
| 19 | Audit-log screen | **Not built** (API `/api/audit` exists, owner/admin only) | |
| 20 | Ask as a centred, T3-style home; conversation thread; no topic grid on home | Built (v3) | `web/src/pages/ask.tsx` |
| 21 | Library page: topic grid + search + country/department/trust filters | Built (v3) | `web/src/pages/library.tsx` |
| 22 | Live Dashboard: "many sources, one door" flow, only Upload live (drop zone), other connectors shown as Coming soon, activity feed, health | Built (v3) | `api/dashboard.py`, `/api/dashboard`; `web/src/pages/dashboard.tsx`, `web/src/components/dashboard/*` |
| 23 | Re-uploading an identical file is rejected by fingerprint (409) | Built | `api/main.py` upload route |

---

## 3. Architecture

```
Browser ──HTTP :3000──► app container (python:3.12-slim, non-root)
                         ├─ FastAPI  /api/*   (api/)
                         ├─ serves the built React app at /   (web/dist)
                         └─ SQLite   /app/data/verity.db (named volume verity-data)
                                 │
                                 └─HTTP (internal network only)──► llm container (ollama/ollama:0.5.7)
                                                                   qwen2.5:1.5b-instruct, no host port
```

- **Compose project `verity`**: services `app` and `llm`, plus volume `llm-models` (`docker-compose.yml`).
  The `llm` service pulls the model on first start (~1 GB). The app works without it: answers fall back to quoting.
- **Backend** (`api/`, Python 3.12, FastAPI, stdlib `sqlite3`, parameterised SQL only):

  | file | role |
  |---|---|
  | `main.py` | app, routes, security middleware, SPA serving |
  | `db.py` | schema (v2; an older DB is moved aside as `*.bak` and re-seeded), helpers |
  | `auth.py` | scrypt passwords, server-side sessions, login rate limiter, role checks |
  | `queries.py` | the scoped queries: country **and** department filter in SQL |
  | `checks.py` | deterministic rules engine + SLA |
  | `extract.py` | front-matter parsing, `## Key rules` claim parser (LLM extraction opt-in) |
  | `ingest.py` | upload → claims → checks → outcome |
  | `chat.py` | retrieval, claim matching, quotes, template answer, LLM answer, grounding, receipt |
  | `answer_details.py` | alternatives, provenance events, answer graph |
  | `llm_client.py` | Anthropic or OpenAI-compatible (Ollama) client, 30 s timeout |
  | `crypto_helpers.py` | Ed25519 key + signing (key generated at `data/keys/`) |
  | `seed.py` | loads `seed/docs/*.md` with version chains, runs checks over live docs |
  | `dashboard.py` | scoped dashboard: totals, sources, issues, topics, activity feed |
  | `test_smoke.py` | 41 tests |

- **Frontend** (`web/`, React 18 + Vite 6 + TypeScript + Tailwind + Radix/shadcn-style components + Framer Motion +
  Cytoscape; React Router 7). All API calls go through `web/src/lib/api.ts`.
- **Data model** (`api/db.py`): `users`, `sessions`, `topics`, `documents`, `claims`, `issues`, `receipts`,
  `audit_log`. Documents carry `country`, `department`, `status` (`live` | `blocked` | `superseded` | `rejected`),
  `version`, `supersedes_id`, `source`, `source_detail`, `sha256`.

---

## 4. How the core works

### 4.1 Upload check (`api/checks.py`)

A document's rules come from its `## Key rules` list (`- Key: value`). Keys are normalised to kebab-case, and values
are compared after normalising case and whitespace. Checks run only against live documents of the same topic,
compatible country (same, or either is `ALL`) and the **same department**.

| rule | level | SLA | fires when |
|---|---|---|---|
| `conflict` | critical | 24 h | same key, different value vs the live doc. A higher version with a change summary counts as an update, **but only when uploaded by an owner/admin**. From a consultant it is a critical conflict that needs the owner's approval |
| `duplicate` | high | 72 h | every rule already exists with the same value in the live doc, and it isn't a higher version |
| `no-owner` | high | 72 h | owner missing |
| `stale-version` | medium | 7 d | version ≤ the live version for the same topic/country |
| `review-overdue` | medium | 7 d | `review_by` in the past |
| `missing-metadata` | low | 30 d | country, effective date or department missing (defaults: country `ALL`, department `payroll`) |

Outcome: an open critical/high issue → `blocked`. Otherwise it goes live, and a lower live version of the same
topic/country/department becomes `superseded`. Owner resolution: `accept_new` (new doc live, old superseded) or
`keep_existing` (new doc `rejected`). A note is required, and every decision is written to `audit_log`.
`updated_by`/`updated_at` of an upload are always the signed-in uploader and today, never the file's front-matter.

### 4.2 Answer pipeline (`api/chat.py`, `api/answer_details.py`)

1. **Retrieve**: keyword scoring (stop-words removed) over title, topic, claims and content of **live, in-scope**
   documents only. Below `MIN_SCORE` → "no trusted document", with a pointer to the topic owner.
2. **Match claims**: pick the rule(s) whose key best matches the question.
3. **Quotes**: verbatim excerpts. These are the matched claim lines, plus the rule sentence containing the value.
   If there is none, it adds the body sentence that best matches the question (never from Purpose/Contact). Every
   quote is an exact substring of the document.
4. **Template answer** (always computed): e.g. "The monthly cap is €150."
5. **AI wording** (if the model is reachable): the model gets the question, title/version, matched claims and quotes
   only. Settings: temperature 0, 120 tokens, 1–2 sentences.
6. **Grounding check** before an AI answer is used:
   - 1–3 sentences, non-empty.
   - every number in the answer appears in the document (compared as numbers: "1 August 2026" ≈ "August 1, 2026").
   - if the given facts contain numbers, the answer repeats at least one of them. This guard was added after a live
     test where the model invented "covered by health insurance" for sick leave.

   If any check fails, the template answer is shown with a note.
7. **Details**: `alternatives` (other in-scope docs on the topic, with status, a one-sentence reason and differing
   values), `provenance` (source, fingerprint, events: created → checked/flagged → resolved → live →
   superseded previous), `graph` (5–15 nodes; `role: source | alternative | context`).
8. **Receipt**: Ed25519 signature over canonical JSON `{user, question, answer, document_id, version, created_at}`.
   Verify via `/api/receipts/{id}/verify`, which only the receipt's own user or an admin can call.

### 4.3 API (all under `/api`, JSON, errors `{detail}`)

`GET /health` · `POST /auth/login` · `POST /auth/logout` · `GET /me` · `GET /topics` · `GET /documents` ·
`GET /documents/{id}` · `POST /documents` (multipart) · `GET /issues?status=open|resolved|all` ·
`POST /issues/{id}/resolve` · `POST /chat` · `GET /receipts/{id}/verify` · `GET /graph[?topic=]` ·
`GET /audit` (owner/admin) · `GET /dashboard`. Response shapes: `CONTRACT.md` plus the v2 addendum, and the TS types in
`web/src/lib/api.ts`.

---

## 5. Screens (`web/src/pages/`)

| screen | route | what's on it |
|---|---|---|
| Login | `/login` | username/password; one-click demo users (sofie, daan, lies, noor, admin); safe `next` redirect |
| Ask | `/` | centred greeting + ask box + department-aware examples; after the first question a conversation thread with the box docked at the bottom and "New chat"; each answer has mode label, quotes, source line, receipt chip, **Details** (4 cards left, answer graph right, hover-linked) |
| Library | `/library` | topic cards with trust dots and live documents; search; filters for country, department, trust |
| Dashboard | `/dashboard` | stat tiles; live "many sources, one door" flow: Upload (the only live connector, also a drop zone) → the Verity check → Live / Blocked → Answers, with a moving dot per upload; Gmail, Slack, GitHub, Notion, SharePoint, Drive, Teams shown faded as "Coming soon" (no numbers); activity feed; health; polls every 3 s |
| Document | `/documents/:id` | safe markdown render (no `dangerouslySetInnerHTML`), status banner, metadata, source + fingerprint, version history, claims, issues |
| Upload | `/upload` | drag-drop/picker (.md/.txt, 200 KB); outcome banner; issue cards with level, SLA countdown, "live says / yours says" |
| Review queue | `/issues` | grouped by level, open/resolved tabs; owners resolve with a required note; consultants read-only |
| Graph | `/graph` | topic map (size = doc count, colour = trust, country and department nodes), click → `?topic=` drill-down with breadcrumb; side panel |

Shell: top bar (logo, tagline, user, role, country + department chips, theme toggle, sign out), sidebar (Ask, Library,
Dashboard, Upload, Review queue with open count, Graph). Light and dark themes.

---

## 6. Security (10% of the score, plus the Aikido scan)

| control | where | verified by |
|---|---|---|
| scrypt password hashes; demo password from env `DEMO_PASSWORD` | `auth.py` | `test_login_*` |
| Server-side sessions, 32-byte token stored as a SHA-256 hash, 8 h TTL; cookie `verity_session` HttpOnly, SameSite=Lax, Secure when `COOKIE_SECURE=1` | `auth.py`, `main.py` | `test_login_ok_sets_httponly_cookie` |
| Every route except login/health requires a session | `main.py` | `test_unauthenticated_401` |
| Country **and** department scope in the SQL (not filtered afterwards); out-of-scope id → 404 | `queries.py` | `test_nl_consultant_cannot_see_be_docs`, `test_sofie_cannot_see_finance_doc`, `test_noor_sees_finance_but_not_payroll` |
| Alternatives, answer graph and issue cross-references never reveal out-of-scope docs | `answer_details.py`, `main.py` | `test_daan_alternatives_never_include_be` |
| Roles: only owner/admin resolve; only owner/admin publish a new version directly; audit log owner/admin only | `main.py`, `ingest.py` | `test_consultant_cannot_resolve`, `test_consultant_new_version_needs_owner_approval`, `test_consultant_cannot_read_audit` |
| Upload: .md/.txt only, ≤ 200 KB, UTF-8, country + department must be in the uploader's scope (ALL = admin) | `main.py` | `test_upload_validation`, `test_upload_to_other_department_forbidden` |
| CSRF guard: state-changing routes require `X-Requested-With: verity` | `main.py` | `test_csrf_header_required` |
| Login rate limit: 10 failed attempts / 5 min per username | `auth.py` | `test_login_rate_limited` |
| Headers: CSP (inline theme script allowed by hash), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Permissions-Policy` | `main.py` | `test_health_and_security_headers` |
| No stack traces to clients; JSON 404 for unknown API routes | `main.py` | `test_unknown_api_route_is_json_404` |
| Open-redirect-safe login `next` (rejects `//`, `\`, control chars, other origins) | `web/src/lib/auth.tsx` `safeNext` | manual cases (commit `1ad2588`) |
| On-premise AI: `llm` has no host port; the prompt only contains the one in-scope document's facts | `docker-compose.yml`, `chat.py` | compose file; `test_openai_compatible_provider` |
| App container runs as non-root: `USER verity` (uid 10001), `cap_drop: ALL`, `no-new-privileges`; code read-only to the app user; data in a named volume | `Dockerfile`, `docker-compose.yml` | Aikido IaC finding resolved |
| Dependencies: `npm audit` → 0 vulnerabilities; `pip-audit` → none known | `web/package.json`, `api/requirements.txt` | §9 |
| No secrets in the repo: `.env` git-ignored, `.env.example` only, signing key generated at runtime in `data/` (ignored) | `.gitignore` | |

---

## 7. Demo content and script

- `seed/docs/`: 13 fictional documents, 7 topics (home-office allowance BE v1–v3 + NL, an unowned old FAQ, meal
  vouchers, sick leave BE/NL, payroll cut-off ALL, mobility budget, holiday pay BE (review overdue)/NL, client credit
  notes BE (finance)). All amounts, codes and people are fictional.
- `seed/uploads/` (see its README): 1 emailed note (€130 vs €150 → critical conflict, blocked), 2 duplicate meal
  vouchers (blocked), 3 mobility budget v2 (owner upload → live, supersedes v1), 4 parental leave with no
  country/date (admin → live with a low flag).
- Demo users: `sofie` (consultant BE, payroll+hr), `daan` (consultant NL), `lies` (owner payroll+hr), `noor` (owner
  finance), `admin`. Password `verity-demo`.
- Video script: `docs/verity.html` → "Demo video script".

---

## 8. Known gaps and honest limitations

1. **Retrieval is keyword-based**, not semantic. Questions phrased very differently from the document may miss it,
   or pick a neighbouring rule. The quotes make a mismatch visible.
2. **The grounding check is heuristic.** It catches invented numbers and answers that state no given fact. It can't
   catch a wrong sentence that reuses a correct number. The verbatim quotes under every answer are the real safeguard.
3. **The small model (1.5B) is CPU-bound.** Answers take ~2–7 s in Docker on an M4. The first answer after start is slower.
4. **Conflicts are detected per rule key.** The same rule written under a different key (e.g. "Max cap" vs
   "Monthly cap") is not caught unless LLM extraction (opt-in) maps it to an existing key.
5. **Topic names are shared across departments.** A payroll user who uploads into a finance topic's slug would see
   that topic's display name. No finance document, value or count leaks, and checks/superseding stay within their
   own department.
6. **Sessions and the login rate limiter live in one process** (SQLite sessions, in-memory limiter). Run a single
   worker. Not built for horizontal scale.
7. **SLA due times in reason text are UTC.** The UI countdowns use local time.
8. **No real connectors and no PDF parsing.** Sources are labels from front-matter.
9. **No audit-log screen and no user management UI.** Users are seeded.
10. **Signing key and database are local files in `data/`.** No key rotation or backup story.
11. **The CSP allows inline styles** (`style-src 'unsafe-inline'`), which Framer Motion and Cytoscape need. Scripts are
    locked down (`script-src 'self'` + one hash). A scanner may still flag the style directive.

---

## 9. How to verify (for the reviewer)

```bash
git clone https://github.com/syedmouaazfarrukh/verity && cd verity

# 1. Backend tests — expect "41 passed"
cd api && uv run --python 3.12 --with-requirements requirements.txt pytest -q && cd ..

# 2. Web build + dependency audit — expect "✓ built" and "found 0 vulnerabilities"
cd web && npm ci && npm run build && npm audit && cd ..
uvx --python 3.12 pip-audit -r api/requirements.txt     # expect "No known vulnerabilities found"

# 3. Run it — http://localhost:3000 (first start downloads the ~1 GB model)
docker compose up -d --build
```

Manual checks (each maps to a claim above):

1. Sign in as **sofie** and ask "What is the monthly home-office allowance cap?".
   - Expect €150 from "Home-office allowance — Belgium v3", the label "Worded by local AI · checked against the
     document", quoted lines, and "Signed receipt · verified".
   - Open **Details**: the Source, "How it became the source" (SharePoint, fingerprint, 4 events), and "Other
     documents" (v2 and v1 superseded, the old FAQ blocked at €129.48 vs €150). The answer graph highlights v3.
2. Upload `seed/uploads/1-conflict-emailed-note-hoa-be.md` as sofie → **Blocked**, critical conflict €130 vs €150,
   Email badge. Ask again → the emailed note appears under "Other documents" as blocked.
3. Sign in as **lies** → Review queue → Keep existing with a note → the note is marked rejected, and the audit entry
   is recorded.
4. As lies, upload `3-new-version-mobility-budget-be.md` → Live; v1 superseded. As sofie, uploading a higher version
   with a changed value is blocked for owner approval (`test_consultant_new_version_needs_owner_approval`).
5. Sign in as **daan**, ask "What's the home-office allowance?" → the Dutch rule (€2.40/day); no BE documents in Details.
6. Sign in as **noor** → the "Client credit notes" topic is visible. As **sofie**, `GET
   /api/documents/doc-client-credit-notes-be-v1` → 404, and the topic is absent from the topics, graph and chat.
7. Graph page opens on the topic map; clicking a topic drills in; the breadcrumb goes back.
8. `curl -I localhost:3000/api/health` shows the security headers listed in §6.

---

## 10. UI map (for the look-and-feel pass)

- **Design tokens**: `web/src/styles/globals.css` (HSL CSS variables for light and dark: `--background`,
  `--primary` indigo, `--ok`/`--warn`/`--danger` + `-foreground`/`-tint` for trust states, `--radius`),
  wired in `web/tailwind.config.ts`. Fonts: Inter + JetBrains Mono (`@fontsource`, imported in `main.tsx`).
  Original design principles: `docs/postura-design-system.md`.
- **Shell**: `components/layout/{app-shell,topbar,sidebar}.tsx`. Logo: `components/verity/logo.tsx`.
- **Answer (hero)**: `components/verity/answer.tsx` (`AnswerBlock`: bubble, quotes, source line, Details panel and
  its cards) and `components/graph/answer-graph.tsx` (source highlight, dimming, hover link).
- **Shared bits**: `components/verity/badges.tsx` (`LevelBadge`, `StatusBadge`, `TrustDot`, `CountryChip`,
  `DepartmentChip`, `SourceBadge`, `Fingerprint`, `SlaCountdown`), `issue-card.tsx`, `states.tsx`, `markdown.tsx`.
- **Graph styling**: `components/graph/node-styles.ts` (Cytoscape stylesheet) + `cytoscape-graph.tsx`.
- **Primitives**: `components/ui/*` (button, card, badge, dialog, sheet, dropdown, tooltip, skeleton, separator).
- **Offline UI work**: `VITE_MOCK=1 npm run dev` runs the whole UI against `web/src/lib/mock.ts` without the backend.
