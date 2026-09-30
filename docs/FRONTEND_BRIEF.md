# Verity: front-end polish brief

**For:** the designer/engineer (human or AI) polishing Verity's web app.
**Repo:** https://github.com/syedmouaazfarrukh/verity (`main`). Front end lives in `web/`.
**Goal of this round:** a more distinctive, premium look and feel, especially the **login page** and the **logo**,
without breaking any behaviour, security control or API contract. After your changes we re-run our tests, a security
review and an Aikido scan, so section 4 is non-negotiable.

---

## 1. What Verity is (the story the UI must tell)

Verity is a company knowledge space for SD Worx, the European HR and payroll company, built for the "Unlock the
Knowledge Within" hackathon challenge. The product promise:

> **One subject. One source. Always the latest.**

- Consultants **ask a question** and get **one answer from one live document**. Under the answer they see the exact
  lines it came from. **Details** shows the source, how it became the source (who published it, from where, what the
  check found), the other documents found and why they weren't used, a signed receipt, and a small graph of the answer.
- Every new document goes through **one door, "the Verity check"**. It is compared rule by rule with the live
  document. A clash is **blocked** with a severity and a deadline until the owner decides.
- People only see their **countries** (BE / NL / ALL) and **departments** (Payroll / HR / Finance).
- The AI that words answers runs **on-premise**, so nothing goes to a third-party AI provider.

**Personality:** trustworthy, calm, precise. It's a tool for payroll and HR professionals, judged by a jury. It should
feel like Linear, Vercel or Stripe: restraint, typography, clear hierarchy. Not playful or crypto, and no gradients
everywhere. **Colour carries meaning:** green = live/trusted, amber = needs attention, red = conflict/blocked. Don't use
those three for decoration.

Audience for the demo video: hackathon judges (30% originality, 30% technical, 30% fit to the case, 10% security).

---

## 2. What we want from you

1. **Logo + wordmark.** The current mark (`web/src/components/verity/logo.tsx`) is an indigo rounded square with a white
   "V"/check stroke. We want a more ownable mark. Concept direction, pick or improve: *one page with a check* ·
   *many lines converging into one* · *a door / gate* · *a seal of verification*. Deliverables:
   - SVG React component with the same export name `VerityLogo({ className })`, readable at 16, 24, 32 and 44 px and in
     light and dark
   - a wordmark treatment used in the top bar
   - a favicon: `web/public/favicon.svg`, linked from `web/index.html`. The app currently has no favicon (it 404s).
2. **Login page** (`web/src/pages/login.tsx`). Today it's a centred card with username, password and one-click demo-user
   chips. Make it a brand moment: a split layout or hero with the promise, and a subtle visual of "many sources → one
   door → one answer". It must stay fast and accessible. Keep all behaviour in section 5.
3. **Overall look and feel.** Refine tokens (colour, type scale, radius, shadows, spacing), the top bar and sidebar,
   cards, badges, empty states and motion. Keep information density: these are professional dashboards.
4. **Owner's direction** (the product owner will add specifics here):
   - _…_

Out of scope: backend, API shapes, business logic, new pages, and anything under `api/`, `seed/`, `Dockerfile` or `docker-compose.yml`.

---

## 3. Stack and how to run it

- React 18, Vite 6, TypeScript, Tailwind 3 (tokens as HSL CSS variables), Radix/shadcn-style primitives in
  `components/ui`, Framer Motion, Cytoscape (graphs), Lucide icons, sonner (toasts), React Router 7
  (`react-router-dom`). Fonts are self-hosted via `@fontsource` (Inter + JetBrains Mono), imported in `src/main.tsx`.
- **No backend needed:**
  ```bash
  cd web && npm ci && VITE_MOCK=1 npm run dev     # http://localhost:5173, whole UI on mock data (src/lib/mock.ts)
  ```
  Demo users: click a chip on the login page (sofie, daan, lies, noor, admin; password `verity-demo`).
- Full app: `docker compose up -d --build` at the repo root → http://localhost:3000.
- Must pass: `npm run build` (zero TS errors) and `npm audit` (0 vulnerabilities).

---

## 4. Hard constraints (must not break)

**Security.** These are tested and scanned:
1. **Content Security Policy:** `default-src 'self'`, `script-src 'self'` plus the hash of inline scripts in `index.html`
   (recomputed at server start), `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`,
   `font-src 'self' data:`, `connect-src 'self'`, `frame-ancestors 'none'`. That means:
   - **no external fonts, CDNs, analytics, images or iframes.** Self-host fonts via `@fontsource/*` or files in
     `web/public`.
   - no new inline `<script>` tags. The existing theme script in `index.html` may be edited.
   - inline styles and SVG are fine.
2. **Never use `dangerouslySetInnerHTML`.** Document content is rendered by `components/verity/markdown.tsx`, which
   builds React elements. Keep it that way.
3. **API client** (`src/lib/api.ts`): keep every call going through `request()`. It sends `credentials: "include"` and
   the header `X-Requested-With: verity` (the CSRF guard), and turns 401 into a login redirect. Don't rename methods or
   change request/response types.
4. **Login redirect:** keep `safeNext()` in `src/lib/auth.tsx` as is. It blocks open redirects.
5. **No new runtime dependencies** unless essential; if you add one, `npm audit` must stay at 0. No tracking or telemetry.

**Honesty rules.** These are part of the pitch, and judges will ask:
6. On the Dashboard, **only Upload is a real connector**. Gmail, Slack, GitHub, Notion, SharePoint, Google Drive and
   Teams must stay visibly "Coming soon" (faded/blurred, **no numbers**, not clickable), with the footnote "Only Upload
   is live today…".
