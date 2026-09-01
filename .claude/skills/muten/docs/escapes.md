# Escapes - `Custom` and `use`

Muten the *language* stays small on purpose. A Muten *app* reaches the rest of the web platform through two
**bounded, checked escapes** - and the compiler still validates the border (the props and calls crossing it),
so reaching out never costs you the oracle.

Reach for the **lowest rung that works**:

1. **`class("…")`** - styling and CSS libraries (not an escape, just the styling path). See [Styling](styling.md).
2. **`Custom`** - a vanilla-JS **widget** Muten genuinely can't express: a **map** (pan/zoom/tiles), a **rich-text
   editor** (contenteditable), a **canvas/WebGL** scene, a per-frame animation. **NOT** charts, sliders, or date
   pickers - those are native primitives now (`Chart`, `Range`, `Date`, plus the `Svg` vector layer and
   `draggable`/`droptarget`). Reach for `Custom` only after checking there's no native primitive for it.
3. **`use`** - a vanilla-JS **logic function** (formatting, date math, a 3rd-party SDK) called in an expression.

There is **no React/Vue/Svelte component escape** - Muten owns the whole UI; foreign code enters only as a
vanilla-JS widget (`Custom`) or a logic function (`use`).

---

## `Custom` - a host-JS widget

Write vanilla JS in `src/components/<Name>.js` and mount it with `Custom`. It receives `inputs` (values you
pass) and wires DOM events back to your actions via `on`:

```muten
Custom Map inputs(markers: @places) on(markerClick: select)
```

```js
// src/components/Map.js   (a genuine Custom: pan/zoom/tiles is NOT expressible in the DSL)
function mount(el, inputs, on) {        // THREE positional args
  const map = makeMap(el, inputs.markers);   // read a value: inputs.markers
  map.onMarker = (m) => on.markerClick(m);    // call a handler: on.markerClick(payload)
  return (next) => map.setMarkers(next.markers);  // OPTIONAL: return an updater → muten re-calls it when a bound @state changes
}
```

Rules that matter:

- The signature is **`mount(el, inputs, on)`** - three positional args (not `mount(el, { inputs, on })`).
- Define it as a plain **`function mount(...)`**, **not** `export function` - the file is inlined, so an
  `export` is a syntax error and leaves the screen blank.
- **Pass state with `@`:** `inputs(data: @sales)` passes the array; bare `inputs(data: sales)` passes the
  literal string `"sales"`. To feed a query's rows, make a `get` first - `get rows = orders.data` - then
  `inputs(data: @rows)`.
- **Reactive inputs:** initial values are read at mount. For **live** values, `return` a function from `mount` -
  muten re-calls it with the fresh `inputs` whenever a bound `@state` changes. Return nothing and the inputs
  stay a mount-time snapshot (fine for a widget that owns its own data).

`Custom` is the only way to use non-Muten **UI** code. It's for genuine widgets - not for things Muten already
does (see below).

### A `Custom` is a LEAF - ONE widget, not a sub-app (read this before you write JS)

The #1 way an agent accidentally **rewrites Muten in vanilla JS** is the *gravity well*: you open one `Custom`
for a genuine escape (an iframe, a map), and then build the buttons, the list, the layout, the dropdown, the
toast, the socket — all in that same `.js` file, because you're "already in JS". **Stop.** A `Custom` wraps
**one** non-Muten thing and nothing more. If, inside a `Custom`, you find yourself doing ANY of these, delete it
and use the native form — Muten does all of them, and doing them in JS ships more code, loses the oracle, and
makes the app unreadable to the next agent:

| Inside a Custom you wrote… | That's Muten's job — use | 
|---|---|
| `document.createElement('button')` + `addEventListener('click', …)` | a native **`Button "…" -> action`** |
| `new EventSource(…)` / `new WebSocket(…)` (live data from your backend) | **`state { x = query feed live : list<T> }`** — Muten opens & reconciles the socket (§ real-time below) |
| inline `<svg>…</svg>` / an icon lib | **`Icon "lucide:name"`** (Iconify, inlined at build, tree-shaken) |
| a dropdown / modal / tabs / accordion / toast (show-hide floating UI) | a page `state` + **`when cond { … }`** + **`class(open when …)`** (§ patterns.md) |
| building card/badge/dialog/button styling by hand | the **`@muten/shadcn` plugin** parts — it *is* your component set (`muten add shadcn`) |
| `.map`/`.filter`/`.forEach` to render a list | **`each list as x { … }`** |

