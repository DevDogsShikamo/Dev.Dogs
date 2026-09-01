# Reference - CLI

The `muten` binary ships with the app (it's a dependency of `@muten/core`). Run it via `npx muten …` or an
npm script.

```sh
muten dev    [dir]                       # dev server (native esbuild + surgical HMR; serves /_muten/graph)
muten bundle [dir]                       # production CSR build (per-route chunks + a ship-size report - each route's gzip size, so bloat is visible)
muten build  [dir] [--url=https://site.com]   # static SSG → crawlable HTML per route
muten check  [dir] [--json] [--watch]    # the oracle; --watch re-lints the app on every change
muten map    [dir] [--json]
muten add    <component...>              # copy components from an installed registry plugin into src/parts/
muten new    <page|store|app> <name...>  # scaffold STRUCTURE (routes entry + route line + a compiling skeleton) — you fill CONTENT
```

`[dir]` defaults to the current directory.

## `muten new` — scaffold structure, not boilerplate

Creates the app's *structure* so you write *content*, not plumbing. Every skeleton it writes **compiles**, so the app
is valid (and never entry-less) the moment you scaffold it — then you flesh each file out. Idempotent (an existing file
is left as-is). Operates on the current directory.

```sh
muten new page /  /inbox  /product/:id   # → src/pages/<name>/<name>.muten (with a # TODO) + its "/path" -> page line in src/app.muten.
                                         #   "/" → the home page; a :param route adds `param id`. Creates src/app.muten if missing.
muten new store orders  customers        # → src/orders.store etc. (a starter `entity` + `state { items = [ ] : list<…> }`)
muten new app                            # → ensure src/app.muten (the routes entry) exists
```

Fill each scaffolded skeleton with the real content (replace the `# TODO`; give the store its real entity fields + seed
rows), then `muten check`. Use `muten new` to add a page/store mid-build too — it wires the route + a compiling stub.

**Adapts to your app:** if `muten.config` enables `plugins { shadcn {} }`, `muten new page` seeds a **shadcn-idiom**
skeleton (semantic tokens `bg-background`/`text-foreground` + a hint to use the parts Card/Badge/Avatar/Tabs) so the app
starts, and stays, in that style. A plain app gets a minimal stub. Either way the skeleton compiles.

## `muten dev`

Starts the **dev server**: muten's own runner (embedded esbuild) compiles your `.muten` on the fly - per-route
chunks, the live oracle, theme + Tailwind, client-side routing, and **surgical HMR** on save (edit a node → only
that node re-renders; state survives). No Vite, no bundler config. This is what `npm run dev` runs.

A compile error (syntax or oracle) shows a code-frame in the terminal AND a browser overlay (file:line:col +
"did you mean"); an uncaught **runtime** error shows its own overlay. The dev server also serves
**`/_muten/graph`** - the live app graph (routes / stores / parts) an AI can read without parsing files.

## `muten bundle`

The **production CSR build** (esbuild): bundles the SPA (your `use` functions, `Custom` components, shared
cross-page state) to `./dist/` with per-route code-splitting + source maps, writes **`dist/app.map.json`** (the
app graph), and prints a **per-route ship report** (each route's JS + gzip, so bloat is visible). This is what
`npm run build` runs - the path for a **stateful** app. (For a zero-JS static export instead, use `muten build`
below.)

## `muten build`

Compiles the app to **static HTML** per route (SSG) in `./dist/`, plus the SEO machinery:

```
dist/<route>/index.html   # pre-rendered, crawlable HTML (zero-JS where possible)
dist/sitemap.xml          # one <url> per route
dist/robots.txt           # allow + Sitemap directive
dist/app.map.json         # the app graph
```

- **`--url=https://site.com`** - your deploy origin, used for **absolute** sitemap / canonical / `og:url`
  URLs. Without it they're emitted relative (with a note).
- GET `sources` are fetched at build and baked into the HTML; non-GET run client-side.
- Per page, the `<head>` gets canonical + `og:url`/`og:type` + a JSON-LD `WebPage` block.

> `muten build` ships **styled** (theme + `src/styles.css` inlined), **SSR'd** (store/`query` data pre-rendered)
> zero-JS HTML. For a **stateful** app - `use` functions, or store state that survives full-page navigations -
> build the SPA with **`muten bundle`** instead. See [Deployment](../deployment.md).

## `muten check` (alias `muten lint`)

The **deterministic oracle**: parses + validates every page (unknown state/action/part, bad token, illegal
mutation, unknown ref, type mismatch) - **no compile, no browser**, in milliseconds.

```sh
muten check                 # human-readable diagnostics; exit 1 if any error
muten check --json          # structured diagnostics: { code, loc, message, suggestion, fix } per problem
muten check --watch         # re-lint the whole app on every change (CI / agents, no dev server)
```

`--json` is the AI-first feedback loop: an agent asks "is this valid, and what did I mean?" and gets exact
locations + "did you mean…?" suggestions + auto-fixes. (The VS Code extension surfaces the same diagnostics
inline as you type, with one-click quick-fixes.)

## `muten map`

Emits **`app.map.json`** - a compact index of routes + their models, state, and sources - the root an agent
reads first to understand the whole app.

```sh
muten map                   # writes app.map.json
muten map --json            # prints it to stdout
```

## `muten add`

Copies a component's source from an **installed registry plugin** (e.g. `@muten/shadcn`) into your `src/parts/` -
the "own the source" path. It scans every dependency that has a `registry.json`, finds each named component,
copies its `.muten` (and, for a Custom-backed component, its host `.js` into `src/components/`), and pulls in
dependencies. The alternative is to import a plugin's parts as-is via `plugins {}` in `muten.config`.

```sh
muten add card badge dialog      # styled parts -> src/parts/
muten add carousel map-embed     # Custom-backed widgets -> src/parts/ + src/components/ (charts/sliders/dates are native - no add needed)
```

See [Plugins & component libraries](../plugins.md).

## See also
- [Deployment](../deployment.md) - `muten bundle` vs `muten build`.
- [SEO](../seo.md) - what `muten build --url=` emits.
- [Getting started](../getting-started.md) - the dev loop.
