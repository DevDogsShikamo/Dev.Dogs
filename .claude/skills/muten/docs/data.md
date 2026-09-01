# Data

Muten's data layer is **HTTP, declared**. A `query` state is backed by a `source`; one `api` block sets the
backend once; CRUD writes hit REST endpoints and update the list reactively; `refetch` re-runs a query with
params; and `query x live` subscribes to a WebSocket. It's a muten project, so any backend works.

## Queries & sources

A `query` state fetches asynchronously and exposes `.loading` / `.error` / `.data`:

```muten
state   { products = query products : list<Product> }
sources { products: "https://api.shop.com/products" }      # GET, the response IS the array

Page {
  when products.loading { Text "Loading…" }
  each products.data as p { Text "{p.name} - ${p.price}" }
}
```

A `sources` entry is a complete HTTP request - a bare URL, or an object:

```muten
sources {
  orders: { url: "https://api…/orders", method: "GET", headers: { Authorization: "Bearer KEY" }, at: "data" }
  search: { url: "https://api…/graphql", method: "POST", body: { query: "…" }, at: "data.results" }
}
```

- **`at`** reads the array out of `json[at]` - dotted for nested envelopes (`"data.posts"`). Without `at`, the
  response itself is the array.
- **`body`** is JSON-encoded (and sets `content-type`).
- **Headers ship to the client** like any browser fetch - use public keys or per-user tokens, never a server secret.
- At `muten build`, **GET** sources are fetched and **baked into the HTML** (SSG); non-GET run only client-side.

## One backend, declared once - `api {}`

Put the base URL + default headers in `app.muten` so every source inherits them:

```muten
# src/app.muten
api { base: "https://api.shop.com/v1"  headers: { Authorization: "Bearer KEY" } }
```
```muten
# any page - only what differs
sources {
  products: { url: "/products", at: "data" }   # → https://api.shop.com/v1/products, with the header
}
```

A **relative** source URL is joined to `base`; an **absolute** one (`https://…`) ignores it. Source headers
override the api defaults.

### Multiple backends

Name the clients and pick one per source:

```muten
api {
  shop: { base: "https://api.shop.com/v1", headers: { Authorization: "Bearer KEY" } }
  cms:  { base: "https://cms.io/api" }
}
sources {
  products: { api: "shop", url: "/products", at: "data" }
  posts:    { api: "cms",  url: "/posts",    at: "data.posts" }
}
```

No `api` field → the client named `default`.

## Writing - REST CRUD

A source-backed list gets `create` / `update` / `delete`, fired from an action. Each hits the resource endpoint
(reusing the source's base + headers), updates the list **optimistically**, and reverts on failure:

```muten
action buy(o: Order)  mutates orders { orders.create(o) }   # POST   /orders        → append the result
action edit(o: Order) mutates orders { orders.update(o) }   # PUT    /orders/{id}   → replace by id
action drop(o: Order) mutates orders { orders.delete(o) }   # DELETE /orders/{id}   → remove by id
```

These are async with reactive `.pending` / `.error`:

```muten
when buy.pending { Text "Saving…" }
when buy.error   { Text "Could not save: {buy.error}" }
```

## Re-running a query - `refetch`

For search / pagination / filters, call `refetch` with **named params** in an action; they become the query
string (url-encoded) and the list reloads:

```muten
state { q = "" : text  page = 1 : number  products = query products : list<Product> }

action search(term: text) mutates products { products.refetch(q: term, page: 1) }
action next   mutates products, page       { page.set(page + 1)  products.refetch(q: q, page: page) }
```

The query's `.loading` / `.error` reflect the refetch.

**Path params - `{name}` in the source URL.** A refetch param that matches a `{name}` placeholder in the source
URL is substituted into the **path** (the rest become the query string). This is how you fetch a nested or
detail resource:

```muten
sources { posts: "/users/{id}/posts" }
state   { posts = query posts : list<Post> }

action loadUser(uid: number) mutates posts { posts.refetch(id: uid) }   # → GET /users/<uid>/posts
```

A `{name}` with no matching param is left literal, so call `refetch` (e.g. on mount via an action, or from a
route param) before the data is valid - the **initial** auto-fetch has no params to fill the placeholder.

## Real-time - `query x live` (WebSocket)

Append `live` to subscribe to a **WebSocket** instead of fetching: the server **pushes**, Muten reacts
(event-driven, not polling). Each message replaces the data; keyed reconciliation updates only the changed
rows (focus/scroll survive), batched to one render per frame:

```muten
state   { prices = query prices live : list<Price> }
sources { prices: { url: "ws://feed.example.com/prices", at: "data" } }

each prices.data as p { Text "{p.symbol}  {p.value}" }
```

It auto-reconnects with backoff and closes on unmount. The socket is **receive-only** - to *send* (a chat
message), write through an action (a `create`/`post`, or a `use` fn that POSTs); the server then pushes the
updated list back.

## Escape hatch - explicit request

When the API isn't RESTful, `post`/`put`/`delete` a `"client:/path"` (interpolated) with an optional `body`,
in an action:

```muten
action buy(o: Order) { post "shop:/orders" body o }            # any method, any path
action cancel(o)     { delete "shop:/orders/{o.id}/cancel" }   # custom path, interpolated
action ping          { post "shop:/health" }                   # no body, no `mutates`
```

It uses the named client's base + headers and is async with `.pending`/`.error`. Prefer `create`/`update`/
`delete` when the API is RESTful (those also update the list); reach for this only when the convention doesn't fit.

## See also
- [State](state.md) - `query` state and `.loading`/`.error`/`.data`.
- [Actions](actions.md) - where CRUD and `refetch` are called.
- [SEO](seo.md) - GET sources are baked into the static HTML at build.