If your `Custom` contains buttons, list rendering, a socket, icons, or a modal, it is **too big** — those are
declarative Muten. Keep the Custom down to the one thing the platform can't express (the canvas, the map tiles,
the iframe, the contenteditable) and move everything around it back into `.muten`.

**Real-time is native — never hand-roll a socket.** A backend that pushes updates → `query x live` (WebSocket,
auto-reconnect, keyed reconciliation, batched). You never write `new WebSocket`/`new EventSource` yourself:

```muten
state   { feed = query feed live : list<Event> }
sources { feed: { url: "ws://localhost:5480/ws/feed" } }
# each feed as e { Text "{e.text}" }   ← only changed rows touch the DOM
```

---

## `use` - a host-JS logic function

`use` named exports from a `.ts`/`.js` file and call them in any expression. The `.ts` is a typed facade over
any npm package; Muten sees only the function names, so the oracle still checks your calls.

```muten
use fmt, slug from "~/lib/format.ts"        # named exports ONLY
Text "{fmt(order.total)}"
Link "{slug(post.title)}" -> "/blog/{post.id}"
```

- **Paths: prefer `~/`** (absolute, from `src/`). `~/lib/format.ts` resolves the same from every file - no
  counting `../`. (`./`/`../` relative still works.)
- The border is **synchronous** - no `async`/`await`. For async I/O use a `query` / `create` / `update` /
  `delete` (those are async with `.pending`/`.error`).
- Import zod / date-fns / nanoid / anything *inside* `format.ts` and expose tidy named functions.

A `use` function can also be **called as a statement** inside an `action` or `effect` - a side effect Muten
can't express (scroll, focus, analytics):

```muten
use scrollBottom, track from "~/lib/fx.ts"
action send(text: text) mutates messages {
  messages.push({ role: "user", content: text })
  scrollBottom()        # a side effect - no muten state mutated, so no `mutates` entry
  track("sent")
}
```

An undeclared call is an `unknown-function` error - the border is checked like any other reference.

---

## Don't escape for what Muten already does

The most common mistake is escaping to JS for something the language has a first-class form for. Before you
reach for `use` or `Custom`, check it isn't a built-in:

| You're tempted to write (in JS) | Use instead | |
|---|---|---|
| `new WebSocket` / `new EventSource` (live backend data) | **`query x live`** — Muten owns the socket | [Data § live](data.md) |
| inline `<svg>` / an icon package | **`Icon "lucide:name"`** (native, tree-shaken) | [Primitives § Icon](reference/primitives.md) |
| a dropdown / modal / tabs / toast (in JS) | page **`state` + `when` + `class(open when …)`** | [Patterns](../patterns.md) |
| hand-rolled buttons/cards/badges in a `Custom` | native primitives, or the **`@muten/shadcn`** plugin | [Plugins](plugins.md) |
| `document.createElement` to build UI | a native primitive (`Button`, `Stack`, `each`, …) | this file, top |
| `localStorage.getItem/setItem` | **`persist`** on the state | [State § persist](state.md#persist--localstorage-declaratively) |
| `items.some(x => x.id === id)` | **`contains`** on a `list<number>` of ids, or `count where … > 0` | [Lists § membership](lists.md#membership--is-it-in-the-list) |
| `list.filter(...)` / `.find(...)` | **`where`** (`each … where`, `count where`) | [Lists](lists.md) |
| `list.reduce(...)` for a total/count | **`sum by` / `count` / `avg`** | [Lists § aggregates](lists.md#aggregates) |
| a date/number **format** | a `use` fn (this *is* genuine foreign logic) ✓ | above |

A `use` function is for **genuine foreign logic** - date math, a formatting lib, a third-party SDK. It is
**not** for reimplementing a built-in. Escaping when you didn't need to ships more JS, loses the oracle's
checks on that logic, and makes the app harder for the next agent to read. The whole point of the bounded
language is that the declarative path exists - find it before you escape.

## See also
- [Styling](styling.md) - `class()` for CSS libraries (rung 1).
- [Accessibility](accessibility.md) - `aria(...)` keeps accessible widgets in Muten instead of a `Custom`.
- [Lists](lists.md) / [State](state.md) - the built-ins people escape past by mistake.
