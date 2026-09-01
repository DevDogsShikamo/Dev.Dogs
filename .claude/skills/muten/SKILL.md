---
name: muten
description: Read and write Muten - the AI-first frontend DSL this app is built in (.muten and .store files), NOT React/Vue/HTML. Use whenever creating or editing any .muten or .store file, app.muten routes, theme.muten, parts, components, stores, or deciding what can be installed. No model is trained on Muten, so consult this before writing any Muten code or adding a dependency. Assume the human will NOT read the code - you do everything.
---

# Muten - complete language reference

Muten compiles `.muten` files to vanilla JS + fine-grained signals (no virtual DOM). The `@muten/core`
runner (embedded esbuild) does the compiling. You write a small declarative DSL for the UI - **not** React/JSX/Vue/Svelte/HTML.
Muten ships ZERO framework runtime; foreign code comes in only through explicit escapes (`use` for JS logic
functions - §14, `Custom` for a vanilla-JS widget - §13). A page with no reactivity compiles to plain
zero-runtime HTML; a reactive one ships ~1KB of signals.

## Use this as your brain for Muten — offload, don't derive
No model is trained on Muten, but you do NOT need to hold it all in your head or reason it out. Work by
**look-up and copy, not derivation** — that's what keeps a build cheap, fast and correct:
- **Building a page/screen?** Never start from a blank page. **COPY the closest showcase** reference — a complete,
  idiomatic page. The builder injects the nearest ones as `MUTEN-REFERENCE.md`; they're categorized by archetype
  (dashboard · shop/commerce · social/feed · chat/inbox · forum · CRM/admin · landing · auth & forms · settings ·
  pricing). Adapt it to this app's data, then elevate it. **Calcar → acoplar → mejorar.**
- **Unsure of a syntax or rule?** Look it up HERE — the sections below are the whole language. Open a specific
  `docs/<topic>.md` (data · stores · state · actions · lists · forms · styling · routing · parts · escapes) ONLY
  for the one thing you need. Do NOT read the whole doc set, and never read the compiler/engine source.
- **Making it look good?** Invoke the **`muten-design`** skill for the taste (layout · color · density · motion).
- **Golden rule:** if you're about to reason hard about "how would Muten do X?", stop — the answer is almost
  always already written in a section below or shown in a showcase. Find it or copy it; don't derive it.

> **Companion docs (same folder):** [`docs/`](docs/README.md) - the **complete reference** (every
> primitive/modifier/keyword + full guides: forms, accessibility, SEO, data, stores, …). This SKILL.md is the
> compressed always-on reference; open a `docs/<topic>.md` on demand when you need the full detail and the *why*.
> [`design.md`](design.md) - how to make pages look great (styling routes, the auto-Form skin, building blocks).
> [`patterns.md`](patterns.md) - copy-paste app recipes (store-centric CRUD, dashboard KPIs, kanban, `use` facades).

