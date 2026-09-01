# Pages & routing

`src/app.muten` is the **root** - the single file an agent (or a person) reads first. It maps URLs to pages
and, optionally, wraps them in a persistent shell. Routing is client-side (History API, no reload), and every
route also pre-renders to static HTML at build.

## Routes

```muten
# src/app.muten
routes {
  "/"        -> home          # src/pages/home/home.muten
  "/about"   -> about
  "/404"     -> notfound      # catches any unmatched path
}
```

- Paths are **quoted strings**. The **first route is the default**.
- The page name (`home`) must match the folder under `src/pages/` (`src/pages/home/home.muten`).
- A route named `"/404"` is the catch-all for unmatched paths; without one, the first route is shown.
- Navigate with `Link "Label" -> "/path"` - client-side, no reload. Focus moves to the page's `<main>` on
  navigation (see [Accessibility](accessibility.md)).

## Route params

A `:segment` captures a URL value. The page declares it with `param <name>` and uses it as a **read-only
string** in interpolation, `when`, or expressions (it can't be mutated):

```muten
# app.muten
routes { "/product/:id" -> product }
```
```muten
# src/pages/product/product.muten
screen product
param id
Page { Title "Product {id}" }
```

Navigating `/product/1` → `/product/2` re-mounts the page with the new `id` (re-fetch the new item).

> **Naming the param.** `id` is fine for a page that only displays it, as above. But if the page also
> **filters a list** by that value (`each store.items as p where p.slug == id`), name the param something else
> (`pid`/`productId`) - every entity has an implicit `id` field, and inside a `where`/`by` predicate the param
> `id` would shadow the row's own `id`, making `where id == id` always false. See
> [Detail page by route param](patterns.md#detail-page-by-route-param).

## Guards

A guard reads a **store boolean**; if it's false on navigation, the user is redirected. When the boolean flips
(login/logout), the active route re-renders automatically:

```muten
routes {
  "/cart"  -> cart  guard auth.loggedIn else "/login"     # members only
  "/login" -> login guard not auth.loggedIn else "/"       # guests only
}
```

(`auth.loggedIn` is a member of an `auth.store` - see [Stores](stores.md).)

## The shell (persistent chrome)

Wrap every route in a `shell { … slot … }` for a navbar/footer that persists across navigation. `slot` is
where the active page mounts. The **shell has no local state** - use a [store](stores.md) for things like a
mobile menu:

```muten
shell {
  Header class("flex flex-row justify-between items-center nav") {
    Link "Home" -> "/"
    Button "☰" -> ui.toggleMenu
  }
  when ui.menuOpen { Stack class("mobile-menu") { Link "About" -> "/about" } }
  slot
  Footer { Span "© 2026" }
}
routes { "/" -> home  "/about" -> about }
```

The shell also emits a keyboard **skip-link** to the content automatically (see [Accessibility](accessibility.md)).

## Active link - automatic

The router marks the current nav link for you: any internal `<a>` whose `href` equals the current path gets
`aria-current="page"` and the class `is-active` - on shell nav links and plain page links alike. Style it in
CSS (`.is-active { … }` or `a[aria-current="page"] { … }`); there is no `class(active when …)` to write and no
route/location ref to read.

## In-page anchors - a one-page nav that works

A landing/marketing page navigates **within itself**, not between routes. Give the section a stable id and link to
it with `#`; the browser scrolls natively (the router deliberately lets `#` hrefs pass through untouched).

```muten
Nav {
  Link "Features" -> "#features"
  Link "Pricing"  -> "#pricing"
}
Section id("features") { Title "What you get" h2 }
Section id("pricing")  { Title "Plans" h2 }
```

The oracle **proves every link lands**: a `-> "#features"` with no `id("features")` on the page is `unknown-anchor`,
and a `-> "/pricing"` with no such route in `app.muten` is `unknown-route`. So a dead navbar cannot ship.

Do **not** point a section link at `-> "/"` — it reloads the page you are already on. `id()` is not allowed on `Page`
(it already owns `mu-main`, the skip-link target); put it on the `Section`/`Stack` you want to scroll to.

## `<head>` metadata

A page declares `meta { title "…" description "…" lang "…" }` → `<title>` + `<meta>` tags, applied on
navigation and baked into the static HTML. See [SEO](seo.md) for the full SEO story (sitemap, canonical,
JSON-LD - all automatic).

## The app graph - `app.map.json`

`muten map` (or any build) emits `app.map.json`: a compact index of routes + their models, state, and sources.
It's the root an agent reads to understand the whole app without grepping a component tree.

## See also
- [SEO](seo.md) - meta, sitemap, canonical from your routes.
- [Stores](stores.md) - the global booleans guards read.
- [Deployment](deployment.md) - SPA fallback (serve `index.html` for any path).
