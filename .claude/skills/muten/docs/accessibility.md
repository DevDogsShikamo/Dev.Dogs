# Accessibility

Muten is **HTML + logic**, so accessibility is part of the language, not a styling afterthought. It comes in
two layers:

1. **The floor** - correct, accessible HTML the **compiler emits for free**. You write nothing.
2. **`aria(...)`** - a modifier to **express** any `aria-*` / `role` yourself, on any node, reactively.

Together: a Muten app is accessible by default, and fully controllable where it matters - without ever
dropping to a `Custom` escape for an interactive widget.

---

## Layer 1 - what the compiler emits (the floor)

You write none of this; it falls out of using the primitives.

### Semantic HTML
Primitives map to real landmarks and elements, so the document outline and keyboard behaviour are correct:

| Primitive | Element | |
|---|---|---|
| `Page` | `<main>` | the content landmark (one per route) |
| `Header` / `Nav` / `Sidebar` / `Footer` | `<header>` / `<nav>` / `<aside>` / `<footer>` | landmarks |
| `Title "…" h2` | `<h1>`…`<h6>` | real headings |
| `Button` | `<button>` | focusable, Enter/Space, in the tab order |
| `Link "…" -> "/x"` | `<a href>` | real link, crawlable, keyboard-navigable |
| `Image "…" alt("…")` | `<img alt>` | **`alt` is required** (use `alt("")` for decorative) |

### Forms
Every `Form` field is emitted with a real `<label for>`, `aria-required` on required fields, and an error
region linked via `aria-describedby` + announced with `aria-live="polite"`. See [Forms § Accessibility](forms.md#accessibility).

### Tables, icons, search, navigation
- `DataTable` column headers are `<th scope="col">` (cells are tied to their header).
- `Icon` is `aria-hidden="true"` - icons are decorative; meaning lives in adjacent text.
- `SearchField` gets an accessible name (its placeholder, or `"Search"`).
- The **shell** emits a keyboard **skip-link** as its first element, and focus moves to `<main>` on client-side
  navigation - so keyboard and screen-reader users land on the new page's content, not back at the top of the chrome.
- The **router** marks the current nav link automatically: any internal `<a>` whose `href` equals the current
  path gets `aria-current="page"` and the class `is-active` - style it in CSS, you don't hand-wire it (see
  [Routing § Active link](routing.md#active-link---automatic)).

### What is deliberately NOT automatic
`aria-live` is **not** put on every `when`/`each` - blanket live regions are *bad* a11y (they announce
everything). You opt a region into live updates yourself, with `aria(live: "polite")` - see below.

---

## Layer 2 - the `aria(...)` modifier

Write any `aria-*` attribute (or `role`) on **any** node, the same way you write `class(...)` or `on(...)`:

```muten
Button "✕" -> close aria(label: "Close dialog")            # an icon-only button gets a name
Stack aria(role: "dialog", modal: true) { … }              # role → role; modal → aria-modal
Button "Menu" -> ui.toggle aria(expanded: ui.open, controls: "main-nav")
Stack aria(live: "polite") { Text "{results.length} results" }
```

### Rules
- Each `key: value` becomes **`aria-<key>`**; the special key **`role`** becomes the `role` attribute.
- The value is a full **expression**:
  - a **literal** (`"Close"`, `true`, `3`) → a **static** attribute;
  - a value that **reads state** (`ui.open`) → **reactive**: it compiles to an effect, so e.g.
    `aria(expanded: ui.open)` flips `aria-expanded` between `"true"`/`"false"` as the state changes.
- The **oracle checks the refs** like any expression: `aria(expanded: opne)` is an `unknown-ref` error at
  compile time, with the exact location - not a silent runtime bug.

### When to use which
- Prefer **semantic HTML** (a real `Button`, a real `Title hN`) over re-creating it with `role`.
- Use **`aria(...)`** for the parts semantics can't express: an accessible name on an icon-only control,
  `aria-expanded`/`aria-controls` for a disclosure or menu, `role`/`aria-modal` for a dialog,
  `aria-live` for a status region you choose to announce.
- This is the reason you **don't** need a `Custom` escape for an accessible interactive widget - `aria(...)`
  keeps it in declarative, oracle-checked Muten.

## Quick reference

```muten
aria(label: "…")              # aria-label   - accessible name
aria(labelledby: "id")        # aria-labelledby
aria(describedby: "id")       # aria-describedby
aria(role: "dialog")          # role
aria(expanded: open)          # aria-expanded (reactive)
aria(controls: "menu-id")     # aria-controls
aria(current: "page")         # aria-current
aria(live: "polite")          # aria-live (status regions you choose)
aria(hidden: true)            # aria-hidden
```

Any `aria-*` attribute works - the key after `aria(` is whatever follows `aria-` in HTML.

> Skip `aria(current: "page")` for **nav highlighting** - the router already sets it (see above). Reach for it
> yourself only outside nav, e.g. marking the current step of a stepper.

## See also
- [Forms & validation](forms.md) - the accessible form the compiler builds for you.
- [Modifiers reference](reference/modifiers.md) - `aria` alongside `class`, `on`, `bind`, …
