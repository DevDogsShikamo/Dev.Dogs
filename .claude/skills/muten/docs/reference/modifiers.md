# Reference - Modifiers

Modifiers come **after** a primitive's positional args and attach a prop. They compose freely on one node - as
**siblings**, never nested inside each other's `()`. Write `Stack class("card") aria(live: "polite") { … }`, NOT
`Stack class("card" aria(…))` (the JSX-props instinct - the oracle rejects it with a message that points you
to the sibling form).

| Modifier | Applies to | What it does |
|---|---|---|
| `class("…")` | any | styling - layout AND look (Tailwind utilities or your CSS). Reactive toggles too. |
| `bind(state)` | `SearchField`, `Password`, `Select`, `Checkbox`, `Form` | two-way bind to a state cell |
| `checked(expr)` | `Checkbox` | display a bool one-way (a store/query row you don't own); pair with `-> action` to toggle. Alternative to `bind` — exactly one of the two |
| `submit(action)` | `Form` | the action to run on a valid submit |
| `disabled when <cond>` | `Button`, `RowAction`, `SearchField`, `Password`, `Select`, `Checkbox`, `Form` | reactively set the real `disabled` prop; bare `disabled` = always disabled |
| `where(clauses)` | `DataTable` | filter clauses: `where(role == admin, name contains @q)` |
| `columns(a, b)` | `DataTable` | which fields to show: `columns(name, email)` |
| `options(a, b)` | `Select` | the fixed choice list (bare idents; value = label): `options(founder, engineer, other)` |
| `alt("…")` | `Image` | **required** accessible/SEO alt text (`alt("")` for decorative) |
| `inputs(k: v)` | `Custom` | values passed to a host-JS widget (`@` to pass state) |
| `on(event: action)` | any | wire a DOM event to an action |
| `aria(k: expr)` | any | `aria-*` / `role` attributes - accessibility, reactive |
| `style(k: "…")` | any | bind a **dynamic CSS value** to state via a CSS variable `--k` (progress, transforms) |
| `id("…")` | any (not `Page`) | a stable DOM id — the target an in-page anchor scrolls to: `Section id("features")` + `Link "Features" -> "#features"`. A **static literal**, so the oracle proves every `#anchor` lands |

## `class(...)`

The single styling path. Static classes, reactive toggles, and a class interpolated from a value:

```muten
Stack class("flex flex-col gap-4")
Button class("btn" active when isOpen)                 # toggles `active`
Stack class("ring-2 ring-primary" when invalid)        # multi-class: quote it
Stack class("status-{m.status}")                       # class FROM a value → status-online / status-idle / …
```

A hyphenated or multi-class name in a reactive toggle **must be quoted** (`class("is-open" when x)`).
`class("prefix-{x}")` interpolates a state/enum value into a reactive class token (DRY: one token instead of a
`when` per value). See [Styling](../styling.md).

## `on(...)`

Works on **any** element; the event name is any DOM event:

```muten
Stack on(mouseenter: preview)
SearchField bind(q) on(enter: search)        # `enter` is synthetic: Enter submits (and prevents the newline);
                                             # in a Textarea, Shift+Enter still makes a newline
Button "Save" -> save(draft)                  # `-> action(arg)` is the form for "click + an argument"
```

`-> action` / `-> action(arg)` is the click shorthand on `Button`/`Link`/`RowAction`; `on(...)` is for other
events or for `Custom` component events.

## `disabled`

Sets the **real, reactive** `disabled` property on a form control - it toggles as its condition changes. Bare
`disabled` (no `when`) disables it always. Valid on `Button`, `RowAction`, `SearchField`, `Password`, `Select`,
`Checkbox`, `Form`; on anything else (a `Stack`, a `Text`) it's a `disabled-target` error (it would do nothing):

```muten
Button "Next" -> next disabled when pw.length < 8 or not agree
Button "Save" -> save(draft) disabled when save.pending
Select bind(role) options(founder, engineer, other) "Pick a role" disabled
```

This replaces the old hand-roll of a fake `disabled` CSS class + `aria(disabled: …)` + an in-action guard: one
modifier sets the property the browser and assistive tech already understand. See [Forms](../forms.md).

## `aria(...)`

Express accessibility on any node - each key → `aria-<key>`, `role` → `role`. A literal is static; a value that
reads state is reactive:

```muten
Button "✕" -> close aria(label: "Close")
Stack aria(role: "dialog", modal: true) { … }
Button "Menu" -> ui.toggle aria(expanded: ui.open, controls: "nav")
```

See [Accessibility](../accessibility.md).

## `style(...)`

Bind a **dynamic CSS value** to state - the bounded path for a progress width, a data-driven size, a transform.
Each key becomes a CSS custom property `--key` (muten prepends `--`, so it can only set variables, never an
arbitrary property); the value is an interpolated string and is reactive:

```muten
Stack class("bar") style(w: "{pct}%")               # --w = "40%", updates with pct
Stack style(t: "translateX({x}px)", o: "{op}")      # multiple vars
```
```css
.bar { width: var(--w); }
```

`class()` for static look, `style()` only for a value that changes at runtime. See [Styling](../styling.md#dynamic-values--style).

## `inputs(...)` / `on(...)` on `Custom`

`Custom` takes `inputs` (values, `@` for state) and `on` (events → actions):

```muten
Custom Map inputs(markers: @places) on(markerClick: select)
```

See [Escapes](../escapes.md).

## See also
- [Primitives](primitives.md) · [Keywords](keywords.md) · [Constraints](constraints.md)
