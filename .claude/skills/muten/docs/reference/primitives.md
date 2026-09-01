# Reference - Primitives

Every primitive, its output element, and how it's used. Primitives are **PascalCase**. A bare string is the
node's main prop; `{ … }` is its children. Style any primitive with [`class()`](modifiers.md); add
accessibility with [`aria()`](modifiers.md).

## Layout & landmarks

| Primitive | Element | Notes |
|---|---|---|
| `Stack` | `<div>` | a **flex column** by default; a row is `class("flex flex-row")` |
| `Page` | `<main>` | the page root - **one per route**; the focus target on navigation |
| `Header` | `<header>` | landmark |
| `Nav` | `<nav>` | landmark; `Nav "Main" …` sets its `aria-label` |
| `Sidebar` | `<aside>` | complementary landmark |
| `Footer` | `<footer>` | landmark |
| `Section` | `<section>` | a thematic page band; usually carries its own heading (`Title … h2`) |
| `Article` | `<article>` | self-contained content (card, post, comment, notification) that stands alone |
| `List` | `<ul>` / `<ol>` | semantic list; `List ordered` → `<ol>`. Each **direct child renders as `<li>`** - an `each` inside is the common case. Prefer it over a `Stack` for any real list (a11y) |
| `Details` | `<details>`+`<summary>` | native accordion: the positional string is the summary, the children are the content. `open` starts it expanded. Zero state/JS; reach for state + `when` only for a controlled or animated panel |
| `Table` | `<table>` | native data table; its `Row` children are auto-grouped into a real `<thead>` (the `Row head` rows) + `<tbody>` (the rest). Style with `class()` |
| `Row` | `<tr>` | a table row inside a `Table`; add the `head` keyword for a header row (its cells become `<th>`, placed in `<thead>`) |
| `Cell` | `<td>` / `<th>` | a table cell inside a `Row`; positional string = its text (interpolates), or give it children for a rich cell (badge/icon/avatar). It's a `<th>` inside a `Row head` |

```muten
Page class("flex flex-col gap-6") {
  Header class("flex flex-row justify-between") { … }
  Section class("flex flex-col gap-4") {
    Title "Latest" h2
    List class("flex flex-col gap-2") {
      each posts as p { Article class("p-4 card") { Title "{p.title}" h3  Text "{p.excerpt}" } }
    }
  }
  Footer { … }
}
```

### Tables — `Table` / `Row` / `Cell`

`Table` is the native `<table>`: list your `Row`s (mark the header one `head`) and the compiler builds the real `<thead>`/`<tbody>`, so DaisyUI's `.table` (or any table CSS), zebra striping, and screen-reader table semantics all work. A dynamic table binds its body rows with an `each`; a cell is text (`Cell "…"`, interpolates) or rich children (`Cell { Span … class("badge") }`).

```muten
Table class("table") {
  Row head { Cell "Task"  Cell "Owner"  Cell "Status" }
  each issues as i {
    Row {
      Cell "{i.title}"
      Cell "{i.owner}"
      Cell { Span "{i.status}" class("badge") }
    }
  }
}
```

Reach for `Table`/`Row`/`Cell` when **you** control the row/cell markup (mixed content, badges, links per cell). Reach for `DataTable @rows columns(a, b)` (below) when you just want a plain grid of a list's fields with sort/filter built in.

## Text

| Primitive | Element | Notes |
|---|---|---|
| `Text` | `<p>` | interpolates state: `Text "Hi, {user.name}"` |
| `Title` | `<h1>`…`<h6>` | level keyword: `Title "Dashboard" h2` (default `h1`) |
| `Span` | `<span>` | inline text |

## Media

| Primitive | Element | Notes |
|---|---|---|
| `Image` | `<img>` | **`alt` required**: `Image "{p.image}" alt("{p.title}")` - `alt("")` for decorative |
| `Icon` | inline `<svg>` | Iconify `set:name`, resolved at build (tree-shaken), `aria-hidden`: `Icon "lucide:settings"` |
| `Video` | `<video>` | bare-keyword flags: `Video "clip.mp4" controls autoplay loop muted playsinline` |

