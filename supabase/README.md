# Supabase: migrations, staging and rollback

Production project ref: `agutaluxzruuthbbagkh`. Staging project: `devdogs-staging`.

## Production-link warning

`supabase/.temp/linked-project.json` (gitignored) links the CLI to **production**.
Therefore:

- Never run `supabase db push`, `db reset`, `db pull`, `link`, `functions deploy` or
  `--linked` without an explicit target.
- Every database command in this repo passes `--db-url` (or `--project-ref`) for the
  project it means to touch. No command here relies on the link.
- `tests/security/_env.mjs` refuses to run when any configured value (URL, ref, DB host,
  key claims) contains the production ref, and `supabase/staging.mjs` loads the same guard.

## Layout

| Path | Purpose |
|---|---|
| `supabase/migrations/2026010100000N_*.sql` | The 11 legacy SQL files, renamed (pure renames, content unchanged), applied in order 01..11 |
| `supabase/migrations/<14-digit UTC>_s<N>_<name>.sql` | Slice migrations, forward only |
| `supabase/rollback/<version>.down.sql` | Data-preserving structural inverse of a slice (see Rollback) |
| `supabase/seed_*.sql` | Demo seeds, **not** part of any automated path; run by hand in the SQL editor |
| `supabase/staging.mjs` | Staging-only wrapper around the CLI |

Legacy name to migration map: `schema_v3` 01, `grupos` 02, `zonas_vacaciones` 03,
`incompatibles` 04, `realtime` 05, `office` 06, `paseo` 07, `precios` 08, `tipos` 09,
`mi_perro` 10, `fotos` 11 (file names are `20260101000001_schema_v3.sql` ... `20260101000011_fotos.sql`).

## Local configuration (`.env.test`, gitignored)

| Variable | Meaning |
|---|---|
| `STAGING_PROJECT_REF` | Staging project ref |
| `STAGING_SUPABASE_URL` | `https://<staging ref>.supabase.co` |
| `STAGING_DB_HOST` | Direct host `db.<ref>.supabase.co`, or the session pooler `aws-0-<region>.pooler.supabase.com` if the direct host (IPv6 only on the free plan) is unreachable |
| `STAGING_DB_PASSWORD` | Staging database password |
| `SUPABASE_PUBLISHABLE_KEY` | Staging publishable key (`STAGING_PUBLISHABLE_KEY` and `SUPABASE_ANON_KEY` are accepted too) |
| `SUPABASE_SERVICE_ROLE_KEY` | Staging service-role key, used only by test fixtures (`STAGING_SERVICE_ROLE_KEY` also accepted) |
| `PRODUCTION_PROJECT_REF` | Extra guard: the ref that must never be touched |

Real environment variables win over the file. The loader also reads a file that mixes
UTF-8 with UTF-16 (what PowerShell `>>` produces). Never commit `.env.test`.

## Staging procedure

Use the wrapper; it builds `--db-url` from `.env.test` and redacts the password from output:

```
node supabase/staging.mjs dry-run   # supabase db push --dry-run --db-url <staging>
node supabase/staging.mjs push      # supabase db push --db-url <staging>
node supabase/staging.mjs reset     # supabase db reset --no-seed --yes --db-url <staging>
npm test                            # attack suite against staging
```

The raw equivalents, if you must run the CLI yourself (`$STAGING_DB_URL` is the
percent-encoded `postgresql://postgres:<password>@<host>:5432/postgres`; the pooler
needs the user `postgres.<ref>`):

```
npx supabase db push  --db-url "$STAGING_DB_URL"
npx supabase db reset --db-url "$STAGING_DB_URL" --no-seed
```

Validated in S0 (CLI 2.120.0, no Docker running):

