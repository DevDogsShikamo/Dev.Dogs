# Introduction

**Muten is an AI-first frontend framework.** You write small `.muten` files; Muten compiles them to vanilla
JavaScript with fine-grained signals - **no virtual DOM, no framework runtime to ship**. A static page
compiles to plain HTML (zero JS); a reactive one ships only the tiny signals for the parts that actually change.

The language is deliberately **small, semantic, and analyzable** - so that an AI (or a person) can **locate and
mutate** an app cheaply and correctly.

## The trade it makes

For an AI, the cost of working on a codebase is **context + mistakes + edit-radius**. Muten cuts all three
*by construction* - these are properties of how it compiles, not marketing:

- **Almost nothing to ship.** No virtual DOM, no framework runtime. The same todo app ships a small fraction
  of the JS the big frameworks do; a static page ships zero.
- **A deterministic oracle.** `muten check` validates every page at compile time (unknown state/action/part,
  bad token, illegal mutation, unknown ref) in milliseconds, no browser. A *bounded* language is what makes
  that possible - a general-purpose one can't be checked this way.
- **The whole app as data.** `app.map.json` is a compact index of routes + structure an agent reads first,
  instead of grepping a component tree.
- **Small edit radius.** The UI is declarative, so a change is usually a few lines in one file.

The trade is on purpose: a small, analyzable language an AI can hold in its head - **not** a general-purpose
one it can't.

## What you write

```muten
screen home

entity Product { name text  price number }
state  { products = [] : list<Product>  draft = {} : Product }
action add(p: Product) mutates products, draft { products.push(p)  draft.reset() }

Page class("flex flex-col gap-4") {
  Form bind(draft) submit(add) "Add product"
  each products.sortDesc by price as p { Text "{p.name} - ${p.price}" }
  Text "Total: ${products.sum by price}"
}
```

No `useState`, no component tree, no build wiring - and `muten check` validates every reference and type
before it ever runs in a browser.

## When to use Muten - and when not

Muten shines when an **AI builds and maintains** the app and the app is the **declarative 80%**: CRUD, SaaS,
dashboards, catalogs, internal tools, content sites. It reaches the rest of the web platform through bounded,
checked [escapes](escapes.md) (`class()`, `Custom`, `use`). Many once-"hard" widgets are now native primitives
(charts, sliders, date pickers, drag&drop, an SVG layer); only the irreducible ones (maps, rich-text editors,
canvas) land in vanilla JS via `Custom` - without a framework runtime.

It is **not** the tool for a hand-crafted, highly-custom UI that needs the full React/Vue/Svelte ecosystem and
a deep human team - and it doesn't pretend to be. Muten wins on a different axis (bytes shipped + AI cost),
and loses on ecosystem/maturity. Pick it for what it's for.

## Next
- [Installation & first app](getting-started.md)
- [Mental model](mental-model.md)
- the [full guide](README.md) and [reference](reference/primitives.md)