> **Data-driven icon?** The `Icon` name is a static literal (it inlines the SVG at build, so it can't read
> data). Two paths: a **per-value** icon (status / type / category) is a `match` over static Icons -
> `match item.status { active -> Icon "lucide:check"  paused -> Icon "lucide:pause" }` (each arm still
> tree-shakes); an icon whose **URL lives in your data** is an `Image` - `Image "{item.iconUrl}" alt("")`.

## Interactive

| Primitive | Element | Notes |
|---|---|---|
| `Link` | `<a href>` | client-side nav: `Link "Catalog" -> "/catalog"`; children → a clickable card |
| `Button` | `<button>` | runs an action: `Button "Save" -> save(draft)`; children allowed |
| `SearchField` | `<input type=search>` | bound text input: `SearchField bind(q) "Search…"`; has an accessible name |
| `Password` | `<input type=password>` | masked text input, two-way bound: `Password bind(pw) "Password"` (binds a **text** state) |
| `Select` | `<select>` | bound choice: `Select bind(role) options(founder, engineer, other) "Pick a role"` - `options` (the value list) is required; the string is the empty-value prompt (binds a **text** state) |
| `Checkbox` | `<label>`+`<input type=checkbox>` | a bool. `Checkbox bind(agree) "I accept"` two-way-binds a page **bool** state. For a store/query list ROW (not `bind`-able), display + toggle: `Checkbox checked(t.done) -> todos.toggle(t.id)` — `checked(<bool>)` shows it, `-> action` toggles; `checked` alone = read-only |
| `Number` | `<input type=number>` | numeric input, two-way bound: `Number bind(qty) min(1) max(99) step(1)` (binds a **number** state; value coerced with `Number()`) |
| `Range` | `<input type=range>` | slider, two-way bound: `Range bind(volume) min(0) max(100) step(5)` (binds a **number** state; defaults 0..100 step 1) |
| `Date` | `<input type=date>` | native date picker: `Date bind(due)` (binds a **date**/text state, ISO `YYYY-MM-DD`) |

```muten
Link "Product" -> "/product/{p.id}" { Stack class("card") { Title "{p.name}" h3 } }   # clickable card
Button "Delete" -> remove(item.id)
SearchField bind(q) on(enter: search) "Search products"
Password bind(pw) "Password"
Select bind(role) options(founder, engineer, other) "Pick a role"
Checkbox bind(agree) "I accept the terms"
Range bind(volume) min(0) max(100) step(5)   # slider; Number bind(qty) is the same for a stepper
Date bind(due)                                 # native calendar popup for a single date
```

> `Password` / `Select` / `Checkbox` / `Number` / `Range` / `Date` are the same controls a [`Form`](../forms.md)
> renders, usable **standalone** (outside a `Form`) for conditional or gated forms. The oracle checks the bind
> type - **text** for `Password`/`Select`, **bool** for `Checkbox`, **number** for `Number`/`Range`, **date/text**
> for `Date` (`bind-type` error otherwise). `min`/`max`/`step` on `Number`/`Range` take a number or a state
> (reactive). A multi-month / date-range calendar is out of scope (it needs day-range generation) - the native
> single-date picker covers the common case; reach for a `Custom` only for a range/availability calendar.

## Data-driven

| Primitive | Element | Notes |
|---|---|---|
| `Form` | `<form>` | auto-built from an entity draft: `Form bind(draft) submit(create) "Save"` - see [Forms](../forms.md) |
| `DataTable` | `<table>` | a reactive table over a list/query (`@` sigil): `DataTable @users columns(name, email)`; headers are `<th scope>` |
| `RowAction` | `<button>` (per row) | a button inside each `DataTable` row: `RowAction "Delete" -> remove(row.id)` |

