# Working in a Muten app - guide for AI agents

This project uses **Muten**, an AI-first frontend framework. The UI is written in **`.muten` files**
(a small declarative DSL) - **not** React, JSX, Vue, Svelte or hand-written HTML/JS. No model is
trained on Muten yet, so **follow this guide instead of guessing**. Foreign code enters ONLY through explicit
escapes - `use` for JS functions, `Custom` for a vanilla-JS widget - never as the page UI itself; never add a JS bootstrap.

> ## ⛔ Before you write ANY JavaScript, STOP — Muten probably does it natively
> The most common failure is escaping to vanilla JS for UI Muten already owns. **A `Custom` is ONE leaf widget the
> platform genuinely can't express (a map, a canvas, an iframe) — never a toolbar, list, modal, or sub-app.** If
> you catch yourself writing any of these in a `.js`, delete it and use the native form:
> - **Live data from a backend** → `state { x = query feed live : list<T> }` + a `ws://` source. **Never** `new WebSocket`/`new EventSource` yourself — Muten owns the socket (reconnect + keyed reconciliation).
> - **An icon** → `Icon "lucide:name"` (Iconify, inlined, tree-shaken). **Never** inline `<svg>` or an icon package.
> - **A dropdown / modal / tabs / toast / accordion** → a page `state` + `when cond { … }` + `class(open when …)`. **Never** `createElement`/`addEventListener`.
> - **A button / list / card / badge** → native primitives (`Button -> action`, `each`, …) or the **`@muten/shadcn`** plugin (your component set). **Never** hand-roll them in JS.
> Rule of thumb: if a `Custom`'s `.js` contains a button, a socket, a list render, an icon, or a modal, it is **too big** — that's declarative Muten. Escaping when you didn't need to ships more JS, loses the oracle, and makes the app the *opposite* of what Muten is for.

> The **`muten` skill** holds everything - read it before writing `.muten`:
> - [`skills/muten/SKILL.md`](skills/muten/SKILL.md) - the language (every primitive, prop, token, escape).
> - [`skills/muten/design.md`](skills/muten/design.md) - making pages look great: styling routes, skinning the
>   auto-`Form`, modern building blocks (glass pill navbar, hero, KPI), and cloning a reference design.
> - [`skills/muten/patterns.md`](skills/muten/patterns.md) - copy-paste recipes (store-centric CRUD, dashboard
>   KPIs, kanban, calendar via a `use` date facade, async queries).

## Golden rules
- UI → `.muten` files. App-global state → `.store` files. Both compile via the `@muten/core` runner (embedded esbuild).
- **No `main.js`.** `src/app.muten` IS the entry (loaded by `index.html`). Never add a JS entry/bootstrap.
- Primitives are **PascalCase** (`Stack`, `Text`, `Button`); control flow is lowercase (`when`, `each`).
- **`class("...")`** = the single way to style (your CSS / Tailwind utilities) - layout AND look. Muten
  builds the STRUCTURE (primitives); the appearance is yours. Muten ships no skin.
- A state reference is a **bare name** (no sigil); interpolate in any string with `{expr}`: `Text "Hi, {user.name}"`.

## File map
```
src/
  app.muten                    ROOT - routes { "/url" -> page }  (+ optional shell { … slot … })
  pages/<route>/<route>.muten  a page; the folder name IS the route
  parts/<name>.muten           reusable component (composition, inlined at build). `Part(…) class("…")` at the call
                               site appends to the part root; `class` is the ONLY modifier allowed there.
  components/<Name>.js          escape hatch (host JS) used via the `Custom` primitive
theme.muten                    design tokens: space, font, weight, breakpoints
src/styles.css                 your look (.scss if you picked SCSS)
```

## A page looks like this
```
screen home

Page class("flex flex-col gap-4 p-6") {
  Title "Hello"
  Text "Body copy with reactive state: {user.name}"
  Button "Save" -> save
}
```

