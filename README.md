# Verity

**One subject. One source. Always the latest.** Hackathon entry for the SD Worx "Unlock the Knowledge Within" challenge.

Verity is a company knowledge space where every topic has one live document. Each upload is checked against the
live documents: conflicts, duplicates, stale copies, missing owners, overdue reviews and missing metadata become
issues with an SLA (24h to 30d). A chat answers questions from the single latest live document and returns a
signed receipt showing which document and version the answer came from. All content in `seed/` is fictional.

## Run it

**Docker** (two containers in the `verity` project: `app` serves the web app + API on one port, `llm` runs the local model):

```bash
docker compose up -d --build   # http://localhost:3000
```

The first start downloads the ~1 GB model into the `llm-models` volume; until it's ready, answers are quoted from the
document instead of AI-worded. A `.env` file is optional (see `.env.example`).

**Local dev** (Python 3.12 via uv, Node 22):

```bash
cd api && uv run --python 3.12 --with-requirements requirements.txt uvicorn main:app --reload --port 8000
cd web && npm install && npm run dev            # http://localhost:3000, proxies /api -> :8000
```

On first start the API creates `data/verity.db`, seeds the demo users, loads `seed/docs/*.md` (the highest version
of each document is live, older ones are superseded) and runs the checks across the live documents. To start over,
run `api/reset.sh` or start with `VERITY_RESET=1`.

Tests: `cd api && uv run --python 3.12 --with-requirements requirements.txt pytest -q`

## Demo users

Password for all: `verity-demo` (override with `DEMO_PASSWORD`).

| user | role | countries | departments |
|---|---|---|---|
| `sofie` | consultant | BE | payroll, hr |
| `daan` | consultant | NL | payroll, hr |
| `lies` | owner (can resolve issues) | BE, NL, ALL | payroll, hr |
| `noor` | owner (Finance) | BE, NL, ALL | finance |
| `admin` | admin | BE, NL, FR, DE, ALL | payroll, hr, finance |

A user only sees documents whose country is in their countries (or ALL) **and** whose department is in their departments.
The schema changed in v2: an older `data/verity.db` is moved aside (`*.bak`) and re-seeded on the next start
(or wipe it with `api/reset.sh`).

Demo uploads are in `seed/uploads/` (see its README). File 4 has no country, so it counts as company-wide and only `admin` can upload it.

## AI: on-premise by default

Chat answers are worded by a small open model (`qwen2.5:1.5b-instruct`) served by Ollama in the `llm` container, via
its OpenAI-compatible API. It has no host port, so only the app can reach it, and no document or question is sent to a
third-party AI provider.

- The model only sees the title, version, matched rules and verbatim quotes of the one chosen document.
- Grounding check: every number in the answer must appear in the document, and if the facts it was given contain
  numbers, the answer must repeat at least one of them. Otherwise, or on any error/timeout (`LLM_TIMEOUT`, default
  30 s), Verity shows a template answer built from the document. Verbatim quotes are always shown under the answer.
- Claims are extracted from the `## Key rules` list. LLM claim extraction is opt-in (`LLM_EXTRACT=1`): a small model
  isn't reliable enough to add rules of its own.
- To use Anthropic instead, set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` in `.env`. Any other
  OpenAI-compatible endpoint works with `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`.

## Security

- Passwords are hashed with scrypt. Sessions use a random 32-byte token, stored server-side as a SHA-256 hash, in an
  `HttpOnly`, `SameSite=Lax` cookie (`Secure` when `COOKIE_SECURE=1`). Sessions expire after 8 hours; logout deletes the session.
- Every `/api` route except login and health needs a session.
- Country scope is part of every SQL query. An id outside your scope returns 404, not 403.
- Roles: only owners and admins can resolve issues or read the audit log. Only admins can publish company-wide (ALL) documents.
  An upload whose country is outside your scope returns 403.
- CSRF: every POST requires the `X-Requested-With: verity` header. Logins are rate-limited to 10 failed attempts per username per 5 minutes.
- Uploads must be `.md` or `.txt`, UTF-8, and at most 200 KB. YAML is parsed with `safe_load`. All SQL is parameterised.
- Every response sets `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` and a strict CSP
  (the inline theme script is allowed by its hash). Clients never see stack traces.
- Chat and the LLM prompt only use live documents inside your scope. Answer receipts are Ed25519-signed over canonical
  JSON. The key is generated on first run at `data/keys/ed25519.pem`, which is gitignored. You can only verify your own
  receipts; admins can verify anyone's.
- No secrets are in the repo. Only `.env.example` is committed.

## Unfinished / known limits

- Sessions and the rate limiter live in one process, so run a single worker.
- Keyword retrieval is simple, with no embeddings.
- The engine compares claims by key, so different wording for the same rule is only caught when the LLM reuses existing keys.
- There is no user management UI. Users come from the seed.
