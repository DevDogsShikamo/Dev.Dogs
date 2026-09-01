# Building & deploying

Muten has **two build modes**. Pick by what the app is.

| | `muten bundle` | `muten build` |
|---|---|---|
| Output | a single-page app (one `index.html` + JS) | static HTML per route (SSG) |
| Navigation | client-side router (no reload) | each route is its own page (full load) |
| Ships | the tiny signals runtime + your app | zero JS where possible |
| Styles (theme + stylesheet) | **bundled** ✓ | **inlined** ✓ |
| Stores / `query` data | **bundled** ✓ | inlined + **pre-rendered (SSR)** ✓ |
| `use` functions | **bundled** ✓ | **omitted** (warns - needs a bundler) |
| SEO | `<head>` updated on navigation | full: pre-rendered HTML + sitemap/robots/canonical/JSON-LD |
| Best for | apps (dashboards, SaaS, anything stateful/styled) | content/marketing/catalog where crawlability matters |

**Most real apps use `muten bundle`** - it bundles everything (your CSS, `use` functions, stores) into a stateful
SPA. `muten build` is the zero-JS SSG path for crawlable static content: it **inlines the theme + project
stylesheet** and **pre-renders (SSR) your stores/`query` data** into the HTML, so each page ships fully styled
with real content. The one thing it can't inline is a `use` function (external TS - no bundler in the SSG); it
**warns** and you switch to `muten bundle`. Store state also doesn't persist across full-page navigations (each
static page loads fresh) - again `muten bundle` for a stateful multi-page app. See [SEO](seo.md) for the metadata.

## The SPA fallback

A single-page app (`muten bundle`) routes on the client, so the host must **serve `index.html` for any path** -
otherwise a deep link (`/products`) 404s before the router runs. Every static host has a way to do this:

```json
// vercel.json  (scaffolded with --vercel)
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

(Netlify: a `_redirects` with `/* /index.html 200`; Nginx: `try_files $uri /index.html`.)

## Deploying the SSG output

`muten build` writes plain static files - deploy `dist/` to any static host. Pass your origin so the sitemap
and canonical URLs are absolute:

```sh
muten build --url=https://your-site.com
```

The output is just HTML/CSS/JS - ideal for a plain-static host (e.g. Vercel's HTML hosting), no framework
runtime to configure.

## Desktop - Tauri

Scaffold with `--tauri` (or add Tauri later) to wrap the **same** `muten bundle` output as a native app. Tauri
points its `frontendDist` at `dist/` and its `devUrl` at the muten dev server (`muten dev`); the `.muten` frontend runs in the
OS webview with no bundled browser. The SPA build is the right mode for a webview (load `index.html` once,
route in memory). A backend command (Rust `invoke`) is reached from Muten via a [`use`](escapes.md) function or
a `Custom`.

## Mobile - installable app, or an .apk

There is **no mobile build**. The same `muten bundle` output is the app; a phone runs the same Chromium your
desktop does. Three tiers, and only the last one installs anything:

| You want | You install | How |
|---|---|---|
| An installable app (icon, fullscreen, offline) | nothing | `public/manifest.webmanifest` - open the site on a phone, Chrome ▸ Install |
| An `.apk` | nothing | scaffold `--android`, push: `.github/workflows/apk.yml` builds it on a runner that already has the SDK |
| An `.apk` locally (+ emulator) | a toolchain, into `~/.muten` | `npm run android` — it says what's missing, and `muten android --install` gets it (~800MB, no PATH/admin, `rm -rf ~/.muten` undoes it) |

```sh
npm run android          # → android/app/build/outputs/apk/debug/app-debug.apk
muten android --build ~/some/app     # the same thing from anywhere: muten takes a path
```

**`npm run android` is the whole thing** (it is `muten android --build`): it checks the toolchain, generates
`android/` if missing, bundles, syncs, runs Gradle, and prints the file. There is no order to learn and nothing
to `cd` into — never run Gradle by hand. `muten android` alone just diagnoses; `--install` fetches a JDK 21 + the
SDK into `~/.muten` and points the project at them via `local.properties`/`gradle.properties`, so nothing needs
environment variables.

`--android` writes a `capacitor.config.json` whose `webDir` is `dist/` - Capacitor bundles that folder into the
`.apk` as local assets and a system-WebView loads it, so the app is offline by construction (nothing is
fetched; no hosting, no service worker). `android/` is generated for you and gitignored: it is disposable,
never edit it. Play Store uploads an `.aab` (`./gradlew bundleRelease` from `android/`), not the `.apk`.

Two things the page itself needs, both already in the scaffolded `index.html`: `viewport-fit=cover` on the
viewport meta (without it `env(safe-area-inset-*)` is 0 and an installed app is letterboxed on a notched
phone), and the `<link rel="manifest">`. **Touch targets adapt on their own** via `@media (pointer: coarse)` -
do not build a separate mobile layout, and do not reach for a Material/iOS component library.

To test on a real phone: `muten dev` prints a `/_qr` page. Scan it - the app runs on the phone with live
reload, no SDK and no cable. `npm run android:live` does the same *inside* the .apk, but you only need that
for a native plugin (camera, push) the browser doesn't have.

## Package manager / runtime

The app is a normal muten project, so any package manager works (`--pm npm|pnpm|yarn|bun`). Running the muten
build under **Bun** is faster to start than Node; the bundler and plugins are unchanged.

## See also
- [SEO](seo.md) - the SSG metadata.
- [Routing](routing.md) - why the SPA fallback is needed.
- [Getting started](getting-started.md) - the dev/build scripts.
