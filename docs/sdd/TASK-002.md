# TASK-002 — Access pivot: login-based routing (no slug)

## 1. Metadata
- Task ID: TASK-002
- Status: COMPLETED
- Priority: HIGH
- Dependencies: –
- Created: 2026-09-05
- Updated: 2026-09-05

## 2. Objective
Move access from URL-slug multi-tenant routing (`/:negocio/portal/...`) to **centralized
login-based routing** with flat URLs. Tenant resolves from the session, not the URL.

## 3. Context
Product decision (#319): drop the public business-slug link model (gendalink-shaped) and
centralize by login + invitations. This task covers the routing half; invitations = TASK-003.

## 4. Current state (before)
Routes used `/:negocio/walker/dashboard` etc. with `param negocio` + an `effect guardTenant`
in the page, plus a `hub` redirector and a `vitrina` public stub. Tabbar linked to `/{slug}/...`.

## 5. Problem
Slug-in-URL leaks tenant identity, complicates guards, and frames the product as a link-in-bio
tool. Access should be by authenticated session; RLS is the real data boundary.

## 6. Functional requirements
- Flat routes: `/`, `/login`, `/signup`, `/app` (role-aware home), `/agenda` (walker).
- Logged-in users reach `/app`; logged-out users are redirected to `/login`.
- No tenant slug anywhere in the URL or tabbar.

## 7/8. Technical & architecture
- `app.muten` routes with role/login guards; `dashboard` is role-aware.
- Tenant identity from `auth.negocioId` (session), never the URL.

## 10. Files
- Modified: `src/app.muten` (flat routes + flat tabbar), `src/pages/dashboard/dashboard.muten`
  (removed `param negocio`, `guardTenant` effect, public-link line).
- Deleted: `src/lib/nav.ts`, `src/pages/hub/`, `src/pages/vitrina/`.

## 18. Testing strategy
Seed a paseador session in localStorage, navigate to `/app`, assert render + flat tabbar. Lint.

## 19. Acceptance criteria
- [PASS] `/app` renders the role-aware home for a logged-in paseador (5 `.ps-card` present).
- [PASS] Tabbar hrefs are flat: `["/app","/agenda"]` (no slug).
- [PASS] No `:negocio` param or `guardTenant` remains; unused files removed.
- [PASS] `npm run lint` → no problems.

## 20. Verification commands
- `npm run lint`
- Playwright: seed `muten:auth:*`, goto `/app`, check `.ps-card` count and `.tabbar a` hrefs.

## 22. Architectural decisions
- Access is login-based; RLS (not front) is the security boundary. Slug removed from routing.

## 23. Definition of Done
SDD reviewed, implemented, verified (above), lint clean, ROADMAP + ARCHITECTURE updated,
Engram updated (#319). → DONE.

## Implementation notes (as-built)
Verified 2026-09-05: final URL `/app`, `.ps-card`=5, tabbar `["/app","/agenda"]`, lint clean.
The `auth.slug` state remains in the store (harmless; future optional public page) but is no
longer used for routing.
