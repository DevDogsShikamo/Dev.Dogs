# TASK-005 — Walker portal → real data (prestaciones ledger)

## 1. Metadata
- Task ID: TASK-005
- Status: TESTING (code complete + lint + empty-state verified; live-data verification pending user seed/login)
- Priority: HIGH
- Dependencies: TASK-001 (schema applied ✓)
- Created / Updated: 2026-09-05

## 2. Objective
Wire the paseador portal ("Mi día") from mock to **real `prestaciones`** data: read today's
assigned walks, and persist each state transition back to Supabase.

## 6. Functional requirements
- On load, show today's `prestaciones` (tipo=paseo) assigned to the current paseador.
- State flow persists: Recibir → Iniciar → Entregar; No salió (motivo). Reception stamps times.
- Empty state when there are no walks today.

## 7/8. Technical & architecture
- **Read bridge** `src/components/PaseadorHoy.js` (headless `Custom`): queries `prestaciones`
  (RLS restricts to `cuidador_id = auth.uid()`) joined with `perros`/`servicios`, maps rows to the
  store shape, pushes via `on(load: paseador.setPaseos)`. Re-reads on `supa:refresh`.
- **Write side** `src/lib/data.ts`: `prestacionRecibir` (merges times into `detalle` JSONB),
  `prestacionEstado`, `prestacionNoSalio`. Fire-and-forget + `supa:refresh`.
- **Store** `src/paseador.store`: `paseos = []`; `setPaseos`; transitions patch optimistically and
  call the data.ts writers. v3 estados: programado→recibido→en_curso→finalizado / no_asistio.

## 10. Files
- New: `src/components/PaseadorHoy.js`, `supabase/seed_paseador.sql`.
- Modified: `src/lib/data.ts` (v3 writers), `src/paseador.store` (real data, v3 estados),
  `src/pages/dashboard/dashboard.muten` (mount bridge, empty state, v3 estados),
  `src/styles.css` (`.ps-en_curso/.ps-finalizado/.ps-no_asistio`).

## 16. Security
Reads/writes go through RLS: a paseador only sees/updates prestaciones where `cuidador_id = auth.uid()`.
No service key on the client (publishable key only).

## 18/19. Testing & acceptance criteria
- [PASS] `npm run lint` clean.
- [PASS] `/app` renders the empty state ("No tenés paseos hoy") with no session/data, no crash.
- [ ] With a seeded paseador (run `supabase/seed_paseador.sql`) and login: 3 walks show; Recibir
      stamps time + computes entrega; Iniciar/Entregar/No salió persist; refresh reflects DB.
- [ ] KPIs update (Entregados = finalizado count).

## 20. Verification commands
- `npm run lint`.
- Sign up as paseador → run `seed_paseador.sql` (with test email) → login → exercise the flow;
  confirm `prestaciones.estado`/`detalle` change in Supabase.

## 22. Architectural decisions
- Read via a headless `Custom` bridge (Muten `api{}` headers can't carry a dynamic JWT — engram);
  the bridge uses `supabase-js` with the live session. JSONB `detalle` merged client-side (no RPC).

## 23. Definition of Done
Live-data acceptance criteria verified with a seeded account. Then → COMPLETED.
