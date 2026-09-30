# Design System

This document is the source of truth for how Postura looks and feels. Every UI-touching milestone is built to this bar. Anything that ships rougher than this gets rejected at the manual-test gate.

## Design philosophy

Postura is a serious product for serious buyers (CISOs, DPOs, compliance officers under regulator pressure). The UX should feel like the products this audience already trusts and pays for: **Linear** (clarity, density), **Vercel** (restraint, motion), **Stripe** (precision, typography), **Notion** (calm), **Raycast** (information ergonomics).

The five rules:

1. **Restraint over decoration.** Whitespace, alignment, and typography do the work. No gradients, no drop-shadow noise, no decorative illustrations.
2. **Information density that feels organized.** A CISO reading the dashboard sees a lot at once — but each element earns its place and lives in a clear visual hierarchy.
3. **Color is functional, not decorative.** A green node means compliant. A red node means a finding. We never use color for branding flourishes inside the working surface.
4. **Motion confirms, never entertains.** Transitions exist to make state changes legible. Nothing animates for its own sake.
5. **Self-explanatory.** No tooltips required to understand the primary interface. Where context is needed, the UI reveals it via clear inline labels and microcopy — not buried in `?` icons.

## Stack

| Concern | Choice |
|---|---|
| Component primitives | **shadcn/ui** (Radix-based, Tailwind-styled) |
| CSS framework | **Tailwind CSS 3.x** with custom design tokens |
| Icon set | **Lucide React** (Feather's modern fork; ~1500 icons; pairs with shadcn/ui) |
| Typography | **Inter** (variable; UI text) + **JetBrains Mono** (IDs, hashes, code) |
| Motion | **Framer Motion** (constrained vocabulary — see "Motion" below) |
| Graph visualization | **Cytoscape.js** with custom node renderers + edge styling |
| Charts (where needed) | **Recharts** — only for posture-trend visualization at M8 |
| Form primitives | shadcn/ui form components (React Hook Form + Zod under the hood) |
| Notifications/toasts | **sonner** (used by shadcn/ui by default) |

## Design tokens

### Color palette

Configured in `tailwind.config.ts`. Default to light mode for demos; dark mode is a free side-effect (build, don't fight it).

**Neutrals** (Tailwind `zinc`):
- Background: `zinc-50` (light) / `zinc-950` (dark)
- Surface: `white` / `zinc-900`
- Surface elevated: `white` with `border-zinc-200` / `zinc-900` with `border-zinc-800`
- Text primary: `zinc-900` / `zinc-50`
- Text secondary: `zinc-500` / `zinc-400`
- Text tertiary: `zinc-400` / `zinc-500`
- Border subtle: `zinc-200` / `zinc-800`
- Border strong: `zinc-300` / `zinc-700`

**Brand accent** (single color, used sparingly for primary actions and selected states):
- `indigo-600` light / `indigo-500` dark
- Usage: primary CTAs, active nav item, focused link. Never the dominant color.

**Compliance semantic** (these are non-negotiable across the product):
- Compliant: `emerald-500` with `emerald-50` tint background
- Partial: `amber-500` with `amber-50` tint
- Failing: `rose-500` with `rose-50` tint
- Unknown / not evaluated: `zinc-300`

**Severity badges** (used in finding lists):
- High: `rose-600` text on `rose-50` background, `rose-200` border
- Medium: `amber-600` on `amber-50`, `amber-200`
- Low: `zinc-600` on `zinc-50`, `zinc-200`

### Typography scale

```
display-2xl  48px / 56px  / -0.02em / 700  — never used in product, only marketing
display-xl   36px / 44px  / -0.02em / 700  — page-level hero (rare)
display-lg   30px / 38px  / -0.01em / 600  — main page titles
display-md   24px / 32px  / -0.01em / 600  — section headers
text-xl      20px / 28px  / -0.005em / 600 — card titles
text-lg      18px / 28px  / 0       / 500
text-base    14px / 20px  / 0       / 400  — DEFAULT body
text-sm      13px / 18px  / 0       / 400  — secondary content, captions
text-xs      12px / 16px  / 0.005em  / 500  — labels, badges
mono-sm      13px / 18px  — IDs, hashes, code (JetBrains Mono)
mono-xs      12px / 16px
```

Default body text: 14px Inter Regular. We are deliberately *smaller* than Material/Bootstrap defaults — this is deliberate. CISOs scan dense dashboards; ergonomic information density matters.

### Spacing scale

Tailwind defaults. Common patterns:
- Tight cluster: `gap-1` (4px)
- Related items: `gap-2` (8px)
- Section spacing: `gap-4` (16px) / `gap-6` (24px)
- Layout regions: `gap-8` (32px) / `gap-12` (48px)

### Radius
- `rounded-sm` (2px) — badges, tight chips
- `rounded-md` (6px) — DEFAULT for inputs, buttons, small cards
- `rounded-lg` (8px) — cards, panels
- `rounded-xl` (12px) — modals
- `rounded-full` — circular avatars, status dots

### Borders & shadows

Borders: 1px solid `zinc-200` is the default surface boundary. We rely on borders far more than shadows.

Shadows (use sparingly):
- `shadow-sm` for floating cards
- `shadow-lg` for modals and tooltips
- Never `shadow-2xl` or anything heavier — it cheapens the look

## Layout primitives

### App shell

```
┌───────────────────────────────────────────────────────────────────────┐
│ Topbar — 56px tall                                                     │
│  [Logo] [Customer name dropdown]   [Framework selector]   [Posture] [Sync]
├───┬───────────────────────────────────────────────────────────────────┤
│   │                                                                    │
│ S │  Main content area                                                 │
│ i │                                                                    │
│ d │                                                                    │
│ e │                                                                    │
│ b │                                                                    │
│ a │                                                                    │
│ r │                                                                    │
│   │                                                                    │
│ 240px wide (collapsible to 64px)
└───┴───────────────────────────────────────────────────────────────────┘
```

**Topbar contents (left to right):**
- Postura wordmark (no logo decoration; just the word in `text-lg font-semibold`)
- Customer name selector (env-configurable; Cmd+K to switch in demo mode)
- Framework selector (multi-select chip group: ISO 27001, NCA ECC, GDPR, NIS2, SAMA CSF)
- Posture score (large numeric, color-coded background tint)
- Sync indicator (last collector heartbeat — small pulse dot when fresh)

**Sidebar nav items (Lucide icons + label):**
- `Network` — Graph (default)
- `AlertTriangle` — Findings
- `FileText` — Evidence
- `Bell` — Incident timeline (M8)
- `Settings` — Settings (collapsed by default)

**Right drawer:** slides in from right when a node is selected. Width 480px. Click outside to dismiss. Esc to dismiss. Close button top-right.

### Card pattern

All content panels use the same Card primitive:
- Surface: `bg-white border border-zinc-200 rounded-lg`
- Padding: `p-6` for primary cards, `p-4` for compact
- Header: `text-base font-semibold text-zinc-900` + optional secondary action top-right
- Sections separated by `border-t border-zinc-200` with `pt-4 mt-4`

### Empty states

Every list that can be empty has an empty state. Pattern:
- Centered Lucide icon (24×24, `text-zinc-400`)
- Heading: `text-base font-medium`
- Helper text: `text-sm text-zinc-500`
- Optional CTA button below

### Loading states

**Skeleton loaders** (not spinners) that match the destination layout. Pulse animation: `animate-pulse` with `bg-zinc-100`. Avoid spinners except inside buttons during action states.

### Error states

Pattern:
- Lucide `AlertCircle` icon (small, inline, `text-rose-500`)
- Plain-language message
- Action: "Retry" or "Reconnect" button when applicable
- Never use raw error JSON in the UI

## Motion vocabulary

Constrain motion to a small vocabulary. All durations from this set: 150ms, 200ms, 300ms, 500ms.

| Use case | Motion | Duration | Easing |
|---|---|---|---|
| Hover state | opacity / background fade | 150ms | linear |
| Active press | scale 0.98 | 100ms | ease-out |
| Drawer slide-in | translateX from 100% | 300ms | ease-out (cubic-bezier(0.16, 1, 0.3, 1)) |
| Modal fade-in | opacity + translateY 8px | 200ms | ease-out |
| Graph node color change | background-color | 500ms | ease-in-out |
| Posture score count-up | numeric increment | 800ms total | ease-out |
| Path highlight pulse | opacity 0.6→1 loop | 2000ms | ease-in-out infinite |
| Toast slide-in | translateY from 16px | 200ms | ease-out |

Never animate position to entertain. Never use spring physics that overshoot — feels toy-ish.

## Graph visualization style

The graph is the product. Treat it like art direction.

**Layout:** Three-column constrained layout. Force-directed *within* each column, snapped to columns globally. Implementation: Cytoscape.js with `cose` layout per column, then horizontal positioning.

**Node style:**
- Default: 32px diameter, white fill, 2px border in semantic color
- Selected: 36px, indigo border, soft indigo glow
- Hover: 34px, slight scale animation
- Icon inside node (Lucide) representing entity type (User, Server, Database, etc.)
- Label: 12px Inter Medium, positioned below node, max 18 chars truncated

**Edge style:**
- Default: 1px `zinc-300`
- In a problem path: 2px `rose-500` with subtle pulse animation
- Hover: 1.5px `zinc-500` with edge label appearing inline
- Edge labels (relationship type) are hidden by default; revealed on hover

**Background:** `zinc-50` with a very subtle dot grid (1px dots every 24px in `zinc-100`). Helps eye orient without competing.

**Posture score badges on top-bar are color-tinted backgrounds:**
- `>=90%`: `bg-emerald-50 text-emerald-700`
- `70–89%`: `bg-amber-50 text-amber-700`
- `<70%`: `bg-rose-50 text-rose-700`

## PDF report (Evidence Pack) styling

The PDF must look as polished as the UI. WeasyPrint receives an HTML template using a stripped-down version of the same Tailwind tokens (color palette + Inter font + spacing scale).

- Cover: large customer name, pack ID, generation timestamp, scope summary, posture score
- Section headers: 18pt Inter Semibold, `zinc-900`
- Body: 10pt Inter Regular, `zinc-700`
- Code blocks: JetBrains Mono 9pt, `zinc-50` background, `zinc-200` border
- Severity pills: same styling as UI
- Page numbers: bottom right, 8pt `zinc-500`
- Embedded JSON evidence: monospace, syntax-highlighted minimally (keys in `zinc-900`, strings in `zinc-700`)

## Microcopy principles

- **Plain language always.** "Service account has admin role without MFA enabled" not "Identity entity violation: privilege+factor mismatch."
- **Action-oriented buttons.** "Export evidence pack" not "Export." "Draft notification for DESC" not "Notify."
- **Concrete numbers.** "2.4M EU records" not "many records."
- **No hedging.** "Failing NCA ECC 2-2-1" not "May be failing NCA ECC 2-2-1."
- **No marketing voice in product UI.** Save the personality for the website.

## Quality bar — what "YC quality" means in practice

When reviewing any milestone's UI work, ask:
1. Does it look like Linear/Vercel/Stripe could have shipped it?
2. Is every pixel intentional, or did defaults bleed through?
3. Is the typography hierarchy obvious without color?
4. Do empty/loading/error states exist and look as polished as the happy path?
5. Are the motion durations right (not too fast, not too slow, not springy)?
6. Would a CISO take a screenshot of this and not feel they need to apologize?

All six must be yes. If any are no, the milestone doesn't pass step 7 (manual test).

## What's intentionally NOT in this design system

- No marketing/landing-page styles (separate concern)
- No mobile breakpoints in M0–M8 (desktop demo only; mobile post-M8)
- No Arabic / RTL support yet (post-M8)
- No customer-customizable theming beyond `CUSTOMER_NAME` + optional logo
- No A11y compliance audit committed in M0–M8 (basic semantic HTML + keyboard nav only; full WCAG audit is a post-M8 milestone for production deployments)
