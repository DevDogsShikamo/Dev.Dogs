# Reference - Keywords

Every keyword, grouped by role. Keywords are **lowercase**.

## Top-level declarations

| Keyword | Where | Meaning |
|---|---|---|
| `screen` | first line of a page | the page identity: `screen home` |
| `entity` | page / part | a data shape + [constraints](constraints.md): `entity User { name text required }` |
| `state` | page | page-local reactive cells: `state { q = "" : text }` |
| `store` | `.store` file | app-global reactive cells |
| `const` | page / store | a compile-time immutable scalar: `const TAX = 0.21` |
| `theme` | `theme.muten` | design values → CSS vars |
| `get` | page / store | a memoized derived value: `get count = items.length` (valid on a page too, not only in a `.store`) |
| `effect` | page / store | a reactive side-effect block (on-mount init; also derives state where a `get` can't) |
| `action` | page / store | a mutation: `action add(x: T) mutates list { … }` |
| `mutates` | on an action | the state(s) the action may change (enforced) |
| `mock` | page | inline test data for a `query` |
| `sources` | page | real data sources for a `query` |
| `api` | `app.muten` | backend base URL + default headers |
| `meta` | page | `<head>` metadata (title/description/lang) |
| `routes` | `app.muten` | URL → page map |
| `shell` | `app.muten` | persistent chrome wrapping every route; holds `slot` |
| `slot` | `shell` / `part` | outlet: the active route in a `shell`, or the caller's children in a `part` (one per part) |
| `guard` | a route | redirect on a store boolean: `guard auth.loggedIn else "/login"` |
| `param` | page | a route param: `param id` |
| `part` | `parts/*.muten` | a reusable, inlined fragment; can hold one `slot` to wrap arbitrary content |
| `use` | page / store | import host-JS functions: `use fmt from "~/lib/x.ts"` |
| `from` | with `use` | the module path |

## Control flow

| Keyword | Meaning |
|---|---|
| `when <expr> { … }` | conditional mount/unmount |
| `each <list> as <item> { … }` | list render (item is a scope var) |
| `each <list> as <item>, <i> { … }` | list render + `i` = the item's 0-based reactive position (rank when sorted) |
| `match <enum> { v -> node }` | render the matching enum arm |
| `as` | names the item in `each` / the alias in some forms |
| `if` / `else` | branching **inside an action body** (the only place) |

## Data keywords

| Keyword | Meaning |
|---|---|
| `query` | an async state backed by a source: `users = query listUsers : list<User>` |
| `live` | append to a query → WebSocket subscription |
| `every` | **not supported** - `every Ns` polling is rejected; use `live` (WebSocket) or `refetch()` from an action |
| `persist` | back a state with localStorage |
| `post` / `put` / `delete` | explicit non-REST request in an action |
| `body` | the request body for `post`/`put` |

## Operators (used in expressions)

| Keyword | Meaning |
|---|---|
| `and` / `or` / `not` | boolean logic |
| `contains` | list membership / case-insensitive substring |
| `where` | a predicate (in `each`, aggregates, `remove`/`patch`) |
| `by` | the projection in an aggregate / `sort` |
| `with` | the patch fields in `patch where … with { … }` |

See [Expressions](expressions.md) for the operator grammar, and [Constraints](constraints.md) for the
validation suffixes (`required`/`min`/`max`/`pattern`).

## See also
- [Primitives](primitives.md) · [Modifiers](modifiers.md) · [Expressions](expressions.md)
