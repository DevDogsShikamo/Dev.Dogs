# Plugins & component libraries

Muten ships **no component library** in the core (the styling core is agnostic - see [Styling](styling.md)).
Components come from **plugins**: ordinary npm packages, published under an org (e.g. `@muten/shadcn`), that
carry a **registry** of muten parts + classes. You either **import** them or **eject** (copy) them. Nothing is a
runtime - whatever you use compiles away with your app.

## Installing a plugin

```sh
npm install @muten/shadcn
```

A styling plugin also ships a stylesheet you import once (after Tailwind), in `src/styles.css`:

```css
@import "tailwindcss";
@import "@muten/shadcn/globals.css";   /* its @theme tokens + component classes */
```

If the plugin themes the app (shadcn does), empty your `theme.muten` colors so they do not fight it:

```
theme { scheme { mode "dark" } }
```

## Two ways to use a component

### 1. Import - use as-is (`plugins {}` in `muten.config`)

Declare the plugin once; its parts become available across the whole app, no copies:

```
# muten.config
plugins {
  shadcn {}
}
```

```
# any page - Card, Badge, Dialog, ... just work
Card { CardHeader { CardTitle(label: "Create project") } }
```

`<key> {}` maps to the package `@muten/<key>`. The block can hold per-plugin config later; `{}` is the default.

### 2. Eject - own the source (`muten add`)

`muten add` copies a component's `.muten` into your `src/parts/`, so you can edit it (the shadcn philosophy -
you depend on the source, not a black box):

```sh
muten add card badge dialog
```

It pulls each component's dependencies too. Importing and ejecting mix freely: import the ones you use as-is,
eject the few you want to customize.

## How it works (the registry seam)

The core defines the seam; the plugin provides the data. A plugin package has a **`registry.json`** indexing its
components, each pointing at a `.muten` part file:

```json
{
  "name": "my-ui",
  "components": [
    { "name": "card", "part": "Card", "file": "registry/card.muten" }
  ]
}
```

- **`muten add <name>`** discovers every installed dependency that has a `registry.json`, finds the component, and
  copies its `file` into `src/parts/`.
- **`plugins { my-ui {} }`** loads those same parts straight from `node_modules` at build time (no copy). The
  oracle (`muten check`) sees imported parts just like local ones, so lint stays honest.

## Custom-backed components are eject-only

A component whose registry entry has a `component` field is backed by a vanilla-JS host (a `Custom` - see
[Escapes](escapes.md)). Its `.js` must live in **your** `src/components/`, where the `Custom` primitive loads it,
so it cannot be imported - **only `muten add`** (which copies both the `.muten` part and the host `.js`):

```sh
muten add carousel map-embed         # copies the part + src/components/Carousel.js, MapEmbed.js
```

Reserve these for what muten genuinely can't express (carousels, map embeds, rich editors). **Charts, sliders
and date pickers are NATIVE** - use the `Chart`, `Range` and `Date` primitives (oracle-checked, zero JS), not a
plugin. A plugin may still ship a styled Custom version of one for design parity, but you never *need* a plugin
(or JS) for those capabilities. You own any host file you eject.

## The container / presentational pattern

Plugin components do not hold their own state - **the page owns it** (so the oracle can check it). Interactive
parts take a value + an action callback:

```
state { dark = false : bool }
action toggle mutates dark { dark.toggle() }
Switch(on: dark, onToggle: toggle)
```

Overlays own an `open` bool (`Dialog(open: open, onClose: close)`); single-select groups pass the current value
plus each item's value. **The exact props of a plugin part are in the header comment of its `.muten` file**
(`node_modules/@muten/<plugin>/registry/<name>.muten`) - read it before calling; a catalog blurb is not the API.

## Two gotchas that bite every time

1. **A native primitive ALWAYS wins over a same-named plugin part.** The core ships `Select`, `Checkbox`,
   `Number`, `Range`, `Date`, `Chart` (plus `Button`/`Link`/`Form`/`Image`/`Text`/…) as primitives, so a plugin
   part with one of those names is **unreachable** - the primitive is used instead. If you write a plugin part's
   call and the oracle says `missing-prop: Select is missing the required "bind"`, that's the native primitive
   shadowing the part → use the **primitive's** API (`Select bind(x) options(a, b)`, `Checkbox bind(ok)`,
   `Chart @data kind(bar) …`). Well-behaved plugins don't ship parts named after a primitive (e.g. shadcn renamed
   its `Sidebar`→`AppSidebar`, and uses `Btn`/`Input` instead of `Button`/`SearchField`).

2. **A part call takes NO trailing modifiers.** `Card(...) class("x")`, `Btn(...) disabled when v`, `Part(...)
   on(...)`, `Part(...) aria(...)` are all **syntax errors** - a part call ends at its `)` / `{ }`. When you need
   `class` / `disabled when` / `on` / `aria` on a control, use the **native primitive**
   (`Button "Save" -> save disabled when not valid class("btn btn-default")`), not the plugin's button part.

## @muten/shadcn

The flagship plugin: the [shadcn/ui](https://ui.shadcn.com) set, ported to muten as semantic classes
(`.card`, `.btn`, ...) + parts (Card, Dialog, Tabs, Accordion, Select, Badge, ...). Reach for it for **consistent
design**, not for capability - charts, sliders and date pickers are already native primitives. (It also carries
older Custom `Slider`/`Calendar`/`Chart` parts for parity, but prefer the native `Range`/`Date`/`Chart`.)
Authentic shadcn styling, your `.muten` stays readable. See its README for the component list.

## Building your own plugin

Publish an npm package with a `registry.json` + the part `.muten` files (+ optional `globals.css` and host `.js`
for Custom components). Any installed package with a `registry.json` is a registry `muten add` can read - and any
package listed in `plugins {}` is importable. Mark a scoped package public with
`"publishConfig": { "access": "public" }`.
