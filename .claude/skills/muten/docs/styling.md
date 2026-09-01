# Styling

Muten ships **structure**, never a skin. There is **one way to style** - the `class("…")` modifier - and it
carries both layout and look. The engine is **agnostic**: it knows no CSS framework. You bring the appearance
(Tailwind utilities, or your own CSS backed by design values from `theme.muten`), and Muten emits raw class
names that any of them understands.

## `class("…")` - the one path

```muten
Stack class("flex flex-col gap-4 p-6")          # column with gap + padding
Header class("flex flex-row justify-between items-center")
Stack class("grid grid-cols-3 gap-4")           # a 3-col grid
Text  "Total" class("text-xl font-bold")
```

- A `Stack` is **flex-column by default**; a horizontal row is `class("flex flex-row")` (there is no `Row`
  primitive). Layout is CSS - Muten doesn't reinvent grid/flex.
- Responsive: prefix with breakpoints - `class("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4")`.
- Static appearance (colors, borders, shadows) has **no inline-style hatch** - it all goes through `class()` +
  your CSS. The one exception is a value that **changes at runtime** (a progress width, a dynamic transform):
  use [`style()`](#dynamic-values--style) below.

### Reactive classes

`class()` also **toggles** by a condition (computed once per change):

```muten
Stack class("panel" active when isOpen)              # toggles `active`
Button class("ring-2 ring-primary" when invalid)     # multi-class: each token toggles
```

A **hyphenated or multi-class** name must be **quoted** in a reactive toggle (`class("is-open" when x)`) - a
bare `is-open` parses as a subtraction and errors. Stack several toggles on one node freely.

### A class from a value - `class("prefix-{x}")`

To pick a class **from a state/enum value**, interpolate it into the token - it's applied reactively (the old
token is swapped for the new when the value changes):

```muten
each members as m {
  Stack class("status-dot") class("status-{m.status}")   # → status-online / status-idle / status-dnd / …
}
```
```css
.status-online { background: var(--success); }
.status-idle   { background: #f0b232; }
```

Use this for an **enum-driven class** instead of one toggle per value - `class("online" when m.status == "online")
class("idle" when m.status == "idle") …` is the verbose anti-pattern (DRY: one interpolated token replaces N
toggles). The interpolated reference is **oracle-checked** (a typo'd/renamed state is caught). The *class names*
themselves are still your CSS (muten can't know `.status-online` exists - that's your stylesheet's job).

## Dynamic values - `style()`

`class("prefix-{x}")` interpolates a value into a class **name** (great for an enum → `status-online`), but it
can't produce a **continuous** value like `width: 40%` (you'd need a class per percent). For a CSS value
**driven by state** - a progress bar's width, a data-driven size, a transform - use `style()`:

```muten
state { pct = 40 : number }
Stack class("bar") style(w: "{pct}%")        # sets CSS variable --w to "40%", reactively
```
```css
.bar { width: var(--w); transition: width .2s; }
```

- Each key becomes a **CSS custom property** `--key` - muten prepends `--`, so `style()` can **only** set
  variables, never an arbitrary property. It never competes with `class()` / Tailwind.
- The value is an interpolated string (`"{pct}%"`, `"translateX({x}px)"`, `"{rows}rem"`); it updates
  **reactively** when it reads state. A literal value (`style(c: "red")`) is set once.
- Your CSS consumes it with `var(--key)`. The *look* stays in CSS; only the *changing value* lives in muten.
- Use `class()` for everything static; reach for `style()` **only** when a value changes at runtime.

## Two backings - pick one per app

**Tailwind** (the default scaffold) - write utilities directly:

```muten
Stack class("flex flex-col gap-4 p-6 rounded-lg bg-zinc-900 text-white")
```

**Library-free** - write real CSS in `src/styles.css` using the CSS variables `theme.muten` emits, then apply a
semantic class:

```css
.card { padding: var(--space-lg); border-radius: var(--radius-md); background: var(--color-surface); }
```
```muten
Stack class("card")
```

The scaffold ships base classes like `.mu-stack` (the `Stack` primitive's flex-column) and the auto-Form skin
(`.mu-field`, `.mu-label`, …) - override them freely.

## `theme.muten` - design values → CSS variables

`theme.muten` is the agnostic **source of design values**. Muten emits each entry as a `:root` custom property
your CSS / `class()` consumes:

```muten
theme {
  space       { xs "4px"  sm "8px"  md "16px"  lg "24px"  xl "32px" }   # → --space-md: 16px
  font        { sm "13px"  md "15px"  lg "20px"  xl "28px" }             # → --font-lg
  weight      { medium "500"  bold "700" }
  leading     { tight "1.2"  normal "1.5" }
  breakpoints { sm "640px"  md "768px"  lg "1024px" }
  colors      { primary "#6366f1"  "base-100" "#1a1d23" }               # hyphenated keys QUOTED → --color-base-100
  radius      { box "0.75rem" }
}
```

No reset or rules go in `theme.muten` - only values. The reset and look live in `src/styles.css`.

### With a CSS framework - the agnostic adapter

`theme.muten` holds your **values**; a **styling adapter** (pure data in `muten.config`, wired by the
scaffolder per library) tells Muten how to emit them for Tailwind/DaisyUI. The **engine knows no library** -
you bring the styling, Muten emits your theme into its format. Plain css/scss gets generic `:root` vars (no
`muten.config` - only Tailwind/DaisyUI scaffolds get one). Validation of class names is your library's job
(its IntelliSense / build) - Muten stays agnostic.

The adapter is written in muten in `muten.config` under a `styling { … }` block: a `prefix { … }` map (section →
CSS-var prefix) and `blocks { name { selector "…" sections [ … ] } }` (each `name` wraps the listed theme
sections into one CSS block under that `selector`). Selectors drop the trailing `{` and use single quotes
(muten strings can't hold `{`/`"`) - e.g. `selector "@theme"` or `selector "[data-theme='light']"`. DaisyUI
also gets a `classes { … }` block that maps the auto-`Form` slots to its component classes.

## Why one path

`class()` being the only styling route is deliberate: it keeps appearance in CSS (where it belongs and where
tooling is mature) and keeps the Muten tree about structure + logic. It's also why accessibility is **not** a
styling concern - see [Accessibility](accessibility.md).

## See also
- [Accessibility](accessibility.md) - a11y is expressed in code (`aria`), not in `class()`.
- [Mental model](mental-model.md) - structure (primitives) vs look (`class`).