- The direct host `db.<ref>.supabase.co:5432` was reachable from the dev machine; the pooler was not needed.
- `db push --db-url` applied all 11 legacy files to an empty project without edits.
- `db reset --db-url ... --yes` works without Docker, drops and re-applies the migrations, and **clears
  `auth.users`**. It does **not** delete `storage.objects` (a probe object survived a reset).
  Storage rows cannot be deleted with SQL (Supabase blocks it); remove them with the Storage API
  (`admin.storage.from('paseos').remove([...])`). Tests that upload create their own paths.
- Without `--yes` the reset asks for confirmation on stdin; the wrapper passes `--yes` only after
  the staging guard has accepted the configuration.

### Reset fallback (not needed so far, untested)

If a remote reset ever stops working, run this in the staging SQL editor, then `push`:

```sql
drop schema public cascade;
create schema public;
grant usage, create on schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
truncate supabase_migrations.schema_migrations;
```

## Rollback (two modes)

1. **Pre-launch (authoritative):** `git revert` the slice and reset staging to the previous
   migration set (`node supabase/staging.mjs reset`). Valid while no real users exist.
2. **Per-slice `supabase/rollback/<version>.down.sql`:** a data-preserving structural inverse
   only (copy side-table data back, drop new objects). A down script never restores a
   vulnerable policy or function. After launch, the answer to a bad policy is a forward fix.

S0 rollback: revert the rename commit and the `tests/`, `supabase/staging.mjs`, `package.json`
script changes. No application code or database object is changed by S0.