```muten
DataTable @users columns(name, email, role) {
  RowAction "Edit"   -> edit(row)
  RowAction "Delete" -> remove(row.id)
}
```

`DataTable` shows **raw** cell values (no per-column formatting); for formatted/badge cells, use `each` + a
[part](../parts.md).

The `@` sigil on `DataTable`/`Chart` binds ANY list source: a page `state`/`query`, a page **`get`** (a derived
list), or a **store list** (`@orders.items`). So a store-centric app charts/tables its derived data directly.

## Dataviz (native SVG, no JS)

| Primitive | Element | Notes |
|---|---|---|
| `Chart` | `<figure><svg>` | grammar-of-graphics chart over a `@` list. `kind(bar\|line\|area\|point\|scatter\|pie\|donut)` + `x(field)` `y(field)` (`y` must be a **number** field) + optional `color(field)` (series) + a positional title. Scales, axes and legend are automatic. |
| `Svg` | `<svg>` | the raw vector layer under `Chart`: `Svg viewBox("0 0 W H") { … marks … }`. Draw arbitrary marks from data when `Chart` isn't enough. |
| `Rect`/`Line`/`Circle`/`Path`/`Group` | SVG marks | geometry is **reactive number expressions**: `Circle cx(map(p.val, 0, max, 10, 190)) cy(60) r(4)`. Built-ins for geometry: `map(v,inLo,inHi,outLo,outHi)` (scale), `sin`/`cos`/`sqrt`/`abs`/`round`/`floor`/`ceil`/`pow`/`min`/`max`/`pi`. |
| `Arc` | `<path>` | a pie slice / donut segment / gauge: `Arc cx() cy() r() start(deg) end(deg) inner(r)` (degrees, 0 = top, clockwise; `inner(0)` = pie, `inner>0` = donut). |

```muten
Chart @revByCat kind(bar) x(category) y(revenue) "Revenue by category"
```

- **`Chart` draws one mark per row and does NOT auto-aggregate** duplicate x-values. For a categorical chart from
  per-order rows, pre-group into a `get` first (grouping is a `use` fn - see the [revenue-by-category recipe](../../patterns.md#categorical-chart-from-transactional-data-revenue-by-category)).
- Marks are plain SVG - style them entirely in CSS (`.mu-chart-bar`, `.mu-chart-line`, `.mu-chart-dot`,
  `.mu-chart-area`, `.mu-chart-slice`, `.mu-chart-grid`, `.mu-chart-tick`); the theme drives them via `--chart-*` /
  `--color-*` (a clean default is scaffolded into `src/styles.css`). Layout tokens (`--chart-w/-h/-ticks/-bar-gap/
  -donut-inner`) are configurable from `theme.muten`'s `chart {}` section - nothing is hardcoded.

## Structural & escape

| Primitive | Element | Notes |
|---|---|---|
| `slot` | - | the outlet for caller content: the active page inside a `shell`, or the caller's children inside a `part` |
| `Custom` | host `<div>` | mount a vanilla-JS widget muten can't express natively - map / rich-text / canvas (NOT charts, sliders or dates, those are native): `Custom Map inputs(markers: @places) on(markerClick: select)` - see [Escapes](../escapes.md) |

## Control flow (lowercase keywords, not primitives)

| Form | Meaning |
|---|---|
| `when <expr> { … }` | mount/unmount reactively |
| `each <list> as item { … }` | render per item; `item` is a scope var (`where` to filter) |
| `match <enum> { value -> node … }` | render the arm matching the enum value (sugar over N `when`) |

```muten
when cart.count > 0 { Span "🛒 {cart.count}" }
each products as p where p.inStock { Text "{p.name}" }
match deal.stage { new -> Text "New"  won -> Icon "lucide:check" }
```

## See also
- [Modifiers](modifiers.md) · [Keywords](keywords.md) · [Expressions](expressions.md)
- [Forms](../forms.md) · [Lists](../lists.md) · [Accessibility](../accessibility.md)
