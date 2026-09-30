# Verity — build contract (source of truth for all agents)

Verity = SD Worx hackathon entry. Company-wide knowledge space where every topic has ONE live document.
New uploads are checked against existing docs; conflicts are flagged with an SLA level; a chat answers
questions by pointing to the single latest live document and showing what changed, when, by whom.

Time budget: ~2 hours total. Keep it simple. Working > clever.

## Repo layout (root = /Users/mouaazfarrukh/Documents/TH-CLAUDE)

```
api/            FastAPI backend (Python 3.12). Serves /api/* and, in production, the built web app.
  main.py       app + routes
  db.py         SQLite schema + helpers (file: data/verity.db, recreated + seeded on startup if missing)
  checks.py     conflict / SLA rules engine (deterministic; pattern ported from Postura mapper/engine.py)
  extract.py    claim extraction: LLM (Anthropic) with deterministic fallback parser
  chat.py       question -> best live document + one-line answer
  auth.py       login, sessions, scope checks
  crypto_helpers.py  (copied from Postura) Ed25519 signing for answer receipts
  llm_client.py      (copied from Postura) provider-swappable LLM client
  seed.py       loads seed/docs/*.md into the DB with version history
  requirements.txt
web/            React 18 + Vite + TS + Tailwind + shadcn-style components (copied from Postura UI, rebrand to Verity)
seed/docs/      fictional company policy documents (markdown with front-matter), some with version history
seed/uploads/   demo files to upload live during the video (one conflict, one duplicate, one clean, one missing-metadata)
Dockerfile      single image: builds web, runs api which serves web/dist at /
docker-compose.yml  one service `verity` on port 3000
```

Local dev: `cd api && uv run --python 3.12 uvicorn main:app --reload --port 8000` and `cd web && npm run dev` (vite on 3000, proxies /api -> 8000).
Docker: `docker compose up --build` -> http://localhost:3000.

## Document format (seed + uploads)

Markdown with YAML front-matter:

```markdown
---
title: Home-office allowance — Belgium
topic: home-office-allowance        # slug; topic display name derived or given by `topic_name`
topic_name: Home-office allowance
country: BE                         # BE | NL | FR | DE | ALL
owner: Lies Vermeulen
effective_date: 2026-08-01
review_by: 2027-08-01
version: 3
updated_by: Lies Vermeulen
updated_at: 2026-08-12
change_summary: Monthly cap raised from €140 to €150 after 2026 indexation.
---

# Home-office allowance — Belgium
...prose...

## Key rules
- Monthly cap: €150
- Eligibility: structural home work, at least 1 day per week
- Payslip code: 1250
```

The `## Key rules` bullet list (`- Key: value`) is the deterministic fallback for claim extraction.
With an LLM key present, extract.py asks the LLM for the same shape from the full text (JSON: [{key, value}]),
normalises keys to lowercase-kebab (e.g. `monthly-cap`), and falls back to the parser on any error.
Front-matter fields may be missing in uploads — missing ones become issues, never crashes.

## Data model (SQLite)

- users(id, username, display_name, role, countries_csv, password_hash)
  - roles: `consultant` (read + upload + chat), `owner` (also resolves issues), `admin` (everything)
- topics(id slug PK, name)
- documents(id TEXT PK e.g. "doc-hoa-be-v3", topic_id, title, country, owner, status, version, content_md,
  effective_date, review_by, updated_by, updated_at, change_summary, supersedes_id, uploaded_by, created_at)
  - status: `live` | `blocked` (has open critical/high issue) | `superseded` | `rejected`
- claims(id, document_id, topic_id, country, key, value)
- issues(id, document_id, other_document_id NULL, rule, level, message, new_value, existing_value,
  status open|resolved, created_at, due_at, resolved_by, resolved_at, resolution, resolution_note)
- receipts(id, user, question, answer, document_id, document_version, payload_sha256, signature_b64, created_at)
- audit_log(id, at, username, action, target)

## Rules engine (checks.py) — runs on every upload, returns issues