S1 rollback (identity): revert the S1 commits (migrations `20261013100001..03`, `SupaAuthForm.js`,
`signup.muten`, `authActions.ts`) and reset staging. Signup depends on `provision_negocio`, so the app
and the migrations must be reverted together. `supabase/rollback/20261013100001_s1_identity.down.sql`
only re-adds the four dropped columns; it never reopens the policies or the anonymous grants.
S2a rollback (RPC guards): revert the S2a commits (migrations `20261013110001..02`, `src/lib/data.ts`) and
reset staging. `supabase/rollback/20261013110001_s2a_guards.down.sql` only drops `grupo_asignar`; it never
recreates the `grupos write office` policy or the unguarded RPC bodies. `data.ts` and the migrations go
together: without `grupo_asignar` an office member cannot reassign a walker.
S2b1 rollback (policies, walk state, co-owners): revert the S2b1 commits (migrations `20261013120001..02`,
`src/lib/data.ts`, `EmpresaBridge.js`, `ClienteBridge.js`, `empresa.store`, `empresa.muten`) and reset staging.
`supabase/rollback/20261013120001_s2b1_policies.down.sql` only drops `perro_eliminar`, `coduenio_agregar`,
`coduenio_quitar` and `is_principal`; it never recreates the dropped dog/link/walker policies, the table
privileges or the old `paseo_*` bodies. `data.ts` and the migrations go together: without the RPCs the owner
cannot delete a dog or manage co-owners (there is no direct table path any more).
S2b2 rollback (server-side pricing): revert the S2b2 commits (migration `20261013130001_s2b2_pricing.sql`, `src/lib/data.ts`,
`cliente.muten`, `empresa.muten`) and reset staging. `supabase/rollback/20261013130001_s2b2_pricing.down.sql` only drops
`reservar`, `comprar_producto` and `cobro_marcar`; the price trigger and the non-negative CHECKs stay. `data.ts` and the migration
go together: without the RPCs a client cannot book or buy and the owner cannot mark a charge paid. Before pushing
this migration to a database with real data, check `select count(*) from prestaciones where precio_aplicado < 0`
(and the same for `servicios.precio`, `servicios.precio_mensual`, `suscripciones.precio_mensual`): the CHECKs fail on negatives.
S3 rollback (invitations): revert the S3 commits (migration `20261013140001_s3_invitations.sql`, `src/lib/data.ts`, `EmpresaBridge.js`,
`DataBootstrap.js`, `SupaAuthForm.js`, `empresa.store`, `empresa.muten`, `dashboard.muten`, `unirse.muten`, the two invitation parts) and reset
staging. `supabase/rollback/20261013140001_s3_invitations.down.sql` only re-adds an EMPTY nullable `codigo` column: dropping the plaintext
`invitaciones.codigo` is irreversible (acceptable pre-launch), hashed codes cannot be turned back into codes, and the script never reopens
anything (owners keep read-only access without the hash, `redeem_invite` keeps the email binding and attempt limit). After any rollback every
pending invitation must be revoked and created again: a lost code is never recoverable, only revoked and replaced. The migration deletes all
existing `invitaciones` rows (legacy plaintext codes with optional email cannot be migrated); run it only before launch.
Email binding limitation: production Supabase Auth has email confirmation OFF, so anyone can sign up with any address; the invitation email
binding (`redeem_invite` requires the caller's confirmed email to equal the invited one) is therefore NOT a true second factor yet. It becomes
one when confirmation is turned on (the function already refuses an unconfirmed email). The code's 70 bits, the 5-failures-per-15-minutes
limit, the 7-day expiry and single use are what protect an invitation today.
S4a1 rollback (side tables): additive slice, so `supabase/rollback/20261013150001_s4a1_tables.down.sql` simply drops `contactos`, `nomina`, `permisos`, `tarifas`, `cobros`, `perro_identidad` and the helpers `has_finanzas`, `owns_cobro`, `backfill_side_tables`. The legacy columns and policies were never touched, so nothing is reopened and the app (which still reads the old columns) is unaffected. Do not run it once S4a2 or S4b is applied. The side tables are NOT kept in sync until S4a2: re-run `select backfill_side_tables()` (service role) before S4b relies on them.
S4a2 rollback (side-table RPCs and sync): additive slice, so `supabase/rollback/20261013160001_s4a2_rpcs.down.sql` drops the four `sync_*` triggers and functions, `walks_dog`, `contacto_set`, `permiso_finanzas_set`, `servicio_guardar`, `perro_duenos_nombres`, and restores `cobro_marcar` to its S2b2 owner-only body (narrower, so nothing is reopened). Afterwards the side tables go stale again: run `select backfill_side_tables()` (service role) before anything reads them. Do not run it once S4b is applied.
S4b rollback (visibility switch, DESTRUCTIVE): `20261013170001_s4b_switch.sql` drops `profiles.telefono/zona/salario_fijo`, `servicios.precio/precio_mensual`, the money columns of `prestaciones` and `perros.microchip`, the `sync_*` triggers and `backfill_side_tables()`, and the policy `profiles update owner`. `supabase/rollback/20261013170001_s4b_switch.down.sql` re-adds the columns and copies the side-table values back (`zona` comes back empty); it never reopens a policy, grant or trigger. Pre-launch the real rollback is `git revert` plus `node supabase/staging.mjs reset`. The `seed_*.sql` files still write the legacy columns and no longer run against this schema.
S5a rollback (photo backend, additive): `supabase/rollback/20261014110001_s5a_photos.down.sql` drops `foto_registrar`, `foto_subida_autorizar`, `foto_confirmar`, `can_see_foto` and the tables `paseo_fotos`, `paseo_foto_perros` (photo metadata is lost; R2 objects expire by lifecycle). Nothing legacy was changed, so nothing is reopened and the app (still on the Storage path) is unaffected. Remove the STAGING Worker by hand: `npx wrangler@4 delete --name devdogs-fotos-staging --config worker/wrangler.toml`. The Worker is only ever deployed with `--env staging`; the production Worker and the `devdogs` bucket binding are added at release (H6).
Auth note: the E2E signup spec simulates `auth.signUp` because staging has email confirmation ON
(production has it OFF) and the built-in SMTP quota is a few emails per hour.

## Production reset (human task H6)

Valid only while there are no real users (decision D12). The reset **deletes every auth user**.

1. Confirm the chain of slice PRs is reviewed and merged, and that no real user exists.
2. Take the production connection string from the Supabase dashboard (Project settings, Database).
   Do not rely on the CLI link.
3. `npx supabase db reset --db-url "<production URL>" --no-seed` and answer `y` only after
   re-reading the ref in the URL. Do not add `--yes`.
4. Delete leftover test auth users in the dashboard; remove the legacy `paseos` bucket objects.
5. Deploy functions with an explicit `--project-ref agutaluxzruuthbbagkh`; deploy the production
   Worker and set the R2 lifecycle rule (see the later slices).
6. Check production Auth settings (email confirmation, password policy).
S7 rollback (privacy consent): revert the S7 commits (migration `20261014100001_s7_consent.sql`, `src/lib/politica.js`, `privacidad.muten`, `app.muten`, `signup.muten`, `unirse.muten`, `landing.muten`, `SupaAuthForm.js`, the S7 CSS) and reset staging. `supabase/rollback/20261014100001_s7_consent.down.sql` restores the previous `provision_negocio(text,text,text,text)` and `redeem_invite(text)` and drops the versioned ones; it KEEPS `politicas` and `consentimientos` (consent evidence is never dropped by a rollback). The app and the functions go together: the new pages send `p_politica`. Users created before S7 (fixtures, test accounts) have no consent record: pre-launch (D12) there are no real users; before onboarding real users either reset (H6) or decide a re-consent flow. Changing the policy text: bump `POLITICA_VERSION` in `src/lib/politica.js`, insert the row in `politicas` and set the old one `vigente=false` in the same migration.

S5b rollback (photo switch): `supabase/rollback/20261015100001_s5b_photos_switch.down.sql` only re-creates the hardened `paseo_agregar_foto` of S2b1. It never makes the `paseos` bucket public again, never recreates its storage policies and cannot restore the photo URLs removed from `prestaciones.detalle`. The authoritative pre-launch rollback is `git revert` of the S5b commits plus `node supabase/staging.mjs reset`. Deleting the legacy bucket is the manual step H7 (WP-1c).
S5b policy version (`20261015110001_s5b_policy_version.sql`, data only): marks the previous `politicas` row not current and adds `2026-10-15-borrador`. No down script: revert the commit and reset staging; consent rows keep pointing at the version the user saw.
Mis datos rollback (`20261019130001_mis_datos.sql`, additive): `supabase/rollback/20261019130001_mis_datos.down.sql` drops `mis_datos_exportar`, `solicitud_datos_crear`, the table `solicitudes_datos` with its rows (export the pending ones first: they carry legal deadlines) and the `profiles_nombre_len` check. Revert it together with the `/mis-datos` page.

## Data-rights requests (Ley 1581): how staff process them

Users file requests from "Mis datos" in the app (`solicitud_datos_crear`). Nobody can read or change them through the API except the author (read only), so staff work in the SQL editor of the project (service role). Terms: 10 business days for a `consulta`, 15 for `rectificacion`, `supresion` and `revocacion`, counted from the day after the request. `vence_at` counts Monday to Friday and skips Colombian public holidays (`es_festivo_co`, Ley 51 de 1983; `dias_habiles_sumar`, `20261025110004_festivos_co.sql`). Rows filed before that migration counted Monday to Friday only.

```sql
-- Pending and in-progress requests, oldest due date first, with the requester's email and name.
select s.id, s.tipo, s.estado, s.created_at, s.vence_at, s.detalle, u.email, p.nombre, p.rol
  from public.solicitudes_datos s
  left join auth.users u on u.id = s.user_id
  left join public.profiles p on p.id = s.user_id
 where s.estado <> 'respondida'
 order by s.vence_at, s.created_at;

-- Mark one as being handled.
update public.solicitudes_datos set estado = 'en_proceso' where id = '<id>';

-- Close it with the answer the user will see in the app (also send it to the user's email).
update public.solicitudes_datos
   set estado = 'respondida', respondida_at = now(), respuesta = '<respuesta>'
 where id = '<id>';
```

The user's own data for a `consulta` is what "Descargar mis datos" returns (`mis_datos_exportar()`). A `supresion` of the account is done by deleting the auth user in the dashboard after answering: the profile and every row that references it cascade, except the request rows, which stay as the proof that the request was attended (Ley 1581 art. 17) with `user_id` and `detalle` set to null (`20261025110003_solicitudes_conservar.sql`); `tipo`, `estado`, the dates and `respuesta` remain, so do not write personal data in `respuesta`. Note the requester's email elsewhere if the lawyer requires it before deleting.
Mis datos policy version (`20261019130002_politica_mis_datos.sql`, data only): marks the previous `politicas` row not current and adds `2026-10-19-borrador`; the re-consent gate asks existing users to accept it. No down script: revert the commit and reset staging.
Policy precision version (`20261020100001_politica_precisiones.sql`, data only): same pattern, adds `2026-10-20-borrador` after the text was aligned with the app (agenda on the device, no walker notes or microchip, clients do not edit dogs). No down script: revert the commit and reset staging.
Terms acceptance (`20261020110001_terminos_aceptacion.sql`): adds `politicas.documentos` (which documents a version covers, `{terminos,datos}` from `2026-10-20b-borrador`, older rows `{datos}`), so each consent row is the proof of acceptance of the general conditions that Ley 1480 art. 48 asks for. Down: `alter table public.politicas drop column documentos;` after restoring the previous current row.
Ley Kiara policy version (`20261020130001_politica_kiara.sql`, data only): same pattern, adds `2026-10-20c-borrador` (terms + data policy) after the policy listed the dog's in-heat flag and health certificate issue date. No down script: revert the commit and reset staging.
Business identity policy version (`20261020150001_politica_identidad.sql`, data only): same pattern, adds `2026-10-20d-borrador` (terms + data policy) after the policy listed the business legal identity (Ley 1480 art. 50 and 53) and who sees it. No down script: revert the commit and reset staging.
Business legal identity (`20261020140001_negocio_identidad.sql`): side table `negocio_identidad` (name or company name, NIT/CC/CE/PAS, notification address, phone, email) for Ley 1480 arts. 50 lit. a and 53; readable by every member of the business, written only by its owner through `negocio_identidad_guardar`. Down: `supabase/rollback/20261020140001_negocio_identidad.down.sql`.
Role notice and business terms (`20261022100001_aceptaciones.sql`): table `aceptaciones` (user, tipo `aviso_rol` | `terminos_negocio` | `politica_negocio`, business, version, server time), readable by its owner only; `version_vigente(tipo)` holds the current versions (mirrored by `AVISO_ROL_VERSION` / `TERMINOS_NEGOCIO_VERSION` in `src/lib/politica.js`); `aceptacion_pendiente()` / `aceptacion_registrar(tipo, version)` feed the `/aceptar-condiciones` gate; `reservar` and `comprar_producto` refuse a client without the current notice (`aviso_rol_pendiente`). Down: `supabase/rollback/20261022100001_aceptaciones.down.sql`.
Role notice policy version (`20261022100002_politica_rol.sql`, data only): same pattern, adds `2026-10-22-borrador` (terms + data policy) after the terms said what DevDogs does not do, mentioned the Términos para negocios and the data policy listed the acceptance records. No down script: revert the commit and reset staging.
Business policies (`20261022110001_politicas_negocio.sql`): table `negocio_politicas` (business, version n, sections `{clave,titulo,texto}`, publication time and author, one current row per business), readable by the members of that business only and never writable through the API; `negocio_politica_publicar(secciones)` (owner only, validated, `politica_invalida`) inserts version n+1; `aceptacion_pendiente()` asks a client for the current version of its business after the role notice and `aceptacion_registrar('politica_negocio', version)` records it; `reservar` and `comprar_producto` refuse a client that has not accepted it (`politica_negocio_pendiente`). A business without a policy blocks nobody. `version_vigente('terminos_negocio')` moves to `2026-10-22b-borrador`. Down: `supabase/rollback/20261022110001_politicas_negocio.down.sql`.
Business policies policy version (`20261022110002_politica_negocios_propias.sql`, data only): same pattern, adds `2026-10-22b-borrador` (terms + data policy) after the terms said each business may publish its own policies, which its clients accept in the app. No down script: revert the commit and reset staging.
Ley Kiara art. 7 (`20261025100001_ley_kiara_contagio.sql`): adds `perros.enfermedad_contagiosa` (written by the business owner only, like `en_celo`) and redefines `prestacion_ley_kiara()` so a dog in heat or with a contagious disease is not received or started for `paseo`, `guarderia` or `adiestramiento` (an UPDATE leaves the row as it was, an INSERT already started raises `perro_en_celo` or `perro_enfermo`); the eight-dogs rule is unchanged. Down: `supabase/rollback/20261025100001_ley_kiara_contagio.down.sql`.
Contagious disease and claims policy version (`20261025100002_politica_contagio_reclamos.sql`, data only): same pattern, adds `2026-10-25-borrador` (terms + data policy) after the terms said heat and contagious disease also hold back training and daycare and that differences with the summary are read in favour of the consumer, and the data policy listed every use, the providers' access logs and the query and claim procedure. No down script: revert the commit and reset staging.
Self-hosted fonts policy version (`20261025110001_politica_fuentes_propias.sql`, data only): same pattern, adds `2026-10-25b-borrador` (terms + data policy) after the fonts moved to `public/fonts/` and the texts stopped saying that Google Fonts can see the browser IP. No down script: revert the commit and reset staging.
Photo purge (`20261025110002_fotos_purga_cron.sql`): enables `pg_cron` and schedules `dd_purga_fotos` (`15 3 * * *` UTC) running `fotos_purgar_vencidas()` (definer, not callable through the API), which deletes the `paseo_fotos` rows past `expires_at` and the uploads left pending for a day, their tags by cascade. The R2 objects under `f/` are deleted by the bucket lifecycle rule `expire-30d-f` (prefix `f/`, expire after 30 days; on `devdogs-staging` since batch C2, replacing the unscoped `expire-30d`, so the incident copies under `r/` are kept; check with `npx wrangler r2 bucket lifecycle list <bucket>` from `worker/`). Down: `supabase/rollback/20261025110002_fotos_purga_cron.down.sql`.
Requests outlive the account (`20261025110003_solicitudes_conservar.sql`): `solicitudes_datos.user_id` is `on delete set null` and the trigger `trg_solicitudes_datos_anonimizar` clears `detalle` when it becomes null. Down: `supabase/rollback/20261025110003_solicitudes_conservar.down.sql` (refuses while orphaned rows exist; export and delete them first).
Holidays (`20261025110004_festivos_co.sql`): `es_festivo_co(date)` and `dias_habiles_sumar(date, integer)` (computed, no table; not callable through the API); `solicitud_datos_crear` uses them for `vence_at`. Down: `supabase/rollback/20261025110004_festivos_co.down.sql`.
Mandatory, minimised business identity (`20261026100001_identidad_obligatoria.sql`): `reservar` and `comprar_producto` refuse a client whose business has no `negocio_identidad` row (`negocio_sin_identidad`, Ley 1480 art. 53), checked right after the acceptance checks; the table is read only by the owner and the office staff (`is_owner() or is_office()`); every member reads its business identity through `negocio_identidad_publica()` (definer, authenticated only), where a CC/CE/PAS shows only its last 4 digits (`••••••4050`) and a NIT in full. The test fixtures seed an identity for tenants A, B and I. Down: `supabase/rollback/20261026100001_identidad_obligatoria.down.sql`.
Client cancellation (`20261026100002_reserva_cancelar.sql`): `reserva_cancelar(id)` lets an active owner of the dog cancel a `programado` service dated today or later (never a product): `cancelado` plus `detalle.cancelado_por = 'cliente'` and `cancelado_at`; `no_autorizado` (42501) or `reserva_no_cancelable` otherwise. The `cobros` row stays; only `finalizado` services are payable or summed, and `paseo_marcar` skips `cancelado`. Fees are the business's own policy. Down: `supabase/rollback/20261026100002_reserva_cancelar.down.sql`.
Review rejection causes (`20261026100003_resenas_motivo.sql`): `resenas.motivo_rechazo` (`ofensiva` | `datos_personales` | `no_relacionada` | `falsa_o_spam`); `resena_moderar(id, estado, motivo)` requires one of them to reject (`motivo_invalido`) and clears it on approval; `resena_guardar` clears it when the author edits. The author reads it (RLS "resenas read own"). Down: `supabase/rollback/20261026100003_resenas_motivo.down.sql`.
Batch C1 policy and terms versions (`20261026100004_politica_lote_c1.sql`): adds `2026-10-26-borrador` (terms + data policy: in-app cancellation, review causes, mandatory identity with a masked personal ID) and moves `version_vigente('terminos_negocio')` to `2026-10-26-borrador` (identity mandatory, contagious-disease flag, review causes). Down (function only; the `politicas` row stays as evidence): `supabase/rollback/20261026100004_politica_lote_c1.down.sql`.
Same-day cancel (`20261026110001_reserva_cancelar_hora.sql`): `reserva_cancelar` refuses a same-day booking whose `detalle.hora` already passed (Bogotá). Down: re-apply `20261026100002_reserva_cancelar.sql`.
Incidents and photo reports (`20261026120001_incidentes.sql`, Ley 2480 de 2025 arts. 15-16, Ley 1581 art. 7): table `incidentes` (business, dog, optional walk, tipo `perdida` | `lesion` | `salud` | `pelea` | `fallecimiento` | `otro`, 10-2000 characters, reporter), read by the business owner and office, the active owners of the dog and the reporter, written only by `incidente_reportar(perro, prestacion, tipo, descripcion)`: the assigned walker on his walk of today or yesterday (Bogotá), or the owner/office on any dog of the business; `no_autorizado` (42501) or `incidente_invalido`. Reporting on a walk sets `paseo_fotos.retener` on its ready, unexpired photos where the dog is tagged: `can_see_foto`, `foto_registrar` and `fotos_purgar_vencidas` keep them past 30 days (same audience). `foto_retencion_autorizar(incidente)` gives the reporter or the business the `f/` keys, which the Worker (`POST /retener/{incidente_id}`) copies to `r/`; `GET /f/{id}` falls back to `r/`. Table `fotos_reportes` (read by its author and the owner/office) and `foto_reportar(foto, motivo)` (`aparece_persona` | `aparece_menor` | `otro`, active owners of a tagged dog): a photo that is not evidence is deleted, a retained one gets `paseo_fotos.oculta` (seen only by the owner/office of its business). Photos uploaded after the report are not retained. Down: `supabase/rollback/20261026120001_incidentes.down.sql` (export `incidentes` and `fotos_reportes` first; `r/` objects stay).
Batch C2 policy and terms versions (`20261026120002_politica_lote_c2.sql`): adds `2026-10-26b-borrador` (terms + data policy: incidents, evidence photos kept past 30 days, photo reports) and moves `version_vigente('terminos_negocio')` to `2026-10-26b-borrador` (the business reports incidents and keeps the evidence). Down (function only; the `politicas` row stays as evidence): `supabase/rollback/20261026120002_politica_lote_c2.down.sql`.
TODO at release (production bucket `devdogs`, not run): scope its expiry to `f/` like staging, adding before removing so there is no gap: `npx wrangler@4 r2 bucket lifecycle add devdogs expire-30d-f f/ --expire-days 30` then `npx wrangler@4 r2 bucket lifecycle remove devdogs --name expire-30d` (only if an unscoped rule exists), from `worker/`. Never leave an unscoped expiry rule: it would delete the `r/` evidence copies.
