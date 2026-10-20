# DevDogs — ARCHITECTURE

> Current technical architecture. Keep in sync with the code. Durable decisions → Engram (#319–#325).

## 1. Stack overview

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Muten DSL → vanilla JS + signals | `.muten` pages/parts, `.store` global state, `Custom` JS escapes |
| Styling | `src/styles.css` + `theme.muten` tokens | semantic classes; no inline CSS |
| Data/Auth | Supabase (Postgres, Auth, RLS, Storage) | publishable key on client; RLS protects data |
| Identity | Didit (KYC + liveness + 1:N face dedup) | integration pending (external credentials) |
| Build | `muten dev` (HMR), `muten bundle` (prod CSR) | `npm run lint` = `muten lint` |

## 2. Frontend architecture

- **Entry**: `src/app.muten` (routes + persistent `shell`). Never a `main.js`.
- **Routing**: flat, **login-based** (no tenant slug in the URL):
  - `/` landing (public), `/login`, `/signup`, `/app` (role-aware home), `/agenda` (walker).
  - Guards read auth-store booleans (`auth.loggedIn`, `auth.canWalker`). Tenant is resolved from the
    session profile, never from the URL.
- **Pages**: `src/pages/<route>/<route>.muten`. `dashboard` is role-aware (paseador/empresa/cliente).
- **Global state**: `.store` files — `auth`, `paseador`, `agenda`, `empresa`, `servicios`, `estadisticas`, `signup`.
- **Escapes**: `src/lib/*.ts` for `use` logic (e.g. `tiempo.ts`, `money.ts`); `src/components/*.js` for
  `Custom` widgets (`Aurora.js` WebGL footer; `SupaAuthForm.js` headless auth bridge).

## 3. Authentication & session

- Supabase Auth via `src/lib/authActions.ts` (creates the client, exposes it on `globalThis.__supa`
  for the headless `Custom` bridges, which cannot `import`).
- `SupaAuthForm.js` runs on the login/signup **pages** (shell `Custom`s do NOT mount in Muten — known
  constraint). On auth success it loads the profile (rol + negocio) and reports the full session into
  the `auth` store via `on(session)`.
- `auth.store` mirrors: `loggedIn`, `userId`, `userName`, `rol`, `negocioId`, `slug` (persisted).
  Derived: `isPaseador/isEmpresa/isCliente`, `canWalker/canBusiness/canClient`.

## 4. Authorization (two layers)

1. **Front guards (UX)**: route guards by role; role-aware page content. Prevents showing the wrong portal.
2. **RLS (real security)**: Postgres Row-Level Security is the actual data boundary. Even if a URL is
   forced, Supabase returns nothing outside the user's tenant/ownership. **This is the source of truth
   for access control.**

## 5. Database architecture (schema v3 — `supabase/schema_v3.sql`)

Dog-centric, multi-tenant, extensible. **The dog (`perros`) is the aggregate root.**

- `negocios` — tenant (independiente | empresa). `slug` optional (future public page, NOT the access door).
- `profiles` — one per auth user: `rol`, `negocio_id`, verification fields (`verificado`, `didit_session_id`).
- `invitaciones` — invitation-based onboarding (replaces public link). `codigo`, `rol`, `estado`.
- `perros` — aggregate root. `microchip` UNIQUE = canonical dog identity. `foto_url` = object-storage ref.
- `perro_duenos` — **N↔N** person↔dog (`rol` principal|co, `estado` activo|pendiente for co-owner invites).
- `servicios` — **polymorphic catalog** by `tipo` (paseo|guarderia|comida|accesorio|veterinaria); the enum
  already lists future verticals. `modelo_cobro` por_uso|mensual. `config` JSONB for per-type settings.
- `suscripciones` — fixed monthly billing (vertical-agnostic).
- `prestaciones` — **single spine** for scheduled services (paseo+guardería now, vet later). Generic
  `estado` (programado→recibido→en_curso→finalizado / no_asistio / cancelado). Vertical specifics in
  `detalle` JSONB. This is the **outings ledger** (`confirmado_por`, `cobrable`, `cobrado`).

### Extensibility contract (no-friction guarantee)

Adding a vertical never alters the core or existing verticals:
- **Service verticals** (vet) → reuse `prestaciones` with a new `tipo` + `detalle` JSONB. Zero migration.
- **Commerce verticals** (comida, accesorios, helados) → a **separate spine** `ordenes`/`orden_items`
  (documented at the end of the schema), referencing `perros`/`servicios`. Not built yet.
- New per-vertical attributes → `detalle`/`config` JSONB, no schema change.

### RLS model

- Helpers (SECURITY DEFINER, avoid recursion): `my_negocio()`, `my_rol()`, `is_owner()`, `owns_dog(pid)`.
- `perros`/`prestaciones`/`suscripciones`: cliente sees only their dogs (`owns_dog`), paseador sees
  assigned (`cuidador_id`), empresa owner sees the whole tenant.
- `servicios`: tenant reads catalog; owner writes.
- `perro_duenos`: an owner can invite co-owners to a dog they already own.

## 6. Media strategy

Media is not a focus. Any photo/video is stored in **Supabase Storage / object storage** and referenced
by URL (`perros.foto_url`, `prestaciones.detalle`). **Never store blobs in the database.**

## 7. Identity / anti-fraud (Didit — pending integration)

- Provider: Didit (free KYC bundle incl. 1:N face de-duplication + liveness).
- Applied **per role and moment**: paseador/empresa strong at onboarding (KYC + liveness + 1:N dedup so a
  banned user cannot re-register); cliente before first booking; dog identity via microchip (not facial).
- DevDogs is the data controller; biometrics = sensitive data → explicit consent + policy required.

## 8. Key architectural decisions (see Engram)

- Login-based multi-tenant, onboarding by invitation, no URL slug (#319).
- Dog-centric reposition; problems P1–P5 (#320).
- Didit as provider; 1:N dedup free; per role/moment (#321–#323).
- Extensible schema principles (#324); single spine `prestaciones` over table-per-vertical (#325).
