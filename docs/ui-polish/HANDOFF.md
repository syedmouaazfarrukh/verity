# Verity UI polish — Claude review handoff

Branch: `polish/verity-ui`. Local review: http://localhost:3000/login.
The current Docker app contains the final front end. No push or merge has been performed.

## Scope

- New inline SVG page/check mark, lowercase wordmark, and self-contained theme-aware favicon.
- Split login with the product promise, a conceptual sources → check → answer diagram, theme toggle, and unchanged form and one-click demo login flows.
- Restrained violet accent, stronger muted text, slightly refined corners, and clearer active navigation. Dashboard and Library layouts remain intact.
- Graph topic cards arranged in a stable orbit, quieter entity icons, readable header, node picker for keyboard access, zoom/fit controls, and original topic drill-down and document panel.
- Reduced-motion support, including graph transitions and conversation scrolling. Source focus, cross-highlighting, and red conflict edges retained.
- Fixed critical-badge contrast and added an accessible label to the Dashboard file input.

Changes are confined to `web/` and this `docs/ui-polish/` folder. No runtime dependency changes. API client, auth/safeNext, backend, seed, Dockerfile, compose configuration, connector honesty, answer mode labels, verbatim quotes, receipt checks and resolution logic are unchanged.

## Verification

- `npm run build` in `web/`: passed, zero TypeScript errors.
- `npm audit` in `web/`: zero vulnerabilities.
- `docker compose up -d --build`: passed; app and local model running.
- Existing API suite using Python 3.12 and its requirements against a throwaway database: **41 passed**.
- `git diff --check`: clean. No `dangerouslySetInnerHTML` in `web/src`.
- Real Docker browser walkthrough/captures: no page errors, console errors or CSP violations, light and dark.
- Axe WCAG A/AA checks: no violations on Login, empty Ask, Graph, Dashboard and Library in both themes. This is an automated check, not a complete accessibility certification.
- Isolated Docker UI smoke: manual login and safe redirect; Enter / Shift+Enter; answer labels and quotes; Details with two-way graph highlight; Library search; graph drill-down, node panel, breadcrumb and zoom; Dashboard drag-drop with blocked result; consultant read-only; owner resolution with required note; demo identity/scope checks for lies, daan, noor and admin; CSRF headers on POSTs. Passed.
- Favicon returns HTTP 200.
- Additional responsive checks: 1024×800 and 1440×900 with reduced motion, including the admin shell. No document-level horizontal overflow.

## Review artifacts

Open [comparison.html](comparison.html) for the before/after gallery. All 24 screenshots are 1280×800, captured against real Docker data: Login, empty Ask, Ask with Details open, Dashboard, Library and Graph, each in light and dark.

## Remaining release gate

Please inspect the front-end diff against `main`, run your security review and Aikido rescan, then decide whether to merge/push. Those final security checks have not been performed here. Focus manual review on graph drill-down, keyboard node selection, source/alternative cross-highlighting, the Dashboard upload animation, scoped roles, required owner notes, and `safeNext` redirects. Do not alter API contracts or loosen CSP to accommodate visual changes.

The screenshot walkthrough creates signed answer receipts as normal. Upload/resolution testing uses an isolated disposable Docker container, leaving the demo document state in the main instance unchanged.
