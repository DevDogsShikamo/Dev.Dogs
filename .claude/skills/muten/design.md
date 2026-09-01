# Designing muten pages - make it look great

Muten ships **no skin** - it builds the STRUCTURE (primitives) and you carry the LOOK with `class("…")`, the
single styling path. This doc is the craft: how to get a polished, modern result. Pair it with `SKILL.md` (the
language) and `patterns.md` (full app recipes).

## 1. Pick ONE styling route per app
Everything is `class("…")`; the difference is what backs those class names:
| Route | How `class()` is backed | When |
|---|---|---|
| **Pure muten** (theme-driven) | semantic classes in `styles.css` that read `theme.muten`'s `:root` vars | no framework; full control; smallest output |
| **Tailwind** | Tailwind utilities (`class("flex flex-row gap-4")`) | utility-first; fast |
| **DaisyUI** | daisy components (`btn`, `card`) on Tailwind | pre-styled components |

Don't mix routes (don't put a Tailwind `class("flex-row")` AND a hand-written `.row` on the same tree) - pick one and be consistent.

## 2. Pure-muten design system (the muten-native way)
Put EVERY value in `theme.muten`; muten emits it as `:root` CSS vars. `styles.css` maps those color/space/radius
vars onto a handful of semantic classes you apply with `class("…")`. Edit `theme.muten` → the whole app re-skins.

```
# theme.muten - a clean dark starter
theme {
  space   { xs "4px"  sm "8px"  md "16px"  lg "24px"  xl "40px" }
  font    { sm "13px"  md "15px"  lg "20px"  xl "30px" }
  weight  { medium "500"  semibold "600"  bold "700" }
  radius  { sm "8px"  md "12px"  lg "18px"  pill "999px" }
  breakpoints { sm "640px"  md "768px"  lg "1024px" }
  colors {
    bg "#0b0f17"  surface "#141b27"  panel "#1c2533"  border "#263244"
    text "#e8edf5"  muted "#8a97ab"  primary "#6366f1"  onprimary "#ffffff"
    success "#34d399"  warning "#fbbf24"  danger "#f87171"
  }
}
```
```css
/* src/styles.css - every value is a theme var; nothing hardcoded */
* { box-sizing: border-box; }
body { margin: 0; background: var(--color-bg); color: var(--color-text); font: 15px/1.55 system-ui, sans-serif; }
.mu-stack { display: flex; flex-direction: column; }
/* layout + type helpers - every value reads a theme var, so a tweak in theme.muten moves the whole app */
.row     { display: flex; flex-direction: row; }
.between { justify-content: space-between; }
.center  { align-items: center; }
.gap-xs  { gap: var(--space-xs); }   .gap-sm { gap: var(--space-sm); }   .gap-md { gap: var(--space-md); }   .gap-lg { gap: var(--space-lg); }
.pad-sm  { padding: var(--space-sm); }   .pad-md { padding: var(--space-md); }   .pad-lg { padding: var(--space-lg); }   .pad-xl { padding: var(--space-xl); }
.t-sm    { font-size: var(--font-sm); }   .t-lg { font-size: var(--font-lg); }   .t-xl { font-size: var(--font-xl); }
.semibold { font-weight: var(--weight-semibold); }   .bold { font-weight: var(--weight-bold); }
.text-center { text-align: center; }
.card    { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.muted   { color: var(--color-muted); }
.accent  { color: var(--color-primary); }
.divider { border-bottom: 1px solid var(--color-border); }
.btn     { background: var(--color-primary); color: var(--color-onprimary); border: none; border-radius: var(--radius-sm); padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn:hover { filter: brightness(1.08); }
.btn-ghost { background: transparent; color: var(--color-text); border: 1px solid var(--color-border); }
.badge   { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: var(--radius-pill); display: inline-block; }
```
Then write pages with these classes - `class("…")` carries both layout and look:
```
Stack class("pad-lg gap-md card") {
  Text "Revenue" class("muted t-sm semibold")
  Text "{money(total)}" class("t-xl bold")
}
```

