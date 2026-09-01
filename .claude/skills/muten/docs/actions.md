# Actions & mutations

State is **read** anywhere, but **changed only inside an `action`** - and an action may touch only the cells it
lists in `mutates`. The compiler enforces this, so a stale or accidental write is a compile error, not a
runtime surprise. Actions are also the only place with branching (`if/else`).

## Declaring an action

```muten
action add(item: Todo) mutates todos {
  todos.push(item)
}
```

- Typed params go in `(…)`. `mutates` lists every state the action may change (enforced).
- An action wired to a `Form` receives the bound draft; wired to a `Button -> add(x)` it receives `x`.

```muten
Button "Add" -> add(draft)
Form bind(draft) submit(add)
```

## The mutation op set (bounded)

Local mutations are a small, fixed vocabulary - no arbitrary assignment:

| Op | Meaning |
|---|---|
| `s.set(v)` | set a scalar |
| `s.reset()` | back to the declared initial |
| `s.toggle()` | flip a `bool` |
| `list.push(x)` | append (uuid fields auto-filled) |
| `list.push({ field: … })` | append an **inline record** built in place |
| `list.remove where <cond>` | remove matching items |
| `list.patch where <cond> with { … }` | edit matching items **in place** (position-preserving) |

```muten
action toggleDone(id: uuid) mutates todos {
  todos.patch where id == id with { done: not done }
}
action clearDone mutates todos {
  todos.remove where done
}
```

### Inline records

Build a record without leaving Muten - keys must be real fields of the entity:

```muten
action add(d: Draft) mutates posts {
  posts.push({ title: d.title, body: d.body, published: false })
}
```

### Item-implicit fields in `where` / `with`

Inside `where`/`with`, item fields are **bare** (like a filter). So a param must be named **differently** from
any field - `remove where id == id` is ambiguous (both mean the field). Name the param `itemId`:
`remove where id == itemId`. The oracle flags the clash and tells you to rename.

## Branching - `if / else`

The only control flow inside an action body:

```muten
action rate(n: number) mutates score, tier {
  score.set(n)
  if n >= 8 { tier.set("gold") } else { tier.set("silver") }
}
```

## Calling a store action (composition)

A page action can call a **store** action, doing global + local work in one handler - e.g. add to the cart,
then clear the form:

```muten
action checkout(d: Item) mutates draft {
  cart.add(d)        # a store action
  draft.reset()      # local
}
```

Wire it with `Form submit(checkout)`. See [Stores](stores.md).

## Server writes (async)

A source-backed list gets `create` / `update` / `delete` - REST writes that update the list reactively and are
**optimistic** (the UI changes instantly, reconciles with the server, reverts on failure). They're async, with
reactive `.pending` / `.error`:

```muten
state   { orders = query orders : list<Order> }
sources { orders: { api: "shop", url: "/orders", at: "data" } }

action buy(o: Order)  mutates orders { orders.create(o) }   # POST   /orders
action edit(o: Order) mutates orders { orders.update(o) }   # PUT    /orders/{id}
action drop(o: Order) mutates orders { orders.delete(o) }   # DELETE /orders/{id}
```

```muten
when buy.pending { Text "Saving…" }
when buy.error   { Text "Could not save: {buy.error}" }
```

When the API isn't RESTful, use the explicit `post`/`put`/`delete` escape (see [Data](data.md#escape-hatch--explicit-request)).

## See also
- [State & reactivity](state.md) - what actions mutate.
- [Lists](lists.md) - `push`/`patch`/`remove` in context.
- [Data](data.md) - `create`/`update`/`delete`, `refetch`, the explicit-request escape.
- [Stores](stores.md) - global actions a page action can call.