## Cheat-sheet
- **Layout:** `Stack` (vertical), `Page` (`<main>`), `Header`/`Nav`/`Sidebar`/`Footer` (landmarks). Horizontal = `class("flex flex-row")`.
- **Content:** `Text`, `Title "x" h2`, `Span`, `Image "{src}" alt("…")` (alt required), `Link "x" -> "/route"`, `Button "x" -> action(arg)`.
- **Data:** `DataTable @list columns(a, b)`, `Form bind(draft) submit(create)`, `SearchField bind(q)`.
- **Inputs (standalone, native):** `Select bind(x) options(a, b)`, `Checkbox bind(ok)`, `Password bind(pw)`, `Number bind(n) min(0) max(9)`, `Range bind(v) min(0) max(100)` (slider), `Date bind(d)` (native calendar). Bind-type is oracle-checked.
- **Toggle a bool in a store/query list ROW** (you can't two-way-bind a row): `Checkbox checked(t.done) -> todos.toggle(t.id)` — `checked(<bool>)` shows it, `-> action` fires the store `patch`. (Only a page-`state` list row is directly `bind`-able.)
- **Native "hard" widgets (the 20%, built-in - NO Custom, NO plugin):** `Chart @sales kind(bar) x(label) y(value)` (also line/area/point/scatter/pie/donut, auto scales/axes/legend); the raw vector layer `Svg`/`Rect`/`Circle`/`Line`/`Path`/`Arc` (geometry = reactive number exprs, `map`/`sin`/`cos` built-ins); **drag & drop** `draggable(item.id)` + `droptarget("col") on(drop: move)` (pointer-based, nested-safe).
- **Control:** `when <expr> { … }`, `each <list> as item { … }` (add a comma for the 0-based reactive index: `each xs as x, i { … }` → rank when sorted; read one back with `list.at(n)` / `list.at(n).field`).
- **Interactivity:** reactive class `class(active when isOpen)` (quote hyphenated names: `class("is-open" when x)`); events on any element `on(keydown: act, mouseenter: act)`; **`on(enter: action)`** on an input = Enter-to-submit (no Custom); a `"/404"` route catches unmatched paths.
- **State:** `state { q = "" : text  users = query listUsers : list<User> }` - query states expose `.loading/.error/.data`.
- **Backend:** `sources { x: { url, method?, headers?, body?, at? } }` feeds a `query`. Shared base+auth go in `api { base, headers }` (app.muten, named clients via `{ api: "shop" }`) - relative source urls join to `base`. GET sources pre-render at build (SSG).
- **Writes:** a source-backed list gets `create`/`update`/`delete` in an action (`orders.create(draft)` → POST/PUT/DELETE the resource, optimistic + updates the list). The action is async with reactive `name.pending`/`name.error` for UX. Local-only mutations stay `push`/`set`/`reset`/`remove`.
- **Refetch:** re-run a query with N params (search / paginate / filter): `products.refetch(q: term, page: n)` in an action → builds `?q=&page=` and reloads the list.
- **Escape hatch:** non-RESTful API? `post`/`put`/`delete` a `"client:/path"` (interpolated) with optional `body` in an action: `post "shop:/orders" body item`. Uses the client's base+headers; `mutates` is optional for pure commands.
- **JS escape (`use`):** call named JS functions behind a typed, synchronous border - `use fmt from "./lib.ts"` → `Text "{fmt(x)}"`. Also callable as a **statement in an action/effect** for a side effect (`persist(x)`, `scrollBottom()`). A visual widget Muten can't express → vanilla-JS `Custom`. Full details: SKILL §14.
- **Actions:** `action add(item: User) mutates users { users.push(item) }` - typed params in `(…)`; ops: `push/set/reset/remove/toggle/patch` + a `use` fn call for side effects; branch with `if/else`.
- **Styling:** ONE path - `class("…")`. Tailwind utilities (`class("flex flex-row gap-4 p-6")`) or your own CSS classes backed by `theme.muten`'s CSS vars (`class("card")` + `.card { padding: var(--space-lg) }`).

## Dependencies & limits
- **CSS / Tailwind / SCSS: YES** - it's a muten app; install them and use `class("…")` + your CSS.
- **React / Vue / Svelte: NO - at all.** Muten ships ZERO framework runtime; pages are `.muten` (vanilla DOM).
  A widget Muten can't express enters as a vanilla `Custom` component (SKILL §13); JS logic via `use` (§14) -
  for the foreign piece, never the whole UI.
- Routing uses **quoted string paths** (`routes { "/path" -> page }`, `Link -> "/x"`, History API; deploy serves `index.html` for any path); params (`"/product/:id"` → `param id`). **In-page nav = anchors:** `Section id("features")` + `Link "Features" -> "#features"` (native scroll). NEVER point a section link at `-> "/"` — it reloads the page you are on. The oracle proves every link lands: `unknown-anchor` / `unknown-route`. SEO: `meta { title "…" description "…" }` per page → `<head>` tags (og auto-derived). Shell has no local state → use a
  `.store`. Flip a bool with `x.toggle()`. All styling - layout and visuals - goes through `class()`.
- **Known limits (plan around these):** the runnable builds are `muten dev` (local dev, surgical HMR) and `muten bundle` (production CSR); `muten build` is the zero-JS SSG (styled + SSR'd, but can't bundle `use` functions or keep store state across full-page navigations). `Form` renders ALL entity fields (types text/email/number/bool/enum/date/password/textarea; **no** conditional fields; an unknown type is flagged `unknown-field-type`; an enum can't be `required`). `DataTable` cells are raw (format with `each`). An `Icon` name is a static literal - a per-value icon is `match` over static Icons, a data-URL icon is an `Image`. `Custom` inputs need `@` and are a snapshot. `query x live` needs the server to send a row `id`. A multi-month / date-range calendar isn't native (single-date `Date` is) → that's a `Custom`.
- The full reference (stores, routing, theme, every primitive, the limits in §3) is in [`skills/muten/SKILL.md`](skills/muten/SKILL.md).

## Commands
`npm run dev` (`muten dev` - esbuild dev server + surgical HMR) · `npm run build` (`muten bundle` - production CSR) · `npm run lint` (`muten check`).
**Scaffold structure, not boilerplate:** `muten new page /  /inbox  /product/:id` and `muten new store orders customers` write a **compiling** skeleton (routes entry + route line + page/store stub) so you fill CONTENT, not plumbing — then flesh each file out and `muten check`. Use it to add a page/store mid-build too.

## Plugins (optional)
Enabled in `muten.config`'s `plugins {}` block; `muten add <name>` installs + configures for you.
- **`muten add devtools`** → [`@muten/devtools`](https://www.npmjs.com/package/@muten/devtools): a dev-only in-app overlay (component tree · editable state · Redux-style history + time-travel · profiler · element picker). `muten dev` auto-mounts it; production omits it (zero cost).
- **`muten add Card Dialog …`** (PascalCase) → eject shadcn-style components from an installed registry (e.g. `@muten/shadcn`) into `src/parts/`.
