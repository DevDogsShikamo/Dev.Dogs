# DevDogs — ROADMAP (master execution state)

> Live task state. A task is COMPLETED only when its SDD acceptance criteria are verified.
> States: PENDING · PLANNING · SDD_CREATED · SDD_REVIEW · IMPLEMENTING · TESTING · FIXING · REVIEW · BLOCKED · COMPLETED

## Task table

| ID | Task | Status | Dependencies | Priority |
|----|------|--------|--------------|----------|
| TASK-001 | Database schema v3 (dog-centric, extensible) + RLS | COMPLETED | – | HIGH |
| TASK-002 | Access pivot: login-based routing (no slug) | COMPLETED | – | HIGH |
| TASK-003 | Invitation-based onboarding (redeem fn + signup + invite UI) | BLOCKED | TASK-001 | HIGH |
| TASK-004 | Dog + owners management (perros, N↔N perro_duenos, co-owner invite) | PENDING | TASK-001 | HIGH |
| TASK-005 | Walker portal → real data (prestaciones ledger) | TESTING | TASK-001 ✓ | HIGH |
| TASK-006 | Identity verification (Didit, per role/moment) | PENDING | TASK-001 ✓, edge-fn deploy | HIGH |
| TASK-007 | Client portal (dog profile, outings visibility, co-owner) | PENDING | TASK-004, TASK-005 | MEDIUM |
| TASK-008 | Business portal (team, agenda, clients, services, confirm, billing) | PENDING | TASK-005 | MEDIUM |
| TASK-009 | Daycare vertical (guardería via prestaciones; P5 add-on groundwork) | PENDING | TASK-005, TASK-008 | MEDIUM |
| TASK-010 | Testing & verification pass (RLS, flows) | PENDING | TASK-003..009 | MEDIUM |
| TASK-011 | Production hardening (bundle, env, deploy) | PENDING | TASK-010 | LOW |

## Notes on blockers (real, human-gated)

- **TASK-001** — `supabase/schema_v3.sql` is **authored and reviewed**. Applying it is **destructive**
  (drops v1/v2 tables) and can only run in the human's Supabase SQL Editor; the agent cannot execute SQL
  on the project. → Human action required: apply `schema_v3.sql`. Verification (RLS isolation tests)
  resumes once applied.
- **TASK-006** — Needs a Didit account + API credentials (external). Cannot proceed without them.
- **TASK-003/004/005** — DB-dependent; implementable but **not verifiable** until TASK-001 is applied.
  To avoid shipping unverified code on an unapplied schema, they wait on TASK-001.

## Current focus

1. TASK-002 (access pivot) → verify and close. **← this session**
2. Establish control docs + SDD scaffolding. **← this session**
3. Then blocked on human: apply `schema_v3.sql`; provide Didit credentials.
   Once applied, proceed TASK-004 → TASK-005 → TASK-003 → TASK-008/007 → TASK-009.

## Discovered / open product items

- **Onboarding provisioning gap (→ TASK-003, HIGH)**: a signed-up user can end up with an
  `auth.users` row but NO `public.profiles` row (no negocio). Causes: (a) destructive schema
  re-apply wiped `profiles`/`negocios` while `auth.users` survived; (b) email confirmation ON →
  `signUp` returns no session → `SupaAuthForm.provision` never runs. Fix in TASK-003: provision on
  first authenticated load if profile missing (or a post-confirmation hook), and re-fetch the
  session profile without requiring a full re-login. Workaround for testing: `seed_paseador.sql`
  now self-bootstraps the profile+negocio.
- Client's "star job" (peace of mind + shared visibility) — to be concretized in TASK-007.
- Live-walk tracking link (differentiator vs gendalink) — candidate feature, not yet scheduled.
