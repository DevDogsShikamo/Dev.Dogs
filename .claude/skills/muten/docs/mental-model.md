# Mental model

A few ideas explain almost all of Muten. Hold these and the rest follows.

## 1. Primitives + logic - it's HTML + signals, not JSX

A page is a tree of **PascalCase primitives** (`Stack`, `Text`, `Title`, `Button`, `Form`) with **lowercase
keywords** for control flow (`when`, `each`, `state`, `action`). It compiles to **vanilla DOM + fine-grained
signals** - there is no JSX, no hooks, no `className`, no virtual DOM.

```muten
Page {
  Title "Hello"
  when name { Text "Hi, {name}!" }
}
```

## 2. One root per page; structure vs look

Each page has **one root node** (usually `Page`, which is `<main>`). You build **structure** with primitives
and apply **look** with `class("…")` (your CSS / Tailwind). Muten ships no skin. See [Styling](styling.md).

## 3. Reactivity is automatic

You never wire updates. **Reading a state subscribes** that spot; **writing notifies** it. `{count}` in a
`Text`, a `when`, an `each`, a reactive `class(active when open)` - each becomes its own tiny effect that
updates only itself when the signals it read change. Writes **batch** into one render per tick. No `useState`,
no setters, no dependency arrays. See [State](state.md).

## 4. References, interpolation, and `@`

- A **reference** is a bare name everywhere: `count`, `user.name`, `cart.total`.
- **`{expr}`** interpolates inside a string: `Text "Hi, {user.name}"`, `Link "x" -> "/p/{p.id}"`.
- **`@name`** is used where state is passed as a value - e.g. `DataTable @users`, `Custom inputs(data: @sales)`.

## 5. Mutate only through actions

State is read freely but **changed only inside an `action`**, and only the cells listed in `mutates` (enforced
by the compiler). Actions are the one place with `if/else`. See [Actions](actions.md).

## 6. The escape ladder - reach for the lowest rung

Muten the *language* stays small; a Muten *app* reaches the platform through **bounded, checked escapes**:

1. **`class("…")`** - styling + CSS libraries.
2. **`Custom`** - a vanilla-JS widget Muten can't express.
3. **`use`** - a vanilla-JS logic function.

Before escaping, check the built-in exists (localStorage → `persist`, membership → `contains`, filtering →
`where`). The point of a bounded language is that the declarative path is there. See [Escapes](escapes.md).

## 7. The compile pipeline

```
.muten ─[lang]→ IR ─[compose]→ tree ─[flatten]→ Doc ─[validate]→ ✓ ─[compile]→ JS
```

The **Doc** (a flat, addressable, JSON-serializable tree) is the one thing validated, mutated, and compiled.
`muten check` runs `validate` (the oracle) without compiling; `muten build` runs the whole pipeline.

## 8. Two build modes

- **`muten bundle`** → a single-page app (client-side router, ships the tiny signals runtime).
- **`muten build`** → static SSG (zero-JS where possible, real crawlable HTML, sitemap/SEO).

See [Deployment](deployment.md).

## Next
- [Pages & routing](routing.md) · [State](state.md) · [Actions](actions.md) · [Forms](forms.md)
- the full [reference](reference/primitives.md)
