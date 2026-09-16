# TASK-001 — Database schema v3 (dog-centric, extensible) + RLS

## 1. Metadata
- Task ID: TASK-001
- Status: BLOCKED (authored + reviewed; awaiting human apply — destructive, agent cannot run SQL)
- Priority: HIGH
- Dependencies: –
- Created: 2026-09-05
- Updated: 2026-09-05

## 2. Objective
Provide the dog-centric, multi-tenant, extensible data model with full RLS that all
verticals hang off, starting with walks + daycare.

## 5. Problem
The prior v2 model was cita-centric and did not support N↔N owners, invitation onboarding,
identity fields, or frictionless vertical extension.

## 6/7. Requirements
- Dog (`perros`) as aggregate root; canonical identity via `microchip` UNIQUE.
- N↔N person↔dog via `perro_duenos` (+ co-owner invite via `estado='pendiente'`).
- Polymorphic `servicios.tipo` catalog (enum lists future verticals).
- Single spine `prestaciones` for scheduled services (generic estado + `detalle` JSONB).
- `invitaciones` + `redeem_invite()` SECURITY DEFINER for invitation-based onboarding.
- Dual billing: `servicios.modelo_cobro` (por_uso|mensual) + `suscripciones`.
- Media as object-storage references only (no DB blobs).
- Full RLS with helpers `my_negocio/my_rol/is_owner/owns_dog`.

## 10. Files
- `supabase/schema_v3.sql` (authored — includes tables, RLS, `redeem_invite`, future-vertical docs).

## 11. Data model
See `supabase/schema_v3.sql` and ARCHITECTURE.md §5.

## 16. Security
RLS is the real data boundary. Cliente sees only owned dogs; paseador only assigned prestaciones;
empresa owner the whole tenant. `redeem_invite` bypasses RLS in a controlled way to associate a new user.

## 19. Acceptance criteria (verify after apply)
- [ ] Schema applies without error in Supabase SQL Editor.
- [ ] RLS ON for all tables; a cliente cannot SELECT another owner's `perros`/`prestaciones`.
- [ ] A paseador sees only prestaciones where `cuidador_id = auth.uid()`.
- [ ] An empresa owner sees the whole tenant; nothing cross-tenant.
- [ ] `redeem_invite(codigo)` associates the caller's profile to the invite's negocio+rol and marks it aceptada.

## 20. Verification commands (after human apply)
- Apply `supabase/schema_v3.sql` in Supabase → SQL Editor.
- RLS isolation checks with two test users in two tenants (SQL or app-level).

## 21. Risks
- **DESTRUCTIVE**: drops v1/v2 tables (test data only). Confirm no real data before applying.

## 23. Definition of Done
Applied in Supabase; acceptance criteria verified; ARCHITECTURE/ROADMAP consistent; Engram (#324/#325) updated.

## Blocker
Applying is a destructive operation on the human's Supabase project; the agent cannot execute it.
**Human action required:** run `supabase/schema_v3.sql`. Verification resumes immediately after.
