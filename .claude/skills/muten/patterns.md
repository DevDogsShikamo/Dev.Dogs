# Muten recipes - proven app structures

Copy-paste skeletons that lint + run. Pair with `SKILL.md` (language) and `design.md` (look). These are the
shapes that work; adapt the names. All verified by building real apps.

## App skeleton (routes + shell)
```
# src/app.muten
routes {
  "/"          -> dashboard
  "/customers" -> customers
}
shell {
  Stack {
    Nav class("row gap-md pad-md divider") {
      Link "Dashboard" -> "/"          class("nav-link")
      Link "Customers" -> "/customers" class("nav-link")
    }
    Stack { slot }
  }
}
```
The folder under `src/pages/<name>/<name>.muten` must match the route's page name. First route = default.

## Store-centric data (the recommended architecture)
App-global data lives in a `.store`; pages read it by domain name. **Derive everything in the store as `get`s**
(filters, sums, counts) - pages just iterate `domain.<get>`. This is cleaner AND sidesteps cross-page type friction.
```
# src/customers.store   → referenced everywhere as customers.<member>
entity Customer { name text required  company text  email email required  status lead | active | churned }

state { items = [
  { name: "Sarah Chen", company: "Northwind", email: "sarah@nw.io", status: "active" }
] : list<Customer> }

get count  = items.length
get active = items.count where status == "active"
get leads  = items.count where status == "lead"

action add(c: Customer)              mutates items { items.push(c) }
action remove(cid: text)             mutates items { items.remove where id == cid }
action setStatus(cid: text, s: text) mutates items { items.patch where id == cid with { status: s } }
```
- Iterating a store list in a page works: `each customers.items as c { Text "{c.name}" }`.
- A page redefines the `entity` for its own `Form` draft (entities don't cross the store border - small, expected dup).
- `remove`/`patch where id == cid`: name the param DIFFERENTLY from the field (`cid`, not `id`).

## Store-centric CRUD over a REST backend
A `.store` can hold `query` + `sources` too - they're legal in a store, not only on a page. Read the query
through a `get` (`items.data`, **not** `@contacts.items` directly - a raw store query member is the
`{loading,data,error}` wrapper; expose the array with a `get`), and aggregate over that same `get`:
```
# src/contacts.store
entity Contact { name text required  email email required  status lead | active }

state   { items = query items : list<Contact> }
sources { items: { url: "/contacts", at: "data" } }   # api { base } in app.muten sets the host once

get list  = items.data                                  # the array - read THIS, not @contacts.items
get leads = items.data.count where status == "lead"     # aggregate over the same get

action add(c: Contact) mutates items { items.create(c) }   # POST   /contacts
action edit(c: Contact) mutates items { items.update(c) }   # PUT    /contacts/{id}
action drop(c: Contact) mutates items { items.delete(c) }   # DELETE /contacts/{id}
```
```
# any page
DataTable @contacts.list columns(name, email, status)     # Chart @ works the same over a get - pre-group first
                                                            # for a categorical chart (see the recipe above)
when contacts.add.pending { Text "Saving…" }               # action-global: true while ANY row's write is in flight
when contacts.add.error   { Text "Could not save" class("text-red-600") }
```
Same store, three jobs: fetch (`query`+`sources`), derive (`get`), write (`action … mutates`). A page only
touches `contacts.list`/`contacts.leads` and calls `contacts.add`/`edit`/`drop` - never the raw query member.

## Dashboard with KPIs (aggregates - no JS)
```
screen dashboard
use money from "~/lib/money.ts"
Page class("pad-lg gap-lg") {
  Stack class("grid grid-cols-2 lg:grid-cols-4 gap-md") {
    Stack class("pad-lg gap-xs card") {
      Text "Customers" class("muted t-sm semibold")
      Text "{customers.count}" class("t-xl bold")
    }
    Stack class("pad-lg gap-xs card") {
      Text "Pipeline" class("muted t-sm semibold")
      Text "{money(deals.pipeline)}" class("t-xl bold")
    }
  }
}
```
Aggregates: `list.count where cond` · `list.sum by field` · `list.avg by field` · `list.max by field` · `list.length`.
They work over state, a query, OR a `get` (e.g. `get won = items where stage == "won"` then `get wonValue = won.sum by amount`).

## Categorical chart from transactional data (revenue by category)
A bar/pie chart wants **one row per category**, but your data is **one row per order**. `Chart` draws one mark
per row (it does NOT auto-group), so pre-group the rows into a `get`, then point `Chart @` at that `get` (a
`Chart @` binds a page **state / query / get** OR a **store list** - anything that resolves to a list). Grouping
isn't a built-in, so the group step is a one-line `use` fn (the checked JS escape):
```
# ~/lib/rollup.ts  →  export function byCategory(orders) {
#   const m = new Map(); for (const o of orders) m.set(o.category, (m.get(o.category) ?? 0) + o.amount);
#   return [...m].map(([category, revenue], i) => ({ id: String(i), category, revenue })); }
screen dashboard
use byCategory from "~/lib/rollup.ts"
entity CatRevenue { category text  revenue number }             # types the grouped rows
state { orders = query orders : list<Order> }
get revByCat = byCategory(orders.data) : list<CatRevenue>        # derived list, one row per category
Page {
  Chart @revByCat kind(bar) x(category) y(revenue)              # @ a get - no page-state mirror, no effect
}
```
Key point: **`Chart @` takes a `get` (or a store list) directly** - you do NOT need to mirror it into a page
`state` via an `effect`. If your orders live in a store, `get revByCat = byCategory(orders.items)` in the store (or
the page) and `Chart @revByCat` works the same. Only reach for `use` for the *grouping*; the chart itself is native.

## List + search + add + delete (CRUD)
```
screen customers
entity Customer { name text required  company text  email email required  status lead | active | churned }
state { draft = {} : Customer  q = "" : text }
action create(c: Customer) mutates draft { customers.add(c)  draft.reset() }   # page action CALLS the store action

Page class("pad-lg gap-lg") {
  SearchField bind(q) "Search…" class("mu-field")
  Form bind(draft) submit(create) "Add customer"          # auto-renders one input per field; skin .mu-field (see design.md)

  List class("flex flex-col gap-3") {                       # a real <ul>; each row is a self-contained <li><article>
    each customers.items as c where c.name contains q or c.company contains q {
      Article class("row between center pad-lg card") {
        Stack class("gap-xs") { Text "{c.name}" class("semibold")  Text "{c.company}" class("muted t-sm") }
        Stack class("row center gap-sm") {
          when c.status == "active" { Text "active" class("badge badge-active") }
          when c.status == "lead"   { Text "lead"   class("badge badge-lead") }
          when c.status == "lead"   { Button "Activate" -> customers.setStatus(c.id, "active") class("btn") }
          Button "Delete" -> customers.remove(c.id) class("btn-danger")
        }
      }
    }
  }
}
```

## Detail page by route param
`"/product/:pid" -> product` + `param pid` in the page. Render the one matching row with `each … where` (0 or
1 iterations), or read a scalar off it with a `get` + `.at(0)`:
```
# app.muten
routes { "/product/:pid" -> product }
```
```
# src/pages/product/product.muten
screen product
param pid

get match = products.items where slug == pid        # filtered list - 0 or 1 row

Page {
  each products.items as p where p.slug == pid { Title "{p.name}" }   # render the row
  Text "{match.at(0).name}"                                            # or read one scalar off the match
}
```
**Never name the param `id`.** Every entity has an implicit `id` field, so inside a `where`/`by` predicate the
param `id` shadows the row's own `id` field - `where id == id` compares the row to itself and is always
`false`. Name it `:pid` / `:productId` instead. (The oracle's `item-shadow` check catches the clash, but the
canonical pattern is to never write it in the first place.)

## Kanban / pipeline (one column per enum value)
One `each … where` per stage (each column filters by its stage value). Advance a card with `patch where … with`
(position-preserving). For a per-card badge that varies by stage, use `match card.stage { … }` inside the column.
```
state { draft = {} : Deal }
action create(d: Deal) mutates draft { deals.add(d)  draft.reset() }

Stack class("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-md") {
  Stack class("pad-md gap-sm panel") {
    Text "New" class("muted t-sm bold")
    each deals.items as d where d.stage == "new" { DealCard(item: d) }
  }
  Stack class("pad-md gap-sm panel") {
    Text "Qualified" class("accent t-sm bold")
    each deals.items as d where d.stage == "qualified" { DealCard(item: d) }
  }
}
# src/parts/dealcard.muten - a part can reference stores + use + when inside
# use money from "~/lib/money.ts"
# part DealCard(item: Deal) {
#   Stack class("pad-md gap-xs panel") {
#     Text "{$item.title}" class("semibold")
#     Text "{money($item.amount)}" class("bold")
#     when $item.stage == "new"       { Button "Qualify" -> deals.advance($item.id, "qualified") class("btn") }
#     when $item.stage == "qualified" { Button "Win"     -> deals.advance($item.id, "won") class("btn") }
#   }
# }
```

## Combobox / searchable select (type-to-filter + keyboard)
No Custom widget: a `SearchField` + a computed filtered list + `each … , i` for the highlight + `at(hi)` to commit.
Click OR keyboard (↑ ↓ move, Enter picks, Esc clears). Scales past what a native `<select>` handles well.
```
entity City { name text }
state { q = "" : text  hi = 0 : number  chosen = "" : text  cities = [ … ] : list<City> }
get matches = cities where name contains q
get hits    = matches.count where true

action typed mutates hi { hi.set(0) }                                  # new query → reset highlight
action pick(c: City) mutates chosen, q, hi { chosen.set(c.name)  q.set(c.name)  hi.set(0) }
action nav(k: text) mutates hi, chosen, q {                            # on(keydown:) passes the key
  if k == "ArrowDown" { hi.set(min(hi + 1, hits - 1)) }
  if k == "ArrowUp"   { hi.set(max(hi - 1, 0)) }
  if k == "Enter"     { chosen.set(matches.at(hi).name)  q.set(matches.at(hi).name) }
  if k == "Escape"    { q.set("") }
}

SearchField bind(q) "Type a city…" on(input: typed) on(keydown: nav)
when q.length > 0 {
  each matches as c, i { Button "{c.name}" -> pick(c) class("hl" when i == hi) }
}
```
Style `.hl` however you like. The whole thing is declarative + oracle-checked - the highlight is `i == hi`, the
commit reads `matches.at(hi)`. (A multi-select tag input is the same shape over a `list<text>` with `toggle`.)

## Dates / calendar
**Picking one date** is native, no Custom: `Date bind(due)` renders `<input type=date>` (the browser's calendar
popup), and `Form` has a `date` field. Date **math + formatting are built in** too - `daysUntil` / `dayKey` /
`addDays` / `now` / `ago` / `date` / `time` (no `use`). What's NOT built in is **calendar-grid layout** (the
42-cell month, for a range/availability view): for that, a `use` fn anchors an ISO string and returns the cells
`each` iterates, with field access on the items.
```
# src/lib/cal.ts (named exports)
#   export function addMonths(anchor, n) {...}
#   export function monthLabel(anchor) {...}           // "June 2026"
#   export function monthCells(anchor) {...}           // [{ day, iso, inMonth, today }, ...] (42 cells)
screen calendar
use addMonths, monthLabel, monthCells from "~/lib/cal.ts"
state { anchor = "2026-06-01" : text }
get cells = monthCells(anchor)
action prev mutates anchor { anchor.set(addMonths(anchor, -1)) }
action next mutates anchor { anchor.set(addMonths(anchor, 1)) }

Page {
  Stack class("row center gap-md") {
    Button "‹" -> prev   Text "{monthLabel(anchor)}"   Button "›" -> next
  }
  Stack class("grid grid-cols-7 gap-xs") {
    each cells as c {
      Stack class("pad-sm gap-xs card") class("is-dim" when not c.inMonth) class("is-today" when c.today) {
        Text "{c.day}" class("t-sm")
        each events.items as e where e.date == c.iso { Text "{e.title}" class("badge") }
      }
    }
  }
}
```
Note: nested `each` works; a reactive class can be multi-token (`class("ring-2 ring-primary" when c.today)`).

## `use` - JS logic facade (formatting, dates, anything synchronous)
```
# src/lib/money.ts
export function money(n: number): string { return "$" + (n || 0).toLocaleString("en-US"); }
```
```
use money from "~/lib/money.ts"
Text "{money(deal.amount)}"          # → $48,000
```
Keep `use` SYNCHRONOUS. For async I/O use a `query` / `create` / `update` / `delete` (those expose `.pending`/`.error`).

## Async data (query) + writes
```
state   { products = query products : list<Product> }
sources { products: { url: "/products", at: "data" } }   # api { base } in app.muten sets the host once
when products.loading { Text "Loading…" }
each products.data as p { Text "{p.title}" }

action buy(p: Product)  mutates products { products.create(p) }   # POST,   optimistic
action drop(p: Product) mutates products { products.delete(p) }   # DELETE /{id}
```