| rule | level | fires when | SLA |
|---|---|---|---|
| `conflict` | critical | same topic + same country (or either is ALL) + same claim key, different value vs the LIVE doc | 24h |
| `duplicate` | high | every claim of the new doc equals a claim in the live doc of same topic/country, but it's a different document and not a higher version | 72h |
| `no-owner` | high | owner missing/empty | 72h |
| `stale-version` | medium | new doc's version <= live doc's version for same topic+country (older copy uploaded) | 7d |
| `review-overdue` | medium | review_by in the past | 7d |
| `missing-metadata` | low | country or effective_date missing | 30d |

Outcome: any open critical/high -> doc status `blocked` (not used by chat). Otherwise, if a live doc exists for
the same topic+country with a lower version, the new doc becomes `live` and the old becomes `superseded`
(supersedes_id set; history kept). Otherwise the new doc becomes `live`.
Resolving: owner/admin chooses `accept_new` (new doc goes live, old superseded, remaining issues on that doc resolved)
or `keep_existing` (new doc `rejected`). A note is required. Both written to audit_log.

`due_at = created_at + SLA`. The UI shows countdown and marks overdue in red.

## Security (graded — Aikido checks IDOR / authz / authn / business logic)

- Passwords hashed (hashlib.scrypt or bcrypt). Demo users seeded; passwords from env `DEMO_PASSWORD` (default `verity-demo`, documented in README).
- Session: random 32-byte token in server-side table/dict, cookie `verity_session` HttpOnly, SameSite=Lax, Secure when `COOKIE_SECURE=1`. 8h expiry. Logout deletes it.
- EVERY /api route except /api/auth/login and /api/health requires a session.
- Country scope: a user only sees documents/claims/issues/graph nodes where document.country in user.countries or country == ALL. Enforced in the SQL query, not after. Accessing an out-of-scope id returns 404 (not 403) to avoid leaking existence.
- Chat retrieval only considers `live` docs in scope. The LLM prompt only ever contains in-scope live docs.
- Upload: only .md/.txt, max 200 KB, UTF-8; uploader must have the doc's country in scope (else 403); ALL-country docs only by admin.
- Resolve: only role owner/admin AND doc in scope.
- State-changing routes require header `X-Requested-With: verity` (simple CSRF guard); the web client always sends it.
- Login rate limit: 10 attempts / 5 min per username (in memory).
- No secrets in repo. `.env.example` only. LLM key read from env `ANTHROPIC_API_KEY`.
- Security headers middleware: X-Content-Type-Options nosniff, X-Frame-Options DENY, Referrer-Policy same-origin, basic CSP.
- Markdown rendered safely on the client (no raw HTML injection: use a sanitising renderer or render as text + simple formatting).

## Demo users (seed)

| username | name | role | countries |
|---|---|---|---|
| `sofie` | Sofie Claes | consultant | BE |
| `daan` | Daan de Vries | consultant | NL |
| `lies` | Lies Vermeulen | owner | BE,NL,ALL |
| `admin` | Admin | admin | BE,NL,FR,DE,ALL |

## API (all JSON, prefix /api)

- `GET /health` -> `{ok:true}`
- `POST /auth/login` `{username,password}` -> `{user}` + cookie. 401 `{detail}` on failure.
- `POST /auth/logout` -> `{ok:true}`
- `GET /me` -> `{username, display_name, role, countries:[...]}`
- `GET /topics` -> `[{id, name, live_documents:[{id,title,country,version,updated_at,updated_by}], open_issues:{critical,high,medium,low}, trust:"green"|"amber"|"red"}]`
  - trust: red if any open critical, amber if any open high/medium, else green
- `GET /documents?topic=&country=&status=` -> `[DocumentSummary]`
  - DocumentSummary = `{id,title,topic_id,topic_name,country,owner,status,version,updated_at,updated_by,change_summary,open_issue_count}`
- `GET /documents/{id}` -> `DocumentSummary + {content_md, effective_date, review_by, claims:[{key,value}], history:[{id,version,status,updated_at,updated_by,change_summary}], issues:[Issue]}`
  - history = the whole chain for same topic+country, newest first
- `POST /documents` multipart `file` -> `{document: DocumentSummary, issues:[Issue], outcome:"live"|"blocked"|"superseded_previous"}`
- `GET /issues?status=open` -> `[Issue]`
  - Issue = `{id, document_id, document_title, other_document_id, other_document_title, rule, level, message, new_value, existing_value, status, created_at, due_at, overdue:bool, resolved_by, resolution, resolution_note}`