## Mental model & golden rules
- **UI** → `.muten` files (pages, parts, the app root, the theme). **App-global state** → `.store` files.
- **`src/app.muten` is the entry.** `index.html` loads it; the plugin boots it. **Never create `main.js`** or a `<script>` bootstrap.
- Primitives are **PascalCase** (`Stack`, `Text`); keywords/control flow are **lowercase** (`when`, `each`, `state`).
- `class("...")` is the **single way to style** - layout AND look (your CSS / Tailwind utilities); toggle reactively with `class(active when isOpen)`. Muten builds the STRUCTURE (primitives) and ships no skin.
- A reference is a **bare name** (no sigil) everywhere - `count`, `user.name`, `cart.total`. `{expr}` = interpolation inside a Text/label/path string: `Text "Hi, {user.name}"`. It also works inside `class("…")` to build a **dynamic class token** - `class("status-{user.status}")` → a reactive `status-online`/`status-idle`/… (don't write one toggle per enum value; see §2).
- Each page has **one root node**. Reactivity is automatic: reading a state in interpolation / `when` / `each` re-renders just that spot.

### Where each piece goes (the #1 thing to get right)
The syntax is small; the real skill is the **boundaries** - pick the right home and the oracle does the rest:

| You need… | Put it in | Not |
|---|---|---|
| page-local reactive data | `state {}` on the page | a store (unless shared) |
| state shared across pages | a `.store` | prop-drilling / page state |
| a derived / computed value | `get` (store) | recomputing inline |
| change state | an `action` (`mutates …`) | mutating outside an action |
| **on-mount side effect** (init an SDK, analytics, focus) | a **page `effect {}`** (or store `effect` if global) | a `Custom`; "there's no lifecycle" (there is) |
| list filter / total / membership | `where` / `sum by` / `contains` | a `use` fn with `.filter`/`.reduce`/`.some` |
| localStorage persistence | `persist` on the state | `use` + `localStorage` |
| async data load | a `query` state | a `use` fn (it's synchronous) |
| genuine foreign logic (date math, a lib, an SDK) | a **`use`** function | reimplementing a built-in |
| a chart / slider / date picker / drag&drop | a **native primitive** (`Chart`/`Range`/`Date`/`draggable`) | a `Custom` or a plugin (not needed - these are native) |
| a widget muten truly can't express (map, rich-text editor, canvas) | a **`Custom`** component | a React/Vue component (there are none) |

Rule of thumb: **declarative first** (`state`/`when`/`each`/`where`), **escape last** (`use`/`Custom`). When a piece
is in the wrong place, `muten check` says so immediately - the boundaries are *enforced*, so you don't have to memorize them.

## 1. What you CAN install / use
This is a muten project (with muten's native runner), so the whole npm ecosystem for **styling, build, and data** works:
- **Tailwind CSS - YES.** Install it (`tailwindcss`, `postcss`, `autoprefixer`), add the config + the
  `@tailwind` directives to `src/styles.css`, and use utilities via `class("flex gap-4 rounded")`.
  `class()` emits raw class names, so any CSS framework (Tailwind, UnoCSS, Bootstrap CSS, your own CSS) works.
- **Component libraries via muten plugins - YES.** The core ships NO components; plugins do. Install a registry
  package (e.g. `npm i @muten/shadcn`), then either `muten add <component>` to copy its source into `src/parts/`
  (eject + own it, the shadcn way) OR declare `plugins { shadcn {} }` in `muten.config` to use its parts as-is.
  Plugins are for **styled component sets** (Card, Dialog, Tabs, …) - not for charts/sliders/dates, which are
  native primitives (don't reach for a plugin to get a chart). See [`docs/plugins.md`](docs/plugins.md).
- **Sass/SCSS** - supported out of the box if you scaffolded with SCSS (or add `sass`); use `src/styles.scss`.
- **Data / utility npm packages** - usable inside `.store` logic, inside `Custom` host components, and via
  **`use` logic imports** (date libs, fetch wrappers, zod, etc.).
- **JS logic via `use … from "./lib.ts"` - YES.** Import named functions and call them in any expression
  (`use fmt from "./lib.ts"` → `Text "{fmt(x)}"`). The `.ts` is a facade over any npm. See §14.
- **Built-in formatting - NO `use`, NO hand-rolled JS.** Dates / initials / currency / case have **built-in
  functions, always available**: `upper` · `lower` · `initial` (first letter, for avatars) · `truncate(s, n)` ·
  `money(n)` · `ago` (relative time) · `date` · `time` · `now()` · `daysUntil` / `dayKey` / `addDays` (date math) ·
  `isToday` / `isPast` / `isFuture`. Call them directly in any expression - **do NOT write
  your own `formatTime`/`getInitials`/`Date` logic** (that ships an un-checked, often buggy escape):
  `Text "{ago(msg.time)}"`, `Text "{initial(user.name)}"`, `Text "{money(order.total)}"`,
  `Text "{date(msg.time)} at {time(msg.time)}"`. Timestamps are `text` (ISO strings); `ago`/`date`/`time` parse
  them. Only reach for `use` for logic a built-in does NOT cover (grouping, joins, custom parsing).
  **Math (for SVG/Chart geometry):** `map(v, inLo, inHi, outLo, outHi)` (linear scale) · `sin` · `cos` · `sqrt` ·
  `abs` · `round` · `floor` · `ceil` · `pow` · `min(a,b)` · `max(a,b)` · `pi()`. e.g. `Circle cy(map(p.val, 0, max, 190, 10))`,
  a radial dot `cx(cx0 + r * sin(a.ang * pi() / 180))`. (`min`/`max` are 2-arg; the list min/max is `list.min by field`.)
- **Host UI via the `Custom` primitive** - write vanilla JS in `src/components/<Name>.js` for a widget muten
  can't express natively (a **map**, a **rich-text editor**, a **canvas** scene) and mount it with `Custom`.
  (Charts, sliders and date pickers are native - `Chart`/`Range`/`Date` - don't `Custom` those.) See §Custom.

## 2. What you CANNOT do
- **No React / Vue / Svelte - at all.** Muten ships ZERO framework runtime. Pages are `.muten` → vanilla DOM;
  you don't compose the app from a React library (MUI/Chakra/the npm `shadcn/ui`). You CAN compose from
  **`@muten/shadcn`** — the shadcn component set ported to native muten PARTS (`Card`, `Combobox`, `Dialog`,
  `Avatar`, `Badge`, `Tabs`, …); enable it with `plugins { shadcn {} }` in `muten.config` and call a part like any
  primitive (`Card { CardHeader { CardTitle(label: "…") } CardContent { … } }`). For a widget Muten can't express,
  drop to a vanilla-JS `Custom` (§13); for JS logic, `use` a function (§14). There is no JSX/hooks/`className` anywhere.
- **No arbitrary inline CSS** - static styling (layout, colors, borders, shadows) ALL goes through `class("…")`
  + your CSS (Tailwind utilities, or your own classes backed by `theme.muten` vars). The one exception is a value
  that **changes at runtime** (progress width, dynamic transform): `style(w: "{pct}%")` sets a CSS variable
  `--w` reactively, and your CSS reads `var(--w)`. `style()` can ONLY set CSS variables, never arbitrary
  properties - it never competes with `class()`. Use it only for a value that changes; `class()` for everything static.

## 3. Limitations & known gaps (current - these are real, plan around them)
- **The runnable builds are `muten dev` (local dev, surgical HMR) and `muten bundle` (production CSR); `muten build` is the zero-JS SSG.** `muten build` is the zero-JS SSG export: it now
  **inlines the theme + `src/styles.css`** and **pre-renders (SSR) your stores/`query` data**, so pages ship
  fully styled with real content. Its only gaps are inherent to a no-bundler static export: `use` functions
  aren't bundled (it **warns**), and store state doesn't persist across full-page navigations. For a styled
  **stateful** app use `muten bundle`; reach for `muten build` for crawlable static/content pages.
- **Routing uses quoted string paths** (`"/path"`, History API). Params: `"/product/:id"` + `param id` (see §10).
- **Forms** (`Form` auto-renders from an entity) render EVERY field - **no conditional fields** (gate the whole
  `Form` with a `when`, or split into per-step entities). Field types: `text`/`email`/`number`/`bool`(checkbox)/
  `enum`(select)/`date`/`password`/`textarea` - anything else (`url`/`tel`/file) is `unknown-field-type` (drop to
  `Custom`). An **enum field can't be `required`**. For a REAL form (conditional fields, per-step "next until valid"),
  skip `Form` and hand-roll with the standalone inputs below + `when` + reactive `get`s (see docs/forms.md).
- **Standalone bound inputs** (usable outside a `Form`): `SearchField`/`Password` (text state), `Select`
  (text state + `options(a, b, c)`), `Checkbox` (bool state), `Number`/`Range` (a **number** state; `Range` is a
  slider — `min(0) max(100) step(5)`, numbers or a state), `Date` (a date/text state — the native `<input type=date>`
  calendar). Gate an action reactively with `disabled when <cond>` — e.g. `Button "Next" -> next disabled when pw.length < 8`.
- **Inline-editable list items** — inside `each xs as x` where `xs` is a **page-`state`** list, an input can bind
  a ROW FIELD: `SearchField bind(x.title)`, `Checkbox bind(x.done)`. Two-way: editing patches the source list
  (keyed by id, caret-safe). This is how you build editable tables, inline-edit, AND **data-driven / JSON forms**
  (fields from a `list<FieldSpec>`, each rendering `bind(f.value)`).
- **Editing a `.store` / `query` list ROW** — those rows are NOT directly `bind`-able (mutations go through actions).
  Change a field with a store ACTION (`patch where id == x`). For the common **bool toggle**, a Checkbox does it in
  one line: `Checkbox checked(t.done) -> todos.toggle(t.id)` — `checked(<bool>)` displays the row's value (one-way),
  `-> action` fires the toggle. Read-only display = `checked(<bool>)` with no `->`. For other fields, fire a
  Button/Select `-> action(row.id)`. (`bind(t.done)` on a store row is a `bind-type` error — it tells you this.)
- **`match` for enums** - `match status { active -> Text "Active"  lead -> Span "Lead" class("badge") }` renders the matching arm
  (sugar for N `when status == "x"`). **`DataTable`** shows raw cell
  text (no per-column formatting - use `each` + `Stack` for formatted/badge cells). **`sort by`** takes a
  field name, OR a `text` **state** holding the field name for a user-chosen column (`sortDesc by sortCol`).
- **`query x live`** needs the server to send a stable `id` per row, or keyed diffing rebuilds every row each push.
- **`Custom` inputs are a snapshot at mount** (reactive only if `mount` returns an updater fn - §13). **Shell has no local state** (use a `.store`).
  **Pages are single-root** (one top node). **Flip a bool** with `x.toggle()`.

## 4. Files
```
src/app.muten                    routes (+ optional shell) - the ROOT; read it first
src/pages/<route>/<route>.muten  one page; the folder name IS the route
src/parts/<name>.muten           reusable component (inlined at build time). `Part(a: 1) class("…")` at the CALL SITE
                                 appends to the part root's classes — `class` is the only modifier allowed there.
src/components/<Name>.js          host-JS escape hatch, mounted via Custom
src/<domain>.store               app-global state slice (domain = file name)
theme.muten                      token scale (space/font/weight/leading/breakpoints)
src/styles.css                   reset + look (or styles.scss)
index.html                       loads /src/app.muten via @muten/core; don't hand-edit the boot
muten.config                     build config in muten (theme adapter) - present ONLY with Tailwind/DaisyUI
```

## 5. Declarations
```
screen <name>                    # page identity (first line of a page)

entity User {                    # data shape + validation (implicit `id uuid`)
  name  text  required           # constraints: required | min:N | max:N | pattern:"<regex>"
  email email required
  role  admin | member           # `a | b | c` = enum
}

state {                          # page-LOCAL reactive state
  q     = ""              : text
  users = query listUsers : list<User>   # query → async; exposes users.loading/.error/.data
  # state types: scalar (text/number/bool/email/uuid), list<Entity>, OR list<scalar> (list<text>/list<uuid>/…).
  # an enum lives in an entity field, NOT as a state type; hold its value as text. A list of plain strings is list<text>.
  cards = [ { title: "A", desc: "x" } ] : list   # STATIC list initialized from a literal → just `: list`; the element
  #   shape is INFERRED from the literal (no `entity` needed) → `each cards as c { Text "{c.title}" }` still checks c.title.
  #   Use this for presentational lists (feature grids, nav, tabs). `each` still needs a NAMED list — never `each [ … ] as x`.
  # PERSIST to localStorage - append `persist`: `dark = false : bool persist`, `favs = [] : list<number> persist`.
  #   Auto-hydrates on load (falls back to the initial) + saves on every change → survives reload. It is THE
  #   declarative localStorage. Works HERE (page-local) AND in a `.store` for app-GLOBAL persisted state
  #   (favorites, cart, settings, theme). NEVER hand-roll load/save in a `use` fn - `persist` already does it.
}

const TAX = 0.21                 # compile-time immutable scalar (inlined, never reactive)

action add(item: User) mutates users {   # mutation; typed params in (…); `mutates` lists what it may change (enforced)
  users.push(item)               # local ops: push | set | reset | remove | toggle | patch
  users.push({ name: item.name, role: "admin" })   # inline object literal - build a record inline
  if item.vip { rating.set(5) } else { rating.set(1) }   # if/else = the only branching in actions
}

mock    { listUsers: [ { name: "Ana", role: "admin" } ] }        # mock data (quote text/enum values, like everywhere)
sources { listUsers: { url: "https://api…", at: "results" } }    # real data source for a query
```

A `sources` entry is a complete HTTP request - a bare URL, or `{ url, method?, headers?, body?, at? }`:
```
sources {
  products: "https://api.shop.com/products"                              # GET, response is the array
  orders:   { url: "https://api…/orders", headers: { Authorization: "Bearer KEY" }, at: "data" }
  search:   { url: "https://api…/graphql", method: "POST", body: { query: "…" }, at: "data" }
}
```
- `at` reads the array out of `json[at]` - dotted for nested envelopes (`"data.posts"`). Else the response IS the array. `body` is JSON-encoded (sets `content-type`).
- At build (`muten build`), **GET** sources are fetched and baked into the HTML (SSG); non-GET run only client-side (no build side-effects).
- **Headers ship to the client** like any browser fetch - use public keys or a per-user token, never a server secret.

**Don't repeat the backend - `api { }` in `src/app.muten`** sets the base URL + default headers for ALL sources:
```
# src/app.muten
api { base: "https://api.shop.com/v1"  headers: { Authorization: "Bearer KEY" } }
```
```
# any page - only what differs
sources {
  products: { url: "/products", at: "data" }     # → https://api.shop.com/v1/products, with the Authorization header
  orders:   { url: "/orders",   at: "data" }
}
```
A **relative** source url is joined to `base`; an **absolute** one (`https://…`) ignores it (other host). Source headers override the api defaults. Define the backend once.

**Multiple backends** - name the clients, pick one per source with `{ api: "name" }`:
```
# src/app.muten
api {
  shop: { base: "https://api.shop.com/v1", headers: { Authorization: "Bearer KEY" } }
  cms:  { base: "https://cms.io/api" }
}
```
```
sources {
  products: { api: "shop", url: "/products", at: "data" }
  posts:    { api: "cms",  url: "/posts",    at: "data.posts" }
}
```
No `api` field → the client named `default`. The flat `api { base, headers }` form is just a single default client.

**Writing to the backend (POST/PUT/DELETE)** - a source-backed list gets `create`/`update`/`delete` in an action, fired by an event; each hits the resource endpoint (reusing the source's `api` base + headers) and updates the list reactively:
```
state { orders = query orders : list<Order> }
sources { orders: { api: "shop", url: "/orders", at: "data" } }

action buy(item: Order)  mutates orders { orders.create(item) }   # POST   /orders       → append the result
action edit(item: Order) mutates orders { orders.update(item) }   # PUT    /orders/{id}  → replace by id
action drop(item: Order) mutates orders { orders.delete(item) }   # DELETE /orders/{id}  → remove by id

Button "Buy" -> buy(product)
```
The write action is **async** and exposes reactive **`buy.pending`** (true while in flight) and **`buy.error`** - use them for UX:
```
when buy.pending { Text "Saving…" }
when buy.error { Text "Could not save: {buy.error}" }
```
`create`/`update`/`delete` are **optimistic** - the list changes instantly, reconciles with the server response, and **reverts** if the request fails (with `.error` set). REST convention: create = POST to the collection, update/delete target `/{item.id}`. Local-only mutations stay `push`/`set`/`reset`/`remove`; `create/update/delete` talk to the server.

**Re-running a query - `refetch` (search / pagination / filters)** - call it in an action with **N named params**; they become the query string (`?q=…&page=…`, url-encoded) and the list reloads. Works for any web-app, not just lists:
```
state { q = "" : text  page = 1 : number  products = query products : list<Product> }
sources { products: { url: "/products", at: "data" } }

action search(term: text) mutates products { products.refetch(q: term, page: 1) }
action next   mutates products         { page.set(page + 1)  products.refetch(q: q, page: page) }

SearchField bind(q)
Button "Search" -> search(q)
Button "Next"   -> next
```
Pass as many params as you need (`q`, `page`, `sort`, `category`, …). The query's `.loading`/`.error` reflect the refetch.

**Live data - `query x live` (WebSocket)** - append `live` to a query to subscribe to a **WebSocket** instead of fetching: the server PUSHES, muten reacts (event-driven, NOT polling). Each message replaces the data; the **keyed reconciliation** updates only the rows whose fields changed (focus/scroll survive) and writes **batch** into one render per frame:
```
state   { prices = query prices live : list<Price> }
sources { prices: { url: "ws://feed.example.com/prices", at: "data" } }
# each prices.data as p { Text "{p.symbol}  {p.value}" }   - only changed rows touch the DOM
```
Plain `WebSocket` under the hood, exposed as one keyword; it **auto-reconnects with backoff** if the socket drops and closes automatically when the page unmounts (a malformed frame is ignored, not fatal). To SEND (e.g. a chat message) the socket is receive-only - write through an action: a `create`/`post` to the backend, or a `use`'d function that POSTs; the server then pushes the updated list back over the socket. Client-side only (deploy via `muten bundle`). Use `refetch` for user-driven refresh, `live` for server-pushed real-time. (Polling via a timer was intentionally NOT added - it isn't reactive. For *huge* live lists you still virtualize + send server-side deltas, as in any framework.)

**Escape hatch - explicit request** (when the API isn't RESTful): `post`/`put`/`delete` a `"client:/path"` (interpolated) with an optional `body`, in an action:
```
action buy(item: Order) { post "shop:/orders" body item }        # any method, any path
action cancel(o: Order) { delete "shop:/orders/{o.id}/cancel" }   # custom path, interpolated
action ping           { post "shop:/health" }                   # no body, no `mutates` needed
```
It uses the named client's base + headers; the action is async with `.pending`/`.error`. Prefer `create`/`update`/`delete` when the API is RESTful (those also update the list); reach for `post`/`put`/`delete` only when the convention doesn't fit.

## 6. Primitives
A bare string is the node's main prop. `{ }` = children. Style everything (layout + look) with `class()`.

| Primitive | Use | Example |
|---|---|---|
| `Stack` | vertical stack (flex column) | `Stack class("gap-4") { … }` |
| `Page` | page root `<main>` (one per route) | `Page class("p-6") { … }` |
| `Header`/`Nav`/`Sidebar`/`Footer` | landmarks | `Header class("flex flex-row justify-between items-center") { … }` |
| `Section`/`Article` | sectioning: a page band / self-contained content (`<section>`/`<article>`) | `Section class("py-16") { Title "Features" h2  … }` |
| `List` | semantic list `<ul>` (`List ordered` → `<ol>`); each direct child renders as `<li>` | `List class("flex flex-col gap-2") { each todos as t { Span "{t.title}" } }` |
| `Details` | native accordion `<details>`; positional string = summary; add `open` to expand | `Details "Shipping" { Text "Free returns." }` |
| `Table`/`Row`/`Cell` | native `<table>`; `Table` groups `Row`s into real `<thead>`/`<tbody>`; `Row head` → header row (`<th>`); `Cell` = a `<td>` (text or children) | `Table class("table") { Row head { Cell "Task"  Cell "Status" }  each rows as r { Row { Cell "{r.task}"  Cell "{r.status}" } } }` |
| `Text` | paragraph, interpolates | `Text "Hi, {user.name}"` |
| `Title` | heading; level keyword | `Title "Dashboard" h2` |
| `Span` | inline text | `Span "{cart.total}"` |
| `Image` | `<img>`, **alt required** | `Image "{p.image}" alt("{p.title}")` |
| `Icon` | icon via Iconify `set:name`, inlined SVG at build (tree-shaken) | `Icon "lucide:settings" class("text-xl")` |
| `Video` | `<video>`; bare-keyword flags `controls autoplay loop muted playsinline` | `Video "clip.mp4" controls` |
| `Link` | client-side nav | `Link "Catalog" -> "/catalog"` |
| `Button` | runs an action | `Button "Save" -> save(draft)` |
| `SearchField` | single-line text input bound to state | `SearchField bind(q) "Search…"` |
| `Textarea` | multi-line text input bound to a text state (standalone `<textarea>`) | `Textarea bind(msg) "Write a message…"` |
| `Password` | masked text input bound to a text state | `Password bind(pw) "Password"` |
| `Select` | dropdown bound to a text state; fixed `options()` | `Select bind(role) options(admin, member) "Role"` |
| `Checkbox` | bool: `bind` a page state (two-way), or `checked(expr)` to display + `-> action` to toggle (store/query rows) | `Checkbox bind(agree) "I accept"` · `Checkbox checked(t.done) -> todos.toggle(t.id)` |
| `Number` | numeric input bound to a number state | `Number bind(qty) min(1) max(99)` |
| `Range` | slider bound to a number state | `Range bind(volume) min(0) max(100) step(5)` |
| `Date` | native date picker bound to a date/text state | `Date bind(due)` |
| `Form` | auto-form from an entity draft | `Form bind(draft) submit(create) "Save"` |
| `DataTable` | table over a list/query (`@` sigil; raw cells, no per-column format) | `DataTable @users columns(name, email)` |
| `Chart` | native dataviz (SVG, no JS): title + `kind` (bar/line/area/point/**scatter/pie/donut**) + `x`/`y`/`color`; axes/legend auto | `Chart @sales "Revenue" kind(pie) x(month) y(revenue)` |
| `Svg` + `Rect`/`Line`/`Circle`/`Arc`/`Path`/`Group` | native vector layer (the escape UNDER Chart): marks from data, coords are number exprs (`map` scales); `Arc` = pie/donut/gauge | `Svg viewBox("0 0 200 120") { Arc cx(100) cy(105) r(85) start(-90) end(map(v,0,100,-90,90)) inner(58) } }` |
| `RowAction` | a button inside each table row | `RowAction "Delete" -> remove(row.id)` |
| `slot` | outlet inside `shell` or `part` | `slot` |
| `Custom` | host-JS escape (map / rich-text / canvas - NOT charts, those are native) | `Custom Map inputs(markers: places) on(markerClick: select)` |

**The `@` data source (`DataTable @x`, `Chart @x`, `Custom … inputs(data: @x)`)** binds ANY list source: a page
`state`/`query`, a page **`get`** (a derived list), OR a **store list** (`@orders.items`, when `items` is a
store `state` list - a store **`query`** member is the `{loading,data,error}` wrapper, so expose its array via
a `get` first, same as on a page; see [Stores](docs/stores.md#reading-a-query-through-a-store)). So the store-centric
pattern works directly - `get topCustomers = customers.sort by revenue` then `Chart @topCustomers …`; no mirroring
a `get` into a page `state` via an `effect`. **`Chart` draws one mark per row and does NOT auto-group** - for a
categorical chart (revenue *by category* from per-order rows), pre-group into a `get` first (grouping is a one-line
`use` fn; see [patterns.md](patterns.md#categorical-chart-from-transactional-data-revenue-by-category)).

Horizontal layout = a region with `class("flex flex-row")` (a `Stack` is flex-column by default; there is no
`Row` primitive). Clickable card = `Button { … }` or `Link "" -> "/x" { … }` with children instead of a label.

**Reach for the semantic container, not always `Stack`** (the output is then accessible + crawlable by default):
a real list (menu, feed, results, steps) → **`List`** (an `each` inside it becomes `<li>`; screen readers announce
"list, N items"); a distinct page band with its own heading → **`Section`**; a repeated/standalone content item
(card, post, comment, notification) → **`Article`**. `Stack` (`<div>`) is the generic fallback for layout-only
grouping. Bullets are off under `flex`/`grid`; add `class("list-disc list-inside")` to keep them.

Modifiers (after a primitive): `class("css")` · `bind(state)` · `submit(action)` ·
`where(clauses)` · `columns(a, b)` · `options(a, b)` · `alt("…")` · `inputs(k: v)` · `on(event: action)` · `aria(k: expr)` ·
`draggable(item.id)` + `droptarget("group")` (drag & drop: the card carries an id, the drop zone fires
`on(drop: move)` → `move(draggedId, "group")` — muten owns the data via `patch`; zero JS). **`on()` passes a
table-driven payload**: `on(input: setName)` → `setName(value)`, `on(keydown: f)` → `f(key)` (an action with no arg ignores it).
`disabled when <cond>` (real `disabled` on a Button/input — gate "next until valid"; `disabled` alone = always) ·
`kind(bar|line|area|point)` + `x(field)` `y(field)` `color(field)` (Chart encodings — see the primitives table).
**Charts couple to `theme.muten`** like everything else: muten emits the SVG marks with CSS classes you style —
`.mu-chart-bar`/`-line`/`-area`/`-dot`, `.mu-chart-grid`/`-tick`/`-xlabel`, `color(field)` → `.mu-chart-s0…sN`. A clean
default is scaffolded (`CHART_CSS` in `src/styles.css`). **Nothing is hardcoded** — both color AND layout read tokens,
so a `theme.muten` **`chart {}`** section reconfigures everything with no code change:
`chart { fill "#…"  "bar-radius" "8px"  "grid-dash" "2 2"  ticks "6"  "bar-gap" "0.2"  "donut-inner" "0.65"  w "360" h "220"  "pad-left" "44" }`
→ `--chart-fill` / `--chart-bar-radius` / `--chart-grid-dash` (CSS-read) + `--chart-ticks` / `--chart-bar-gap` /
`--chart-donut-inner` / `--chart-w` / `--chart-h` / `--chart-pad-*` (the runtime reads these for scale/axes/viewBox).
Plus `colors { chart-1…N }` for the series palette. For a one-off look, scope your own class on the Chart:
`Chart @d kind(bar) … class("my-style")` + `.my-style .mu-chart-bar { rx: 6px; fill: … }`.
`class()` also toggles reactively (`class(active when isOpen)`); a **hyphenated OR multi-class** name must be QUOTED
in a reactive toggle: `class("is-open" when x)`, `class("ring-2 ring-primary" when x)` (each token toggles
independently; bare `is-open` parses as a subtraction and errors). Stack several toggles on one node freely.
**Class from a value - `class("prefix-{x}")`** interpolates a state/enum value into a reactive class token
(swapped on change): `class("status-{member.status}")` → `status-online` / `status-idle` / …. Use THIS for an
enum-driven class - **don't write one `when` toggle per value** (`class("online" when s=="online") class("idle" when …)`
is the verbose anti-pattern). The reference is oracle-checked. `on(event: action)` works on **any** element
(keydown, mouseenter, change, blur, …) and calls the action - use `Button -> action(arg)` when you need an arg.
**`on(enter: action)`** is a synthetic event for inputs: it fires only on the Enter key. So a chat/search box that
submits on Enter is `SearchField bind(draft) on(enter: send)` (the action reads `draft` and `draft.reset()` clears
it via the two-way bind) - no `Custom` needed for "Enter to send + clear".

### Accessibility - `aria(...)` + what the compiler emits for free
Muten is HTML + logic, so accessibility is **expressible in the code**, not a styling concern. Two layers:

**1 · Free, by the compiler (you write nothing):** semantic tags (`Header`→`<header>`, `Nav`→`<nav>`, `Sidebar`→`<aside>`,
`Footer`→`<footer>`, `Page`→`<main>`, `Title`→`<h1…h6>`, `Button`→`<button>`, `Link`→`<a href>`); `Image` **requires** `alt`;
`Form` fields get a real `<label for/id>` + `aria-required` + the error linked via `aria-describedby`; `DataTable` headers get
`scope="col"`; `Icon` is `aria-hidden` (decorative); the shell emits a keyboard **skip-link** and focus moves to `<main>` on navigation.

**2 · `aria(key: value, …)` - write any `aria-*` / `role` on ANY node** (the bounded escape-free way to express a11y):
```
Button "✕" -> close aria(label: "Close dialog")             # icon-only button gets an accessible name
Stack aria(role: "dialog", modal: true) { … }              # role → role; other keys → aria-<key>
Button "Menu" -> ui.toggle aria(expanded: ui.open, controls: "main-nav")   # aria-expanded is REACTIVE
Stack aria(live: "polite") { Text "{results.length} results" }             # YOU opt a region into live updates
```
- Each `key` → `aria-<key>`; the special key `role` → the `role` attribute.
- A **literal** value (`"Close"`, `true`) is a static attribute; a value that **reads state** (`ui.open`) compiles to an
  `effect`, so it stays in sync - e.g. `aria(expanded: ui.open)` flips `aria-expanded` as the state flips. The oracle checks
  the refs like any expression (a renamed state → `unknown-ref`, not a silent runtime bug).
- Reach for `aria(...)` for accessible interactive widgets (menus, dialogs, tabs, disclosure) **instead of** a `Custom` escape.

## 7. Theme - how it works
`theme.muten` is the agnostic **source of design values**. muten emits each entry as a `:root` CSS custom
property your CSS / `class()` consumes - `space.md "16px"` → `--space-md: 16px`, `font.lg` → `--font-lg`,
`colors.primary` → `--color-primary`.
```
theme {
  space       { xs "4px"  sm "8px"  md "16px"  lg "24px"  xl "32px" }
  font        { sm "13px"  md "15px"  lg "20px"  xl "28px" }
  weight      { medium "500"  bold "700" }
  leading     { tight "1.2"  normal "1.5" }
  breakpoints { sm "640px"  md "768px"  lg "1024px" }
}
```
Consume the vars from `src/styles.css`: `.card { padding: var(--space-lg); font-size: var(--font-lg) }`, then
apply with `class("card")`. **No CSS/reset goes in `theme.muten`** - the reset and the look live in `src/styles.css`.

### With a CSS framework (Tailwind / DaisyUI) - muten is AGNOSTIC
`theme.muten` holds your theme VALUES; a **styling adapter** (data, in `muten.config` - the scaffolder wires it
per library) tells muten how to emit them for your library. The **muten engine knows no library**; you bring
the styling, muten emits your theme into its format. When you scaffold with Tailwind/DaisyUI you get a theme
skeleton seeded for you; plain css/scss gets an empty `theme { }` (muten emits plain `:root` vars). **Hyphenated
keys are QUOTED** (like hyphenated classes):
```
theme {
  colors { primary "#6366f1"  "base-100" "#1a1d23" }   # "base-100"/"primary-content" quoted; primary bare
  radius { box "0.75rem" }
  scheme { mode "dark" }                                # color-scheme for libraries that use it (DaisyUI)
}
```
Style with `class()` using your library's utilities (`class("bg-primary p-4 hover:bg-primary")`). **Validation of
class names is your library's job** (its IntelliSense / build) - muten doesn't check them (it's agnostic; a future
muten styling *plugin* could add per-library linting).

### Styling: one path - `class("...")`
Everything (layout AND look) is a `class("...")`. Two equivalent backings - pick ONE per app:
- **Tailwind** (the default scaffold): write utilities directly. A `Stack` is flex-column by default;
  a horizontal row is `class("flex flex-row")`.
  ```
  Stack class("flex flex-col gap-4 p-6")          # column with gap + padding
  Header class("flex flex-row justify-between items-center")
  Stack class("grid grid-cols-3 gap-4")           # 3-col grid
  Text "Total" class("text-xl font-bold")
  ```
  Responsive: prefix with Tailwind's breakpoints → `class("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4")`.
- **Library-free** (theme-only): write real CSS in `src/styles.css` using the vars `theme.muten` emits, then
  apply with a semantic class.
  ```css
  .row  { display: flex; flex-direction: row; gap: var(--space-md); }
  .card { padding: var(--space-lg); border-radius: var(--radius-md); }
  ```
  ```
  Stack class("row")            # → display:flex; flex-direction:row; gap:var(--space-md)
  Stack class("card")
  ```
  The scaffold ships base classes like `.mu-stack` (the `Stack` primitive's flex-column).

## 8. State, actions & reactivity
- `state` cells are signals; reading them in interpolation / `when` / `each` auto-updates that spot.
- `query` state is async → render with `when x.loading { … }`, then use `x.data`.
- Mutate **only** through `action`s, and only the state in `mutates` (the linter enforces it):
  - `list.push(x)` (append; auto-fills uuid fields) · `s.set(v)` · `s.reset()` · `s.toggle()` (flip a bool) · `list.remove where id == itemId`
  - **Inline object literal** (build a record without leaving Muten): `posts.push({ title: draft.title, body: draft.body })`, `draft.set({ name: c.name })`. Keys must be real fields of the entity.
  - **Edit / move / toggle an item in place**: `list.patch where id == c.id with { done: not done }` - position-preserving, list ONLY the changed fields. This is the right tool for toggle/update/move (NOT remove+push, which reorders the item to the end).
  - **Item fields are bare inside `where`/`with`** (item-implicit, like a `where`-filter). So a param must be named DIFFERENTLY from any field: `remove where id == id` is an error (both mean the field) - write `remove where id == itemId` with the param named `itemId`. The oracle flags the clash and tells you to rename.
- Control flow in the tree: `when <expr> { … }` (mount/unmount), `each <list> as item { … }` (item is a scope var). Filter a list with `where`: `each posts as p where p.published { … }` renders only matching items.
  - **Row index** - `each <list> as item, i { … }` adds `i`, the item's **0-based position** as a *reactive* number (it reindexes when the list reorders/filters). Use it for rank/numbering (`Text "{i + 1}. {item.name}"`), a top-N highlight (`class("top" when i < 3)`), or medals (`when i == 0 { … }`). Combine with sort for a live leaderboard: `each players.sortDesc by score as p, i` → `i` is the rank. Don't bake a position into your data - it goes stale on reorder; `i` never does.
- Expressions: `== != < > <= >=`, `and or not`, `contains` (case-insensitive substring / list membership),
  `+ - * /`, ternary `c ? a : b`, parentheses, refs (`user.name`, `cart.total`, `$item.x`).
- **List aggregates** - `by` projects a value per item, `where` is a predicate; item fields are bare (item-implicit). For a cart total / KPI count / "N active", NO JS needed:
  - `lines.sum by price * qty` · `todos.count where not done` · `reviews.avg by score` · `prices.min by amount` · `prices.max by amount`.
  - `.length` is the count-all; `count where cond` is the filtered count. Works in interpolation, `when`, and a `get`.
  - **`.length` on a text value** = its character count (`pw.length >= 8`, `q.length > 0`) — a real length gate, no `use` needed.
  - **Embedding in a bigger expression needs grouping `()`** (the `by`/`where` body runs to the end): `when (todos.count where not done) > 0 { … }`. Standalone (in a `get`) needs none: `get openCount = todos.count where not done`.
- **Membership - "is it selected / favorited / in the set"** - store the IDs as a **scalar list** and use `contains`:
  `state { favs = [] : list<number> persist }` (in a `.store` file), then `when favs contains movie.id { … }` or `class("on" when favs contains movie.id)`.
  `contains` is list membership for scalars (and case-insensitive substring for text). If you kept whole OBJECTS instead
  of ids, use the count form: `(favs.count where id == movie.id) > 0`. **NEVER write a `use` fn doing `items.some(x => x.id === id)`**
  - `contains` IS that, declaratively, and `persist` gives the localStorage for free. (`list<Entity> contains scalar` is
  always false - it compares object identity - which is exactly why you store the *ids*, not the objects.)
- **Sort a list** (`sort by` ascending / `sortDesc by` descending; returns a sorted COPY): `each contacts.sort by name as c { … }` ·
  `each scores.sortDesc by points as s { … }`. Use in `each` or a `get`. The key is a field name - OR a `text`
  **state** holding the field name for a **user-chosen column**: `get sorted = rows.sortDesc by sortCol` (a
  literal `by price` stays static; a ref to a `text` state `by sortCol` is the dynamic column).
- **Paginate / top-N** - `list.take(n)` returns the first `n` items (`n` = a literal or a `number` state). A
  reactive "load more": `get page = posts.take(limit)` + a button that bumps `limit`. Chains after sort:
  `posts.sortDesc by date` then `.take(10)` = "latest 10".
- **Element at a position** - `list.at(n)` returns the item at index `n` (negative counts from the end; out of
  range → nothing). Read a field of it with `list.at(n).field`. This is the dual of `each … , i`: `i` renders a
  position, `at(n)` reads one. It's what powers keyboard selection in a **combobox** (see docs/lists.md):
  `get matches = cities where name contains q` + `each matches as c, i` for the highlight + `matches.at(hi).name`
  to commit the highlighted row on Enter.
- **Add ⇄ remove from a set** - `list.toggle(x)` in an action adds `x` if absent, removes if present (the
  un-favorite / unsubscribe that a scalar `remove where` can't do): `action fav(id: number) mutates favs { favs.toggle(id) }`.
- **`match` for enums** (sugar over N `when`): renders the arm whose value the subject equals. Each arm is `value -> node`
  or `value -> { … }`; the value is the enum literal (bare or quoted). Cleaner than repeating `when status == "x"`:
  ```
  match deal.stage {
    new       -> Text "New"      class("badge")
    qualified -> Text "Qualified" class("badge badge-info")
    won       -> { Icon "lucide:check"  Text "Won" }
  }
  ```
  A reactive class per value works too: `class("badge-high" when item.priority == "high")` (quote hyphenated names).

## 9. Stores - app-global state
A `.store` file = state shared across pages, **no prop drilling**. The file name is the domain.
```
# src/ui.store   → referenced everywhere as ui.<member>
state  { menuOpen = false : bool }
get    isOpen = menuOpen                 # derived/memoized value (read as ui.isOpen)
action toggleMenu mutates menuOpen { menuOpen.toggle() }
effect { /* runs whenever the store state it reads changes */ }
```
Use it from any page/shell by name: `when ui.menuOpen { … }`, `Button "☰" -> ui.toggleMenu`. The runner
auto-detects every `.store` file. `get` = memoized; `effect` = reactive side-effect (Angular-style).
**`effect { }` also works on a PAGE** - the home for an ON-MOUNT side effect (init a 3rd-party SDK, analytics,
focus): it runs when the page mounts and re-runs on its reactive deps. (Body = mutations + `use`-fn calls.)
**A page action can CALL a store action** (composition) - `action add(d: Item) mutates draft { cart.add(d)  draft.reset() }` does
store work AND local work in one handler (e.g. add to the store, then clear the form). Wire it with `Form submit(add)`.

## 10. Routing - how it works
`src/app.muten` maps URLs to pages. It uses **quoted string paths** (`"/about"`, History API - client-side nav, no
reload); the **first route is the default**. The folder under `src/pages/` must match the page name.
*(Deploy: the host must serve `index.html` for any path - standard SPA fallback.)*
```
routes {
  "/"       -> home               # src/pages/home/home.muten
  "/about"  -> about              # static page → compiles to zero-runtime HTML
  "/cart"   -> cart guard auth.loggedIn else "/login"    # guard: a store boolean; redirect if false
  "/login"  -> login guard not auth.loggedIn else "/"    # guest-only page
}
```
Guards read a **store boolean**; when it flips (login/logout) the active route re-renders automatically.
A route named `"/404"` catches any unmatched path (otherwise the first route is shown).
Navigate with `Link "x" -> "/path"` (client-side, no reload).

**Route params:** a `:seg` in the route captures a URL value. The page declares it with `param <name>`,
then uses it as a read-only string in interpolation / `when` / expressions (it can't be mutated):
```
# app.muten
routes { "/product/:id" -> product }
# src/pages/product/product.muten
screen product
param id
Page { Title "Product {id}" }
```
Navigating `/product/1` → `/product/2` re-mounts the page with the new `id` (re-fetch the new item).

**`<head>` meta (SEO):** a page declares `meta { title "…" description "…" }` → `<title>` + `<meta>` tags
(`og:title`/`og:description` auto-derived). Applied on navigation and baked into the SSG HTML at build.
Optional `meta { lang "es" }` sets `<html lang>` (default `en`).

**SEO by nature (the build emits it - you write nothing):** `muten build` already pre-renders every route to
real crawlable HTML, and on top of that emits, for free:
- **`sitemap.xml` + `robots.txt`** - derived from your `routes` (every page is auto-discoverable; add a route → it's in the sitemap).
- per page: **`<link rel="canonical">`**, **`og:url`**, **`og:type`**, and a **JSON-LD `WebPage`** block (name/description/url) from the page's `meta {}`.
- Pass the deploy origin for ABSOLUTE urls: **`muten build --url=https://your-site.com`** (without it, sitemap/canonical are relative). The author never hand-writes a sitemap, canonical, or schema block - adding a page is enough.

### Shell (persistent chrome)
Wrap routes in a `shell { … slot … }` for a nav/footer around every page. `slot` is where the active
page mounts. The shell has **no local state** → use a store for things like a mobile menu:
```
shell {
  Header class("flex flex-row justify-between items-center nav") {
    Link "Home" -> "/"
    Button "☰" -> ui.toggleMenu class("burger")
  }
  when ui.menuOpen { Stack class("mobile-menu") { Link "About" -> "/about" } }
  slot
  Footer { Span "© 2026" }
}
routes { "/" -> home }
```

## 11. Entities, forms & validation
`entity` defines a shape + constraints. `Form bind(draft) submit(create)` auto-renders one input per
field and validates on submit (per-field `.field-error`), blocking the action if invalid.
```
entity Task { title text required  notes text  done bool }
state  { draft = {} : Task  tasks = [] : list<Task> }
action create(t: Task) mutates tasks, draft { tasks.push(t)  draft.reset() }
# in the page:  Form bind(draft) submit(create) "Add task"
```
`Form` renders EVERY field, no `when` inside it (gate the whole Form with a `when`, or split entities for a wizard).
Field types: `text`/`email`/`number`/`bool`(checkbox)/`enum`(select)/`date`/`password`/`textarea` - anything else (`url`/file) is flagged `unknown-field-type`; use a `Custom`.
An enum field **cannot be `required`**. See §3.

**Constraints** live on the entity field and are checked on submit (a failure blocks the action and shows a per-field error):
`required` · `min:N` / `max:N` (number → value bound; text → length) · **`pattern:"<regex>"`** (e.g. `zip text pattern:"^\d{5}$"`).
An **`email`** field validates its format automatically (a malformed value blocks submit). For a rule across TWO fields
(`end > start`) or async uniqueness, do it inside the submit `action` with an `if` (use a `use` fn for the async part).

## 12. Parts - reusable composition
`part` = a reusable fragment, **inlined at build** (not a runtime component). Pass OBJECTS (`$x.field`)
and ACTION callbacks (`-> $onPick(...)`). A scalar param (`text`/`number`) also takes a **literal or a ref**:
`Stat(label: "Users", value: userCount)` - quoted literals stay literals, bare names are refs.
```
# src/parts/feature.muten
part Feature(item: Feature, onPick: action) {
  Stack class("flex flex-col gap-2 card") {
    Title "{$item.title}" h3
    Text  "{$item.body}"
    Button "Choose" -> $onPick($item.id)
  }
}
# use it:  Feature(item: f, onPick: select)
```

## 13. Custom - the host-JS escape hatch
For a widget Muten genuinely can't express - a **map** (pan/zoom/tiles), a **rich-text editor**, a **canvas**
scene - write vanilla JS in `src/components/<Name>.js` and mount it with `Custom`. It receives `inputs`
(values/state) and wires DOM events to your actions via `on`. This is the ONLY way to use non-Muten UI code.
**Not for charts, sliders or date pickers** - those are native (`Chart`/`Range`/`Date`); using `Custom` for them
throws away the oracle and ships needless JS.
```
Custom Map inputs(markers: @places) on(markerClick: select)
# → src/components/Map.js defines `function mount(el, inputs, on) { ... }` (NOT `export` - see below).
#   THREE positional args: el = the host <div>, inputs = { markers }, on = { markerClick }.
#   Call a handler with `on.markerClick(payload)`; read a value with `inputs.markers`.
```
- Signature is **`mount(el, inputs, on)`** (three positional args), NOT `mount(el, { inputs, on })`.
- Define it as a plain `function mount(...)`, **not** `export function mount` - the file is inlined, so an
  `export` is a syntax error and leaves the screen blank.
- **An input value needs `@` to pass STATE: `inputs(data: @sales)` passes the array; bare `inputs(data: sales)`
  passes the literal string "sales".** Inputs are a **snapshot at mount** by default. For a Custom that must
  track LIVE data, **return an updater function** from `mount` - `return (inputs) => { …redraw… }` - and muten
  re-runs it whenever a bound `@` state it reads changes (a `mount` that returns nothing stays a snapshot,
  backward compatible). To pass a query's rows, make a `get` first: `get rows = orders.data` then `inputs(data: @rows)`.

## 14. `use` - JS logic functions
One escape that pulls in real JS/npm behind a typed, **synchronous** border. `use` named exports from a
`.ts`/`.js` file and call them in any expression:
```
use fmt, slug from "~/lib/format.ts"        # named exports ONLY (the .ts is a facade over any npm)
Text "{fmt(order.total)}"                    # called like any expression
Link "{slug(post.title)}" -> "/blog/{post.id}"
```
**Paths: prefer `~/` (absolute, from `src/`).** `~/lib/format.ts` resolves the SAME from EVERY file - no
counting `../`. Write `use x from "~/lib/format.ts"` whether you're in `src/pages/a/b.muten` or a part; it's
always `src/lib/format.ts`. (`./`/`../` relative still works, but `~/` is the canonical, location-independent form.)
A `use` function can ALSO be **called as a statement inside an action or `effect`** - a side effect (scroll,
focus, analytics) that Muten can't express:
```
use track, scrollBottom from "./fx.ts"
action send(text: text) mutates messages {
  messages.push({ role: "user", content: text })
  scrollBottom()         # use fn as a statement: a side effect, NO muten state mutated (so no `mutates` entry)
  track("sent")
}
```
> **Don't escape for what Muten already does.** Before reaching for a `use` fn, check it isn't a built-in:
> • **localStorage persistence** → the **`persist`** keyword on a state (§5), NOT a `use` fn that does `localStorage.setItem`.
> • **"is X selected / favorited"** → **`contains`** on a `list<number>` of ids (§8), NOT a JS `.some(x => x.id === id)`.
> • **filter / find / aggregate a list** → **`where` / `count where` / `sum by`** (§8), NOT `.filter`/`.find`/`.reduce`.
> A `use` fn is for genuine foreign logic (date math, a formatting lib, a 3rd-party SDK) - never to reimplement a built-in.
The call is checked like any other (undeclared → `unknown-function`). This replaces the old "every side effect
needs a `Custom` component" pattern. Keep the border **synchronous** (no async/`await`); for async I/O use a
`query` / `create` / `update` / `delete` (those are async with `.pending`/`.error`).

Import zod/date-fns/nanoid/whatever *inside* `format.ts` and expose tidy named functions; Muten sees only the
names, so the oracle still checks your calls. For a visual widget Muten can't express natively (a **map**, a
**rich-text editor**, a **canvas** scene - but NOT a chart/slider/date, those are native), drop to a vanilla-JS
`Custom` (§13) - there is no framework-component escape; Muten owns the whole UI.

## 15. Gotchas
- It is NOT JSX - PascalCase primitives + `{ }` children; no JSX/hooks/`className` anywhere.
- No `main.js`/`<script>` - `app.muten` is the entry.
- `class()` is the ONLY way to style - layout AND look (Tailwind utilities, or your CSS backed by `theme.muten` vars).
- `Image` without `alt` fails validation (`alt("")` for decorative).
- Actions may only touch their declared `mutates`.
- **The runnable builds are `muten dev` (local dev, surgical HMR) and `muten bundle` (production CSR); `muten build` is the zero-JS SSG** (styled + SSR'd, but no `use` bundling / no cross-page state - §3).
- **Paths are quoted strings** (`-> "/x"`, `routes { "/x" -> p }`); a hyphenated reactive class must be quoted (`class("is-open" when x)`).
- **`Custom` inputs need `@` to pass state** (`inputs(data: @items)`); a snapshot at mount, reactive only if `mount` returns an updater fn (§13).
- Want a library? CSS → `class()`. JS function → `use` (§14, also callable in actions). A widget → `Custom` (§13). There is no framework-component escape.

## 16. Minimal full app
```
# src/app.muten
routes { "/" -> home }

# src/pages/home/home.muten
screen home
state  { name = "" : text }
action greet(v: text) mutates name { name.set(v) }

Page class("flex flex-col gap-4 p-6") {
  Title "Hello"
  SearchField bind(name) "Your name"
  when name { Text "Hi, {name}!" }
}
```
Validate anytime: `npm run lint`.
