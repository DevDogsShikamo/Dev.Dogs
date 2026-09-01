# Lists

Muten has a **bounded list toolkit**: rendering, filtering, aggregating, sorting, and membership - all
declarative, all checked by the oracle. There is intentionally **no raw `map`/`reduce`/`filter`** in the
language: the common list jobs have first-class forms, and anything past them is an explicit
[`use`](escapes.md) function. This keeps lists analyzable (and keeps an AI from re-deriving them by hand).

## Rendering - `each`

```muten
each todos as t {
  Text "{t.title}"
}
```

`each <list> as <item> { … }` renders the block once per item; `item` is a scope variable inside the block.
For a `query` state, iterate `.data`:

```muten
each users.data as u { Text "{u.name}" }
```

### Row index - `each list as item, i`

Add a second name after a comma to get the item's **0-based position** as a **reactive** number:

```muten
each steps as s, i { Text "{i + 1}. {s.label}" }          # 1. 2. 3. …
```

`i` reindexes whenever the list reorders or filters - so it stays correct, unlike a position baked into the
data. Because it's a plain number, ordinary comparisons work: `class("top" when i < 3)` for a top-N highlight,
`when i == 0 { … }` for a medal. Sort inside the `each` and `i` becomes a live **rank**:

```muten
each players.sortDesc by score as p, i {           # i = rank (0 = highest score)
  Span "{i + 1}"  Span "{p.name}"  Span "{p.score}"
}
```

Bump a score and the row moves *and* the ranks reindex - no JS, no stored rank field. The index var must be
named differently from the item var. Omit it (`as item`) and no index machinery is emitted (zero overhead).

### Semantic lists - `List`