7. Every answer keeps its **mode label** ("Worded by local AI · checked against the document" or "Quoted from the
   document") and the **verbatim quotes** under it. Never make an AI answer look more certain than it is.
8. Data shown must come from the API. Don't hard-code numbers.

**Quality.**
9. Light **and** dark mode (the `next-themes` class strategy; tokens in `src/styles/globals.css`).
10. `prefers-reduced-motion` respected. Keyboard navigable, visible focus rings, contrast AA or better, and existing
    `aria-*` labels kept.
11. Must look great at **1280×800** (demo recording size) and 1440×900, and not break at 1024 wide.

---

## 5. Screens: what each must keep

| Screen | Route / file | Must keep |
|---|---|---|
| **Login** | `/login` · `pages/login.tsx` | username + password form; **one-click demo-user chips** that sign in immediately (sofie · Consultant BE, daan · Consultant NL, lies · Payroll & HR owner, noor · Finance owner, admin); visible demo-password hint; inline error message; `next` redirect via `safeNext` |
| **Ask** (home) | `/` · `pages/ask.tsx` | empty state centred like a new T3/ChatGPT chat: greeting "Hi {name}, what do you need to know?", ask box, 3–4 department-aware example questions, nothing else. After the first question: thread, box docked at bottom, "New chat". Enter sends, Shift+Enter adds a new line |
| Answer block | `components/verity/answer.tsx` | question bubble; answer with mode label; highlighted **quotes** ("From the document · {section}"); source line (title · version · who · date); receipt chip "Signed receipt · verified"; "N other documents not used · M blocked"; **Details** toggle |
| Details panel | `answer.tsx` + `components/graph/answer-graph.tsx` | left cards: **Source**, **How it became the source** (source badge, fingerprint, timeline), **Other documents we found and why we didn't use them** (status, reason, "€130 vs €150"), **Receipt**. Right: **answer graph** (source highlighted, the rest dimmed, conflicts red). Hovering a row highlights its node and vice versa |
| **Library** | `/library` · `pages/library.tsx` | topic cards (trust dot, live documents per country, open-issue counts by level); search; filters for country, department and trust; count; empty state |
| **Dashboard** | `/dashboard` · `pages/dashboard.tsx`, `components/dashboard/*` | 4 stat tiles; flow "Many sources, one door": source cards → **The Verity check** → **Live** / **Blocked** → **Answers**; the **Upload card is a drop zone** whose upload animates a dot through the door (keep this, it's the video moment); coming-soon rules (§4.6); activity feed; health card; "Live · updated Ns ago" |
| **Upload** | `/upload` · `pages/upload.tsx` | drag-drop + picker (.md/.txt ≤ 200 KB); outcome banner (Live green / Blocked red); issue cards with level badge, SLA countdown, "Live document says / Your document says" |
| **Review queue** | `/issues` · `pages/issues.tsx` | grouped by level, open/resolved tabs, countdowns; owners resolve (Accept new version / Keep existing + required note); consultants read-only |
| **Document** | `/documents/:id` · `pages/document.tsx` | rendered document (safe renderer), status banner, metadata, source badge + fingerprint, version history, rules, issues |
| **Graph** | `/graph` · `pages/graph.tsx` | topic map → click a topic → documents (`?topic=`), breadcrumb back, side panel, legend |
| Shell | `components/layout/*` | top bar: logo + wordmark, tagline, user, role badge, country + department chips, theme toggle, sign out. Sidebar order: Ask · Library · Dashboard · Upload · Review queue (red count) · Graph; collapsible |

---

## 6. Design system today (starting point, change freely within §4)

- **Tokens:** `web/src/styles/globals.css` (HSL variables, light and dark) and `web/tailwind.config.ts`.
  - neutrals: zinc (`--background` zinc-50 / zinc-950)
  - `--primary`: indigo (600 in light, 400-ish in dark)
  - trust semantics: `--ok` emerald, `--warn` amber, `--danger` rose, each with `-foreground` and `-tint`
  - `--radius`: 0.5 rem
- **Type:** Inter 400/500/600/700 for UI, JetBrains Mono for ids and fingerprints. Body text 14 px.
- **Shared components:** `components/verity/badges.tsx` (`LevelBadge`, `StatusBadge`, `TrustDot`, `CountryChip`,
  `DepartmentChip`, `SourceBadge`, `Fingerprint`, `SlaCountdown`), `topic-card.tsx`, `issue-card.tsx`, `states.tsx`
  (loading/empty/error), `brand-icons.tsx` (inline SVG marks for Gmail, Slack, GitHub, Notion, SharePoint, Drive,
  Teams).
- **Primitives:** `components/ui/*` (button, card, badge, dialog, sheet, dropdown-menu, tooltip, skeleton, separator).
- **Graph styling:** `components/graph/node-styles.ts` (Cytoscape stylesheet: colours by status and trust).
- Original design principles we started from: `docs/postura-design-system.md`.

---

## 7. How we'll check your work

1. `npm run build` → 0 errors; `npm audit` → 0; `git grep dangerouslySetInnerHTML web/src` → nothing.
2. `docker compose up -d --build`, then walk the demo script as sofie, lies, daan and noor:
   - ask, open Details, hover the rows
   - drop `seed/uploads/1-conflict-emailed-note-hoa-be.md` on the Dashboard's Upload card
   - resolve it in the Review queue
   - check the Library filters and the Graph drill-down
3. Browser console: no CSP violations, no errors.
4. Backend tests (`cd api && pytest`) still 41 passed (the front end shouldn't affect them).
5. Security review + Aikido rescan.

**Please hand back** a branch or PR against `main` touching only `web/` (plus `docs/` if you add notes), with before/after
screenshots at 1280×800 in light and dark for Login, Ask (empty + with Details open), Dashboard and Library.
