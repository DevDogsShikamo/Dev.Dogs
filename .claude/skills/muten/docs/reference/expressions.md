# Reference - Expressions

The expression grammar is shared by interpolation (`{…}`), `when` conditions, `class(… when cond)`, action
arguments, `get` values, and source/aggregate bodies.

## References

A bare name, dotted for members: `count`, `user.name`, `cart.total`, `$item.field` (in a [part](../parts.md)),
`item.field` (the scope var inside `each`). The oracle resolves every reference - an unknown or renamed one is
an `unknown-ref` error with the exact location.

## Operators

| Category | Operators |
|---|---|
| comparison | `==` `!=` `<` `>` `<=` `>=` |
| boolean | `and` `or` `not` |
| arithmetic | `+` `-` `*` `/` |
| membership / substring | `contains` |
| ternary | `cond ? a : b` |
| grouping | `( … )` |

```muten
when count > 0 and not done { … }
Text "{price * qty}"
Text "{count > 0 ? "in stock" : "sold out"}"
class("vip" when user.role == "admin")
when tags contains "sale" { Span "Sale" class("badge") }
```

`contains` is **list membership** for scalar lists (`favs contains id`) and **case-insensitive substring** for
text (`name contains q`). See [Lists § membership](../lists.md#membership--is-it-in-the-list).

## Interpolation

`{expr}` embeds an expression inside a string prop - a label, a path, an alt:

```muten
Text "Hi, {user.name} - {cart.count} items"
Link "Open" -> "/product/{p.id}"
Image "{p.image}" alt("Photo of {p.name}")
```

## Aggregates

`by` projects a value per item; `where` is a predicate. Item fields are bare (item-implicit):

| Form | Result |
|---|---|
| `list.length` | count of all items |
| `list.count where <cond>` | filtered count |
| `list.sum by <expr>` | sum of a projection |
| `list.avg by <expr>` | average |
| `list.min by <expr>` / `.max by <expr>` | extremes |

```muten
Text "Total: {lines.sum by price * qty}"
Text "Open: {todos.count where not done}"
```

**Embedding an aggregate in a bigger expression needs grouping `()`** (the `by`/`where` body runs to the end):
`when (todos.count where not done) > 0 { … }`. Standalone in a `get` needs none:
`get openCount = todos.count where not done`. See [Lists § aggregates](../lists.md#aggregates).

**Text `.length`** - a text-typed value (`text`/`email`/`uuid`/`date`/`password`/`textarea`) also exposes
`.length`, its **character** count, usable anywhere an expression is: `when pw.length >= 8`,
`get ok = q.length > 0`, `Text "{name.length}/50"`. Numbers and booleans have none. (`list.length` above is the
**item** count - unchanged.)

## Built-in functions

A fixed set of formatting functions is **always available** - no `use`, no import. They cover the universal
needs (dates, initials, currency, case) so you never hand-roll `Date`/string logic in a `use`:

| Function | Result |
|---|---|
| `upper(text)` / `lower(text)` | case |
| `initial(name)` | first letter, uppercased - avatar initials |
| `truncate(text, n)` | first `n` chars, + `…` if longer |
| `money(number[, "USD"])` | localized currency (`$1,234.56`) |
| `ago(isoText)` | relative time - `just now` / `5m ago` / `3h ago` / `2d ago` |
| `date(isoText)` / `time(isoText)` | short date (`Jan 5`) / short time (`3:42 PM`) |
| `datetime(isoText)` | full date + time (`Jan 5, 2024, 3:42 PM`) |
| `calendar(isoText)` | chat-style smart timestamp - `Today at 3:42 PM` / `Yesterday at …` / `Jan 5 at …` |
| `weekday(isoText)` | day name (`Monday`) |
| `now()` | the **current** time as an ISO string - stamp a new record |
| `isToday(isoText)` / `isPast(isoText)` / `isFuture(isoText)` | booleans for `when` - today? before/after now? |
| `daysUntil(isoText)` | whole days from today (negative if past) - `"in {daysUntil(due)} days"`, due-soon badges |
| `dayKey(isoText)` | the calendar day as `YYYY-MM-DD` (drops the time) - group/match by day: `when dayKey(a.date) == dayKey(cell) { … }` |
| `addDays(isoText, n)` | the date `n` days later as ISO - a deadline / reminder window |
| `before(text, sep)` / `after(text, sep)` | the part before / after the first `sep` - `before(email, "@")` → username |

```muten
Text "{initial(user.name)}"                       # avatar bubble
Text "{ago(msg.time)}"                             # "5m ago"
Text "{date(msg.time)} at {time(msg.time)}"        # "Jan 5 at 3:42 PM"
Text "{money(order.total)}"                        # "$48.20"
Text "Hi, {before(user.email, "@")}"              # the email username (no use fn)
action send mutates msgs { msgs.push({ text: draft, time: now() }) }   # stamp with now()
```

Don't hand-write `new Date().toISOString()` or an email-splitter in a `use` - these are the built-ins for it.

A timestamp is a `text` field holding an ISO string (e.g. `created text`); `ago`/`date`/`time` parse it.
Compose freely (`upper(truncate(name, 12))`). For anything NOT in this set (grouping, joins, custom parsing),
`use` a function - but never reimplement these.

## Literals

Strings `"…"` (quote text and enum values everywhere), numbers `42` / `0.21`, booleans `true` / `false`.

## See also
- [Lists](../lists.md) · [State](../state.md) · [Keywords](keywords.md)
