# Muten documentation

The complete reference for **Muten** - the AI-first frontend framework. You write `.muten` files; Muten
compiles them to vanilla JS + fine-grained signals (no virtual DOM, no framework runtime to ship).

> **This sits next to the skill.** [`../SKILL.md`](../SKILL.md) is the always-loaded, terse reference an agent
> reads first; this `docs/` set is the **deep dive** - prose, examples, the *why*, at React/Vue/Svelte depth -
> read a `docs/<topic>.md` on demand when you need more than the skill compresses. Both cover **100% of the
> language**; this map is the source of truth for what "complete" means.

---

## Getting started
- [Introduction](introduction.md) - what Muten is, the trade it makes, when to use it.
- [Installation & first app](getting-started.md) - `npm create muten`, the project layout, the dev loop.
- [Mental model](mental-model.md) - primitives + logic, one root per page, automatic reactivity, the compile pipeline.

## Guide (concepts, in order)
- [Pages & routing](routing.md) - `app.muten`, routes, params, guards, `/404`, the shell, `<head>` meta.
- [State & reactivity](state.md) - `state`, types, `persist`, signals; reads subscribe, writes notify; batching.
- [Actions & mutations](actions.md) - `action … mutates`, the bounded op set (`push`/`set`/`reset`/`toggle`/`patch`/`remove`), `if/else`.
- [Lists](lists.md) - `each`, `where`, aggregates (`sum`/`count`/`avg`/`min`/`max`), `sort`, membership via `contains`.
- [**Forms & validation**](forms.md) - entity-driven forms, field types, constraints (`required`/`min`/`max`/`pattern`/email), **built-in accessibility**.
- [Data](data.md) - `query`, `sources`, the `api` block, REST CRUD (`create`/`update`/`delete`), `refetch`, `query x live` (WebSocket).
- [Styling](styling.md) - `class()` is the one way; `theme.muten` → CSS vars; the agnostic core.
- [**Accessibility**](accessibility.md) - the a11y the compiler emits for free, and the `aria(...)` modifier to express the rest.
- [SEO](seo.md) - `meta {}`, SSG, sitemap/robots/canonical/JSON-LD by nature, `--url`.
- [Stores](stores.md) - app-global state, `get`, `effect`, page→store composition.
- [Parts](parts.md) - reusable fragments, inlined at build, object + action params.
- [Escapes](escapes.md) - `Custom` (vanilla-JS widgets) and `use` (JS logic functions); when to reach for each, and when NOT to.
- [Plugins & component libraries](plugins.md) - `muten add` (eject) vs `plugins {}` (import); the registry seam; `@muten/shadcn`.

## Reference
- [Primitives](reference/primitives.md) - every primitive, its props, children, and output tag.
- [Modifiers](reference/modifiers.md) - `class` · `bind` · `submit` · `where` · `columns` · `alt` · `inputs` · `on` · `aria`.
- [Keywords](reference/keywords.md) - every top-level + control-flow keyword.
- [Constraints](reference/constraints.md) - `required` · `min` · `max` · `pattern` (+ the automatic `email` check).
- [Expressions](reference/expressions.md) - operators, `contains`, ternary, refs, the aggregate forms.
- [CLI](reference/cli.md) - `build` (+ `--url=`), `check`/`lint`, `map`.

## Deployment
- [Building & deploying](deployment.md) - `muten bundle` (SPA) vs `muten build` (SSG), the SPA fallback, Vercel, Tauri.

---

**Status: complete.** Every section above is written and accurate to the current engine - the full Guide
(15 pages), the Reference (6 pages), and Deployment. This `docs/` set is plain markdown; point any docs
generator (VitePress, Astro Starlight, Docusaurus) at it to publish a site.
