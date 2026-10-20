# DevDogs — PROJECT

> Persistent project definition. Source of truth for purpose, scope, and Definition of Done.
> Companion files: [ARCHITECTURE.md](./ARCHITECTURE.md), [ROADMAP.md](./ROADMAP.md), [SDDs](./sdd/).
> Durable decisions are mirrored in Engram (project `dev.dogs`, obs #319–#325).

## 1. Purpose

DevDogs is a **dog-centric operations platform** ("centralizador del perro"): a vertical
SaaS where everything revolves around the dog — walks, daycare, and later food, accessories,
and (tangentially) veterinary. It is **not** a scheduling app and **not** a public link-in-bio
tool. Scheduling is one module; the product is the operation and the information around each dog.

## 2. Product goals

- Give dog businesses (independent walkers and companies) a single place to run their operation.
- Give owners peace of mind and shared visibility over their dog's life.
- Remove manual work for the walker (report → company confirms → outings ledger).
- Be trustworthy: verified identities, canonical dog identity, controlled access.

## 3. Functional scope

**Now (v1):** walks (paseo) + daycare (guardería).
**Later (extensible, no-friction):** food (comida), accessories (accesorio), veterinary (veterinaria).

Roles:
- **cliente** (owner): manages their dog(s), sees outings, pays.
- **paseador** (walker/employee): operational day list ("Mi día"); reports outings. Does NOT see money.
- **empresa** (business owner): team, agenda, clients, services & pricing, confirms outings, billing.

## 4. Non-functional requirements

- **Multi-tenant** with strict data isolation enforced by Postgres RLS (not just front guards).
- **Extensible**: adding a vertical must NOT require altering the core or existing verticals.
- **Low cost**: MVP on free tiers (Supabase free, Didit free KYC bundle).
- **Media-light**: photos/videos are not the focus; any media lives in object storage, never as DB blobs.
- Accessible, responsive, theme-aware UI (Muten + project design system).

## 5. Technologies

- **Frontend**: Muten (AI-first DSL → vanilla JS + fine-grained signals). No React/Vue.
- **Backend/Data**: Supabase — Postgres, Auth, Row-Level Security, Storage.
- **Identity/Anti-fraud**: Didit (KYC document + liveness + 1:N face de-duplication).
- **Deploy**: `muten bundle` (CSR) for the stateful app.

## 6. Constraints

- Supabase SQL migrations are applied by the human in the Supabase SQL Editor (agent cannot run them).
- Didit requires an account + API credentials (human-provided).
- Biometric data is legally sensitive (Colombia Ley 1581 / GDPR Art 9 if EU) — consent + policy required.

## 7. Important business rules

- **Access is centralized by login**, not by a public business slug. Onboarding is by **invitation**.
- **Identity verification is per role and per moment**: paseador/empresa strong at onboarding
  (KYC + liveness + 1:N dedup); cliente before their first booking; dog identity = **microchip** (ISO 11784/85).
- **Dog is the aggregate root.** A person can have many dogs; a dog can have many owners (N↔N),
  including invited co-owners who also see the dog's outings.
- **Dual billing**: per-use (por_uso) vs fixed monthly (mensual / suscripción).
- **Outings ledger**: walker reports outings → company confirms → counted per dog (except fixed-monthly).

## 8. Definition of Done (project)

- All ROADMAP tasks COMPLETED and verified against their SDD acceptance criteria.
- Schema applied; RLS verified (a user cannot read another tenant's or another owner's data).
- Auth + role-based access working end to end; identity verification integrated per policy.
- Walks + daycare operational flows working with real data.
- `npm run lint` clean; app builds via `muten bundle`.
- Docs (PROJECT/ARCHITECTURE/ROADMAP/SDD) consistent with the code.

## 9. Current overall status

**Phase**: foundations / pivot. Product direction defined and captured. Front routing pivoted to
login-based access. Schema v3 authored (awaiting human apply). Real-data wiring and invitations pending.
See [ROADMAP.md](./ROADMAP.md) for the live task state.