`each` on its own renders items into whatever holds it (a `<div>` when that's a `Stack`). For a **real list**
(menu, feed, search results, steps), wrap the `each` in a **`List`**: it compiles to a `<ul>` and each row to an
`<li>`, so screen readers announce "list, N items" and the markup is correct.

```muten
List class("flex flex-col gap-2") {
  each todos as t { Span "{t.title}" }      # -> <ul><li><span>…</span></li> …
}
```

`List ordered` emits `<ol>`. Static children work too (`List { Span "a"  Span "b" }` → two `<li>`). Bullets are
off under `flex`/`grid`; add `class("list-disc list-inside")` to keep them. Use a plain `Stack` only when the
group is layout, not a list.

### Filtering - `where`

Render only the matching items (the item's fields are bare inside `where`):

```muten
each posts as p where p.published {
  Text "{p.title}"
}
```

## Aggregates

`by` projects a value per item; `where` is a predicate. Item fields are bare. No JS needed for a total, a
count, or an average:

```muten
Text "Total: {lines.sum by price * qty}"
Text "Open: {todos.count where not done}"
Text "Avg score: {reviews.avg by score}"
Text "Cheapest: {prices.min by amount}"
Text "Priciest: {prices.max by amount}"
```

- `.length` is the count of all items; `count where <cond>` is the filtered count.
- Works in interpolation, in a `when`, and in a `get`.
- **Embedding an aggregate in a bigger expression needs grouping `()`** (the `by`/`where` body runs to the
  end of the expression): `when (todos.count where not done) > 0 { … }`. Standalone (in a `get`) needs none:
  `get openCount = todos.count where not done`.

## Sorting - `sort` / `sortDesc`

Return a sorted **copy** (ascending with `sort by`, descending with `sortDesc by`):

```muten
each contacts.sort by name as c { Text "{c.name}" }
each scores.sortDesc by points as s { Text "{s.name}: {s.points}" }
```

The sort key is a **field name** - `sort by price`. To let the user **choose the column at runtime**, sort
by a `text` state holding the field name (a sortable table header):

```muten
state { sortCol = "price" : text }            # the chosen column
get sorted = rows.sortDesc by sortCol         # sorts by rows[sortCol]
# Button "Price" -> setSort("price")  Button "Name" -> setSort("name")
```

A **literal** field (`by price`) stays a static key; a ref to a `text` **state** (`by sortCol`) is the dynamic
column. (The oracle requires the dynamic key to be `text`.)

## Pagination / top-N - `take`

`list.take(n)` returns the first `n` items - a "load more" page or a leaderboard top-N. `n` is a literal or a
`number` state, so a button that raises a `limit` state grows the page reactively:

```muten
state { posts = query posts : list<Post>  limit = 10 : number }
get page = posts.take(limit)                  # reactive: bump `limit` -> more rows
# each page as p { … }   Button "Load more" -> more   # more: limit.set(limit + 10)
```

Combine freely: `posts.sortDesc by date` then `.take(limit)` for "latest N".

## Membership - "is it in the list?"

For a selection / favorites / "is X chosen" check, store the **ids as a scalar list** and use `contains`:

```muten
state { favs = [] : list<number> persist }     # the ids, not the objects (in a .store file)

# anywhere:
when favs contains movie.id { Icon "lucide:heart" }
class("on" when favs contains movie.id)
```

`contains` is **list membership** for scalars (and case-insensitive substring for text):
`tags contains "sale"`, `favs contains movie.id`.

To **add or remove** from such a set (favorite / un-favorite, subscribe / unsubscribe), use `toggle` in an
action - it adds the value if absent, removes it if present:

```muten
action fav(id: number) mutates favs { favs.toggle(id) }   # on a list<number>: in ⇄ out
```

(`favs.toggle(id)` is the scalar-list membership flip; `bool.toggle()` with no arg flips a boolean.)

> **Why store ids, not objects?** `list<Entity> contains <scalar>` is always false - it compares object
> identity, not a field. So a "favorites" set is a `list<number>` of ids. If you *do* have a list of objects
> and must test a field, use the count form: `(favs.count where id == movie.id) > 0`.
>
> **Never** write a `use` function doing `items.some(x => x.id === id)` - `contains` (or `count where`) *is*
> that, declaratively, and the oracle checks it. See [when NOT to escape](escapes.md#dont-escape-for-what-muten-already-does).

## Editing items in place - `patch`

To toggle or update an item **without reordering it**, use `patch` in an action (position-preserving; list
only the changed fields):

```muten
action toggle(id: uuid) mutates todos {
  todos.patch where id == id with { done: not done }
}
```

(`remove`/`push` reorder; `patch` keeps the item where it is.) See [Actions](actions.md) for the full op set.

## Inline-editable list items - `bind(x.field)`

Inside `each list as x { … }`, a bound input can bind a **field of the row** - so the list itself becomes
editable, with no per-row draft state and no action:

- `SearchField bind(x.title)`, `Password bind(x.secret)`, `Select bind(x.role) options(…)` - a **text** field
- `Checkbox bind(x.done)` - a **bool** field

It is **two-way**: as the user types, Muten patches the source list immutably - the matching element (keyed by
`id`) is replaced with the edited copy. Because the `each` reconciles by `id`, only that one row touches the
DOM, so **the caret and focus survive** the edit and typing never jumps. Reading `x.title` elsewhere
(interpolation, a `when`) already worked; this adds the write-back.

```muten
screen todos

entity Todo { title text  done bool }        # (implicit `id uuid`)

state {
  rows = [
    { id: "t1", title: "Draft the brief", done: false }
    { id: "t2", title: "Ship the deck",   done: true  }
  ] : list<Todo>                             # seed explicit ids -> stable keys while editing
}

Page class("flex flex-col gap-2 p-6") {
  List class("flex flex-col gap-2") {
    each rows as x {
      Stack class("flex flex-row gap-2 items-center") {
        Checkbox bind(x.done) "Done"
        SearchField bind(x.title) "Task title"
      }
    }
  }
}
```

- **Type-checked.** The field must exist on the row entity and its type must match the input - **text-like**
  for `SearchField`/`Password`/`Select`, **bool** for `Checkbox`. A missing field or a mismatch is a
  `bind-type` error (`bind(x.nope)` → error), the same rule a standalone bind follows.
- **Settable page-`state` source only.** The `each` must iterate a **settable page list state** (e.g. `state {
  rows = [] : list<Todo> }`). A **`.store` or `query` row is NOT directly `bind`-able** — its rows change only
  through actions, so `Checkbox bind(t.done)` over `todos.items` is a **`bind-type` error**. Change a store/query
  row with an action instead:
  - **bool toggle** (the common one) — one line, no wrapper: `Checkbox checked(t.done) -> todos.toggle(t.id)`.
    `checked(<bool>)` displays the row's value one-way; `-> action` fires the store `patch`. A plain `checked(expr)`
    with no `->` is a **read-only** display checkbox.
  - **any other field** — a Button/Select `-> action(t.id)` that runs `patch where id == t.id with { … }`.

```muten
# store row toggle — the todo checkbox
each todos.items as t {
  Stack class("flex flex-row gap-2 items-center") {
    Checkbox checked(t.done) -> todos.toggle(t.id)       # display + toggle, no bind
    Span "{t.title}" class("line-through" when t.done)
  }
}
# in todos.store:  action toggle(tid: uuid) mutates items { items.patch where id == tid with { done: not done } }
```

- **Seed explicit `id`s.** Keying is by `id`; give each seeded row an `id` so it stays the same row (and keeps
  focus) as you edit it.

This is what makes **editable tables**, **inline edit**, and **data-driven forms** declarative - see
[Data-driven / JSON forms](forms.md#data-driven--json-forms).

## The bounded toolkit, at a glance

| Job | Form |
|---|---|
| render | `each list as item { … }` |
| render + index | `each list as item, i { … }` (i = 0-based reactive position; sort → rank) |
| filter render | `each list as item where cond { … }` |
| count / total / avg / min / max | `list.count where …`, `list.sum by …`, `.avg`, `.min`, `.max` |
| sort | `each list.sort by field as item`, `sortDesc by field` (field can be a `text` state = dynamic column) |
| paginate / top-N | `list.take(n)` (n = literal or `number` state) |
| element at index | `list.at(n)` → the item at position n; `list.at(n).field` reads a field (dual of `each … , i`) |
| membership | `list contains x` · `(list.count where field == x) > 0` |
| add ⇄ remove | `list.toggle(x)` (in an action) |
| edit in place | `list.patch where … with { … }` (in an action) |
| inline field edit | `each list as x { … bind(x.field) … }` (settable list; read-only over a `query`) |

Anything beyond these (an arbitrary transform) is a [`use`](escapes.md) function - a deliberate, checked
border, not a hole in the language.

## See also
- [State & reactivity](state.md) - list state types and keyed reconciliation.
- [Actions & mutations](actions.md) - `push`/`patch`/`remove` and the rest.
- [Escapes](escapes.md) - `use` for transforms the toolkit doesn't cover.