## 3. Style the auto-Form (every route needs this - don't skip it)
`Form` auto-renders inputs with muten's OWN classes - `class()` on the `<Form>` styles the form CONTAINER,
NOT the inputs. So skin these once in `styles.css` (or your forms look unstyled):
```css
.mu-form        { display: flex; flex-direction: column; gap: 12px; }
.mu-form-title  { display: none; }                 /* hides the auto "New <Entity>" heading */
.mu-field       { width: 100%; padding: 9px 12px; font-size: 14px; border-radius: 8px;
                  border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text); }
.mu-field:focus { outline: 2px solid var(--color-primary); outline-offset: -1px; }
.mu-field-check { width: 16px; height: 16px; accent-color: var(--color-primary); }
.mu-field-error { color: var(--color-danger); font-size: 12px; }
.mu-submit      { grid-column: 1 / -1; padding: 9px 14px; border: none; border-radius: 8px;
                  background: var(--color-primary); color: var(--color-onprimary); font-weight: 600; cursor: pointer; }
```
(Tailwind/Daisy: same idea, use the framework's vars/utilities in these rules.) `SearchField` DOES take `class()`
directly - only the auto-`Form` needs this.

## 4. The craft - what makes it look "designed"
- **One accent, restrained palette.** A neutral surface scale + ONE accent color. Resist rainbow.
- **Contrast discipline.** Never light text on a light surface. On dark themes use a `muted` (~60% lum) for secondary text, full `text` for primary.
- **Type hierarchy = size + weight, not color.** Title large + bold, label small + semibold + muted, body default.
- **Spacing rhythm.** Reuse ONE scale (the same step between rows, a larger one between sections, a card padding). Consistency reads as polish.
- **Cards.** A subtle 1px border + medium radius + a soft shadow. On light themes add a soft shadow; on dark, the border alone is enough.
- **Numbers** get formatted via `use` (`use money from "~/lib/money.ts"`) - raw `48000` looks unfinished; `$48,000` looks shipped.
- **Empty states & loading.** `when list.length == 0 { … }` and `when q.loading { … }` - never a blank panel.

## 5. Modern building blocks (copy-paste)

### Glass pill navbar (current trend - floating, translucent, blurred)
**Pure muten** - add to `styles.css`:
```css
.nav-pill { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 50;
  display: flex; align-items: center; gap: 4px; padding: 6px; border-radius: 999px;
  background: color-mix(in srgb, var(--color-surface) 65%, transparent);
  backdrop-filter: blur(12px) saturate(1.4); -webkit-backdrop-filter: blur(12px) saturate(1.4);
  border: 1px solid color-mix(in srgb, var(--color-text) 12%, transparent);
  box-shadow: 0 10px 30px rgba(0,0,0,.18); }
.nav-pill-link { padding: 7px 16px; border-radius: 999px; font-size: 14px; font-weight: 500; color: var(--color-muted); }
.nav-pill-link:hover { background: color-mix(in srgb, var(--color-text) 8%, transparent); color: var(--color-text); }
.nav-pill-link.is-active { background: var(--color-primary); color: var(--color-onprimary); }
```
```
# in shell { } - floats over the page; pad the content so it clears
Nav class("nav-pill") {
  Link "Home"     -> "/"        class("nav-pill-link")
  Link "Features" -> "/features" class("nav-pill-link")
  Link "Pricing"  -> "/pricing"  class("nav-pill-link")
}
Stack class("pad-xl") { slot }
```
`.is-active` above is applied **automatically** by the router (the current page's link gets `aria-current="page"`
+ `is-active`) - you don't write `class(active when …)` to wire it up.
**Tailwind** equivalent:
```
Nav class("fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 p-1.5 rounded-full bg-white/70 backdrop-blur-md border border-white/50 shadow-lg shadow-black/5") {
  Link "Home" -> "/" class("px-4 py-1.5 rounded-full text-sm font-medium text-zinc-700 hover:bg-black/5")
}
```

### Hero (centered, gradient accent)
```
Stack class("pad-xl gap-md center text-center") {
  Title "Build faster" h1 class("t-xl bold text-center")
  Text "One clear sentence about the product." class("muted t-lg text-center")
  Stack class("row gap-sm") { Button "Start" class("btn")  Button "Docs" class("btn-ghost") }
}
```

### KPI stat card
```
Stack class("pad-lg gap-xs card") {
  Text "Customers" class("muted t-sm semibold")
  Text "{count}" class("t-xl bold")
}
```

### Reactive multi-class (now supported)
A reactive toggle string may hold MULTIPLE classes - just quote it; each token toggles:
`class("ring-2 ring-primary" when c.active)`. Hyphenated names also need the quotes.

### Icons - the `Icon "set:name"` primitive (first-class, agnostic, tree-shaken)
muten has a first-class `Icon` backed by **Iconify** `set:name` - ANY icon library, no preference:
```
Icon "lucide:settings"          Icon "tabler:home"          Icon "mdi:account"
Icon "lucide:search" class("text-xl text-zinc-400")     # size = font-size (1em); color = currentColor
```
- **Agnostic:** the prefix IS the library (lucide, tabler, mdi, …); mix sets freely. The core ships no icons.
- **Tree-shaken, zero runtime:** each `Icon` is resolved to inline `<svg>` AT BUILD (Iconify). Only the icons you
  reference ship - for ~15 icons that's ~1KB, not a 100KB+ icon CDN. Nothing of Iconify reaches the browser.
- **Style it like text:** the SVG is `1em` and uses `currentColor`, so `class("text-xl")` sizes it and the parent's
  `text-*` color flows in (hover included). Add `class("text-[#b5bac1]")` only to override the inherited color.
- **The set must be installed:** `npm i -D @iconify-json/<set>` (the scaffold pre-installs **lucide**). Reference a
  set you didn't install and the build errors with the exact `npm i` to run. Names are STATIC (resolved at build) -
  use the icon's real kebab name (`lucide:more-vertical`, not camelCase). Browse names at icones.js.org.

**Repeated icon rows → a `part`.** An icon name can be a part param: `part NavItem(icon: text, label: text) {
Stack class("…") { Icon $icon  Text "{$label}" } }`, then `NavItem(icon: "lucide:users", label: "Friends")`. The
part inlines with the literal, so the icon stays static + tree-shaken. Use this to DRY a navbar/toolbar (one
template, N calls) instead of repeating the row - fewer tokens, same bundle.

**Container / presentational.** A part is the *presentational* half: pure UI, no state of its own. The page is the
*container*: it owns state, actions and data. A part can hold one `slot` (the caller's children inline there), so a
reusable *frame* - card, panel, modal, the editor-split shell every showcase shares - wraps content it doesn't know
in advance, and that content reads the page's scope. See [parts.md](docs/parts.md). No scoped slots / render-props:
slot↔page communication goes through the container (its state/actions), which both sides already see.

For a one-off brand mark / custom SVG that no set has, drop to a `Custom` component (§13 in SKILL.md). Whole image
files (incl. `.svg`) go through `Image "…"`.

## 6. Reference-driven design
To match a reference (screenshot/URL), work the loop:
1. Look at the reference; name the **layout** (vertical stacks? a grid? a sidebar? a floating navbar?).
2. Map **layout → `Stack`/`class("grid grid-cols-N")`**, **components → primitives + your styling route**.
3. Write the page, then **build + screenshot your result** and compare side by side.
4. Fix the deltas (spacing, color, radius, weight) and repeat. Two or three passes gets you close.
Keep the palette + radius + spacing in `theme.muten` so a tweak there moves the whole page toward the target.

## 7. Responsive
**Tailwind:** prefix utilities with a breakpoint - `class("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4")`,
`class("flex flex-col md:flex-row")`. **Library-free:** write `@media` queries in `styles.css` keyed on
`theme.muten`'s `breakpoints` vars. Mobile-first: the base is the small-screen default, the `md:`/`lg:` variant
overrides up. Test at a narrow width - keep big numbers from overflowing 2-col grids.