- `POST /issues/{id}/resolve` `{resolution:"accept_new"|"keep_existing", note}` -> `{issue, document}`
- `POST /chat` `{question}` -> `{answer, document: DocumentSummary|null, matched_claims:[{key,value}], receipt:{id, signature_b64, payload_sha256, created_at}, note?}`
  - If nothing live+in-scope matches: `document:null`, answer says no trusted document found and suggests the topic owner.
  - Answer is 1–3 sentences, must only use the chosen document. Deterministic fallback when no LLM key: keyword overlap on title/topic/claims -> answer = "According to <title> (v<version>, updated <date> by <who>): <matching claims>".
- `GET /receipts/{id}/verify` -> `{valid:bool, receipt}`
- `GET /graph` -> `{nodes:[{id,label,type:"topic"|"document"|"person"|"country",status?,trust?}], edges:[{id,source,target,type:"covers"|"owned_by"|"applies_to"|"supersedes"|"conflicts_with"}]}` (scoped)
- `GET /audit?limit=50` -> admin/owner only

All errors: `{detail: string}` with a proper status code.

## Web app (screens)

Brand: **Verity** — "One subject. One source. Always the latest." Reuse Postura's look (tokens, shell, shadcn components, Cytoscape graph).

1. `/login` — username + password, demo-user quick-pick chips (fills username only).
2. `/` Knowledge space — chat box at the top ("Ask Verity…"), answer card below it showing: one-line answer,
   the source document card (title, version, updated when/by whom, change summary, "Open document"), receipt id + "verified" tick.
   Below: grid of topics with trust colour, live doc(s), open issue counts.
3. `/documents/:id` — rendered document, metadata sidebar (owner, version, effective, review-by), version history timeline
   (what changed, when, by whom), claims list, open issues on it.
4. `/upload` — drag/drop or pick a file -> shows result: outcome banner + issue list with level badge, SLA due + countdown,
   side-by-side "Existing says / New says" for conflicts, link to the conflicting doc.
5. `/issues` — review queue grouped by level with SLA countdowns; owner/admin can resolve (accept new / keep existing + note).
6. `/graph` — Cytoscape graph of topics, documents, people, countries; red edges for conflicts; click node -> small side panel.
Top bar: user name, role, countries, logout. Sidebar: Knowledge, Upload, Issues, Graph.

---

# v2 addendum (approved 30 Sep 2026) — overrides v1 where they differ

Five additions, in priority order. Keep everything in v1 working; all 23 existing tests must still pass (update test file
names/expectations only where this addendum changes behaviour).

## Already changed since v1 (don't undo)
- Upload: `updated_by`/`updated_at` are always the signed-in uploader and today, never the file's front-matter.
- A higher-version upload with changed values only goes live directly when the uploader is `owner`/`admin`; from a
  consultant it's a critical `conflict` ("Proposes changing … needs the topic owner's approval") → blocked → owner resolves.
- Demo upload 1 is now `seed/uploads/1-conflict-emailed-note-hoa-be.md` (was `1-conflict-teams-note-hoa-be.md`).
- Login chips sign in with one click. Docker compose project is `verity`, service `app`.

## A. Answer with details (the hero)

`POST /chat` response keeps every v1 field and adds:

