# evDogs — MVP (Muten)

App de gestión para paseadores de perros. Frontend en **Muten** (framework de Jhornan / karttofer),
PWA instalable, pensada para móvil y adaptable a web.

## Pantallas
- **Login / Sign up** — autenticación (mock; cualquier credencial entra).
- **Inicio (dashboard)** — KPIs del día + agenda.
- **Agenda (calendario)** — bloques por servicio, check-in/out, cobro.
- **Servicios** — catálogo de la empresa, activar/pausar.
- **Estadísticas** — charts nativos de Muten (barras + donut).
- **Empresa** — información y edición.

## Correr
```bash
npm install
npm run dev      # servidor de desarrollo (abre en el navegador; no necesita emulador)
npm run lint     # el "oráculo" de Muten valida sin navegador
npm run build    # bundle de producción (CSR) → dist/  (~23 KB gzip toda la app)
```

## Estructura
```
src/
  app.muten            # rutas + shell (appbar + tabbar), guards de auth
  *.store              # estado global: auth, empresa, servicios, agenda, estadisticas
  pages/<ruta>/*.muten # una pantalla por carpeta
  lib/money.ts         # formato COP (use fn)
theme.muten            # tokens de diseño (colores evDogs, espaciados, radios)
src/styles.css         # el "look" (Muten trae estructura; el skin es tuyo)
.claude/               # referencia COMPLETA de Muten (tu IA la lee para escribir Muten correcto)
```

## Notas de arquitectura (para el siguiente paso)
- Todo el estado vive en `.store` con `get`s derivados (patrón recomendado, escalable).
- La autenticación es un mock (`auth.store`). Al conectar Supabase: reemplazar `auth.login`
  por Supabase Auth y las listas mock por `query` + `sources` apuntando a tus Edge Functions.
- El formato COP y cualquier lógica JS va por `use` (frontera tipada y chequeada).
- Los datos de ejemplo (citas, servicios, stats) están en las stores; se cambian por
  `query`/`sources` sin tocar las pantallas.
