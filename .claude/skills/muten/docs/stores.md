# Stores - app-global state

A `.store` file holds state shared across pages, with **no prop drilling**. The file name is the domain, and
every member is referenced as `domain.member` from any page or shell. The runner auto-detects every
`.store` file - you don't register them.

## A store

```muten
# src/ui.store   → referenced everywhere as ui.<member>
state  { menuOpen = false : bool }
get    isOpen = menuOpen                          # derived / memoized value (read as ui.isOpen)
action toggleMenu mutates menuOpen { menuOpen.toggle() }
effect { /* runs whenever the store state it reads changes */ }
```

Use it anywhere by name:

```muten
when ui.menuOpen { Stack class("menu") { … } }
Button "☰" -> ui.toggleMenu
```

## Members

| Member | Meaning |
|---|---|
| `state { … }` | the app-global reactive cells (same types + `persist` as page state) |
| `get name = <expr>` | a **memoized** derived value (recomputes when its inputs change) |
| `action … mutates …` | a global mutation (same op set as a page action) |
| `effect { … }` | a reactive side-effect - re-runs when the store state it reads changes (Angular-style) |
| `query` + `sources` | an async data fetch - legal in a store, not only on a page |

## Reading a `query` through a store

A store can own its domain's data fetch too - `query` + `sources` aren't page-only:

```muten
# src/products.store
state   { items = query items : list<Product> }
sources { items: { url: "/products", at: "data" } }

get list = items.data     # the array - read products.list, NOT @products.items directly
```

A store `query` still exposes `.data`/`.loading`/`.error`, not the array itself - `@products.items` on a query
member is that `{loading,data,error}` wrapper, same as on a page. Expose the array with a `get` and read
`products.list` everywhere else.

A store **write** action (`create`/`update`/`delete`) exposes `.pending`/`.error` too, as
`store.action.pending`/`store.action.error` - same as a page action, and **action-global**: true while ANY
row's write is in flight, not per-row (`when products.add.pending { Text "Saving…" }`).

## App-global persistence

`persist` works in a store, which is the right home for state that must **survive reload and be shared** -
favorites, a cart, settings, theme:

```muten
# src/cart.store
state  { items = [] : list<number> persist }       # the ids; persisted to localStorage
get    count = items.length
action add(id: number)    mutates items { items.push(id) }
action remove(id: number) mutates items { items.remove where id == id }
```

```muten
# any page:
Span "🛒 {cart.count}"
Button "Add" -> cart.add(product.id)
class("in-cart" when cart.items contains product.id)
```

See [State § persist](state.md#persist--localstorage-declaratively) and [Lists § membership](lists.md#membership--is-it-in-the-list).

## Page → store composition

A **page** action can call a **store** action, doing global and local work in one handler:

```muten
# on a page
action checkout(d: Item) mutates draft {
  cart.add(d.id)     # store action
  draft.reset()      # local
}
```

Wire it with `Form submit(checkout)` or `Button -> checkout(x)`.

## Guards read store booleans

Route guards in `app.muten` read a store boolean; when it flips, the active route re-renders:

```muten
# src/auth.store
state  { loggedIn = false : bool persist }
action login  mutates loggedIn { loggedIn.set(true) }
action logout mutates loggedIn { loggedIn.set(false) }
```
```muten
routes { "/cart" -> cart guard auth.loggedIn else "/login" }
```

See [Routing § Guards](routing.md#guards).

## See also
- [State & reactivity](state.md) - types, signals, `persist`.
- [Actions](actions.md) - the mutation op set (shared with stores).
- [Routing](routing.md) - guards.