```jsonc
{
  "answer_mode": "ai" | "template",
  // Other in-scope documents on the SAME topic (same country, or ALL) that were NOT used, newest first.
  // NEVER include anything outside the user's countries AND departments — not even a count.
  "alternatives": [
    { "id", "title", "country", "version", "status",            // live|blocked|superseded|rejected
      "updated_at", "updated_by", "source", "source_detail",
      "reason": "Older version: replaced by v3 on 12 Aug 2026.", // one plain-English sentence
      "differs": [{ "key", "value", "live_value" }] }           // claims whose value differs from the used doc
  ],
  // How the used document became the single source of truth, oldest first.
  "provenance": {
    "source": "upload", "source_detail": "", "sha256": "…", "uploaded_by": "Lies Vermeulen",
    "events": [ { "at": "ISO", "actor": "Lies Vermeulen", "kind": "created|checked|flagged|resolved|live|superseded_previous",
                  "text": "Checked against 3 documents on this topic: no conflicts." } ]
  },
  // Small graph of just this answer (≈5–15 nodes): topic, used doc, alternatives, owner(s), country.
  "graph": { "nodes": [{ "id","label","type","status?","role": "source"|"alternative"|"context" }],
             "edges": [{ "id","source","target","type" }] }   // types as in /graph
}
```
Reason examples: superseded → "Older version: replaced by v3 on 12 Aug 2026."; blocked with open conflict →
"Blocked: says €130 but the live document says €150. Waiting for Lies Vermeulen (critical, due 1 Oct 14:00)."; rejected →
"Rejected by Lies Vermeulen on …: <note>"; blocked no-owner → "Blocked: nobody owns this document."
Events for seed docs: synthesise from front-matter + chain (created by updated_by at updated_at; "replaced v2").
Events for uploads: from created_at, issues found (checked/flagged), resolutions (resolved, with note), and status changes.
When `document` is null: alternatives/provenance/graph are empty/null.

Template answer (no LLM) must read like an answer, not a dump: lead with the matched claim(s) in a sentence, e.g.
"The monthly cap is €150. (Home-office allowance — Belgium, v3, updated 12 Aug 2026 by Lies Vermeulen.)"

LLM: keep Anthropic. Additionally support an OpenAI-compatible endpoint via env `LLM_PROVIDER=openai-compatible`,
`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` (httpx POST {base}/chat/completions). Same 15s timeout + fallback.

### UI (Knowledge page)
Question box on top. Answer renders like an AI reply: the one-line answer in a message bubble, small source line
("From Home-office allowance — Belgium · v3 · Lies Vermeulen · 12 Aug 2026"), receipt chip, and a **Details** button.
Details expands (animated) a two-column panel under the answer:
- Left (cards, stacked): **Source** (doc card + Open document), **How it became the source** (vertical timeline of
  provenance events, source badge e.g. "Email · Forwarded by Pieter Janssens", short sha256 "fingerprint a1b2c3…"),
  **Other documents we found — and why we didn't use them** (one row per alternative: status badge, title, version,
  reason, "differs" as `€130 vs €150`), receipt details.
- Right: **answer graph** (reuse Cytoscape) — the source doc node highlighted (accent ring, full opacity); its direct
  path (topic, owner, country) normal; everything else dimmed (~35% opacity); conflict edges red. Hovering a card row
  highlights its node and vice versa. Stack columns on narrow screens.
Topic grid stays below.

## B. Department access (second scope dimension)

- `documents.department` (front-matter `department:`; values `payroll` | `hr` | `finance`; missing → `payroll` + a
  `missing-metadata` low issue listing "department").
- `users.departments_csv`. `/me` and login `user` gain `departments: [...]`.
- Scope everywhere (documents, claims, issues, topics, graph, chat retrieval, alternatives, receipts, audit) =
  country in scope (or ALL) **AND** department in user's departments. Enforced in SQL. Out of scope → 404 / absent.
  Topics with no in-scope docs are not listed. Issues whose other doc is out of scope: hide as today.
- Upload: department must be in the uploader's departments, else 403 "You can't publish to the <dept> department."
- Users: sofie consultant BE [payroll, hr]; daan consultant NL [payroll, hr]; lies owner BE,NL,ALL [payroll, hr];
  **new** `noor` — Noor El Amrani, owner, BE,NL,ALL, [finance]; admin all countries, [payroll, hr, finance].
- Seed departments: hoa*, home-office-faq, meal-vouchers, mobility-budget, holiday-pay, payroll-cutoff → payroll;
  sick-leave* → hr. **New seed doc** `seed/docs/client-credit-notes-be-v1.md`: topic client-credit-notes "Client credit
  notes", BE, department finance, owner Noor El Amrani, ~200 words, key rules e.g. Approval threshold: €5,000; Approver:
  finance controller; Booking code: CN-400; Deadline: within 5 working days. Sofie must never see it (tests).
- Demo uploads: add `department:` to all four (1–3 payroll, 4 hr).
- UI: top bar shows department chips next to country chips; login chip for noor ("Finance owner").

## C. Graph that scales

- `GET /graph` (no params) → **topic map**: one node per in-scope topic (label, trust, doc_count, open_issue_count),
  country nodes, department nodes; edges topic→country (`applies_to`), topic→department (`belongs_to`).
- `GET /graph?topic=<id>` → that topic's documents (all statuses in scope), owners, countries, supersedes and
  conflicts_with edges (as v1 /graph but filtered to one topic).
- UI: graph page opens on the topic map (topic nodes sized by doc_count, coloured by trust); click a topic → drills
  into its documents (breadcrumb "All topics / Home-office allowance" to go back); side panel as today.

## D. Sources and fingerprints

- `documents.source` (`upload` | `email` | `google-drive` | `sharepoint` | `git` | `teams`; default `upload`),
  `documents.source_detail` (free text), `documents.sha256` (hex of content_md bytes). From front-matter on upload/seed.
- DocumentSummary gains `source`, `source_detail`, `department`; DocumentDetail gains `sha256`.
- UI: source badge on document page + answer details + upload result; fingerprint shown short with full value on hover.

## E. UI polish pass
After A–D: consistent spacing, empty/loading states, no Postura leftovers, answer panel looks great at 1280×800 and
1440×900 in light and dark mode.

---

# v3 addendum (approved 30 Sep 2026): centred Ask home, Library, live Dashboard

Keep everything in v1/v2 working; all existing tests must still pass.

## A. Navigation
Sidebar order: **Ask** (`/`) · **Library** (`/library`) · **Dashboard** (`/dashboard`) · Upload · Review queue · Graph.

## B. Ask (home, `/`), like opening a new T3 chat
- Empty state: vertically and horizontally centred column (max ~720px): logo mark, "Hi Sofie, what do you need to
  know?", one-line subtitle, the ask box, 3–4 example questions (department-aware, as today). Nothing else on screen.
- After the first question: the page becomes a conversation thread for this session (question bubble → answer block,
  newest at the bottom, auto-scroll), and the ask box docks at the bottom of the viewport. Existing AnswerBlock +
  Details panel are reused unchanged. "New question" / clear-thread button in the header of the thread.
- No topic grid on this page any more.

## C. Library (`/library`)
The topic grid moves here unchanged in look, plus: a search box (title/topic), filters for country, department and
trust (green/amber/red), and a count ("7 topics · 13 documents"). Uses the existing `/api/topics` (+ `/api/documents`
if needed). Empty state when filters match nothing.

## D. Dashboard (`/dashboard`): the "many sources, one door" diagram, live, with real numbers

### API
`GET /api/dashboard` (any signed-in user; **every number and event is scoped** to the user's countries AND
departments, enforced in SQL like everything else):
```jsonc
{
  "totals": { "documents": 13, "live": 9, "blocked": 1, "superseded": 3, "rejected": 0 },
  "sources": [   // ALWAYS all 7, in this order: upload, email, sharepoint, google-drive, notion, git, teams
    { "id": "email", "label": "Email", "status": "live" | "demo" | "not_connected",
      "documents": 2, "live": 0, "blocked": 1, "last_at": "ISO" | null, "demo_import": true }
  ],
  "issues": { "open": { "critical": 1, "high": 1, "medium": 2, "low": 0 }, "overdue": 0,
              "next_due": { "id", "document_id", "document_title", "level", "due_at" } | null },
  "topics": { "green": 5, "amber": 1, "red": 1 },
  "activity": [  // newest first, max 25, scoped; plain-English one-liners
    { "id": "…", "at": "ISO", "actor": "Sofie Claes", "kind": "published|uploaded|blocked|live|resolved|superseded|imported",
      "text": "Sofie Claes uploaded 'Home-office allowance — note forwarded by email' from Email → blocked (critical conflict: €130 vs €150).",
      "document_id": "doc-…" | null, "source": "email" | null, "outcome": "live" | "blocked" | null }
  ],
  "generated_at": "ISO"
}
```
- Source status: `upload` → `"live"` (it's the real ingestion path). Any other source with ≥1 in-scope document →
  `"demo"` (documents tagged with that origin in front-matter). A source with none → `"not_connected"`.
  `demo_import` is true only for `email`.
- Activity comes from real data: `audit_log` upload/resolve/import entries (joined to documents so scope applies), plus
  one synthetic "published" event per seed document (at its `updated_at`, actor `updated_by`). Never login/chat events.
- Add `notion` to the allowed sources. Tag seed `mobility-budget-be-v1.md` as `source: notion`,
  `source_detail: "Payroll wiki / Mobility budget"`, so Notion has a real (demo) count.

`POST /api/connectors/email/demo-import` (CSRF header required; any role, but the normal upload scope rules apply —
the note is BE/payroll, so sofie/lies/admin can, daan/noor get 403):
- Ingests `seed/uploads/1-conflict-emailed-note-hoa-be.md` through the **normal ingest path** as the signed-in user
  (same checks, same outcome), audit action `import:email:<outcome>`.
- If a document with the same sha256 already exists (any status) → 409 `{detail:"Already imported: <title>."}`.
- Returns the same shape as `POST /documents`. Any other `/api/connectors/{x}/demo-import` → 404.

### UI
Layout (1280×800 must look great, light + dark):
1. **Header row**: title "Dashboard", subtitle "Every document passes through one check before anyone can rely on it.",
   and a small live indicator ("Live · updated 3s ago"; poll `/api/dashboard` every 3 s while the tab is visible).
2. **Stat tiles** (4): Documents · Live · Blocked · Open issues (with the next deadline countdown). Colour only for
   meaning (green live, red blocked).
3. **The flow** (hero, full width): left column = 7 **source cards** with brand marks (Upload icon; Gmail-style mark for
   Email; SharePoint, Google Drive, Notion, GitHub, Microsoft Teams marks as small inline SVGs in
   `components/verity/brand-icons.tsx`, no new dependency), each showing count + status pill ("Live" green, "Demo
   source" neutral, "Not connected" muted/dashed). Email card has an **"Import demo inbox"** button (calls the endpoint,
   toast + result). Middle = **"One door: the Verity check"** node listing what it checks (source + uploader,
   fingerprint, rules per country, department access). Right = **Live** (green, count) and **Blocked** (red, count),
   then a small **"Answers"** node (Chat · Copilot · search). SVG/CSS connectors between them, with source lines
   thickness/opacity by count; not-connected sources draw dashed, faint lines.
   **Motion**: when a new activity item with an outcome appears, animate a dot from its source card → the door →
   Live or Blocked (≈1.5 s), then pulse the target count. Respect `prefers-reduced-motion`.
4. **Bottom row**: **Activity feed** (latest events, relative time, outcome badge, click → document) and a compact
   **Health** card (open issues by level, overdue count, topics green/amber/red, link to Review queue).
Mark demo honesty clearly: a footnote "Upload is live. Other sources show documents tagged with their origin;
connectors are on the roadmap."

## v3.1 change (user decision, overrides section D above): no fake connectors
- **Only Upload is a real connector.** Everything else is shown as **"Coming soon"**: visually blurred/faded, no
  counts, no numbers, not clickable, with the footnote "Only Upload is live today. These connectors are on the roadmap."
- **Drop the email demo import entirely**: no `POST /api/connectors/*` endpoint, no "Import demo inbox" button.
- `sources` in `GET /api/dashboard` becomes:
  ```jsonc
  "sources": [
    { "id": "upload", "label": "Upload", "status": "live", "documents": 13, "live": 9, "blocked": 1, "last_at": "ISO" },
    { "id": "email",  "label": "Gmail",  "status": "coming_soon" },   // then, in this order:
    // slack "Slack", github "GitHub", notion "Notion", sharepoint "SharePoint", google-drive "Google Drive", teams "Microsoft Teams"
  ]
  ```
  Upload's counts are ALL in-scope documents (everything in the space entered through this one door, including the
  initial import). Coming-soon entries carry only id/label/status.
- The per-document `source`/`source_detail` metadata stays as provenance ("originally from SharePoint") on the document
  page and in answer details. It is not a connector.
- **Live demo moment instead**: the Upload source card on the dashboard is a **drop zone** ("Drop a .md or .txt file"),
  which calls the normal `POST /api/documents`. On the result, animate the dot from Upload → the door → Live/Blocked,
  pulse the count, show the outcome inline on the card (link to the upload result/document), and refresh the feed.
  Also animate for new upload activity detected between polls (e.g. someone else uploaded).
- Activity kinds: drop `imported`.
