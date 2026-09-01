---
name: muten-design
description: Make a Muten app look genuinely good — layout, color, typography, density, motion. Invoke when building or restyling any page/screen, or whenever the result looks flat, generic or "AI-made". You already know how to build; this is the taste. Copy the closest showcase, adapt it to the data, then elevate it.
---

# Designing a Muten app — the taste layer

You can already write Muten. This is how to make it look like a product someone shipped, not a skeleton.
**One rule above all: don't design from a blank page — copy the closest showcase/reference page, adapt it to
this app's data, then *elevate* it.** Calcar → acoplar → mejorar. Inventing layout from scratch is where flat,
generic pages come from.

## The design system is already in the app — USE it, don't reinvent
Every scaffolded app imports `@muten/shadcn` (globals + the **editorial** theme + motion). So the vocabulary
already exists — style with these **semantic tokens** via `class("…")`, never random hexes:

- **Surfaces:** `bg-background` (page) · `bg-card` / `bg-muted` (raised) · `bg-popover` (overlays) · `border-border` (`border`).
- **Text:** `text-foreground` (primary) · `text-muted-foreground` (secondary/meta) · `text-card-foreground`.
- **Accent:** `bg-primary text-primary-foreground` (the ONE brand action) · `bg-secondary` · `bg-accent` (hover/active).
- **Status (semantic, separate from accent):** `text-destructive` / `bg-destructive`; for good/warn use intentional Tailwind (`text-emerald-500`, `text-amber-500`) — pick, don't sprinkle.
- **Radius/shadow:** `rounded-lg` / `rounded-xl` on cards; `shadow-sm` sparingly. Consistent radius across the app.
- **Motion:** `animate-fade-in`, `animate-scale-in` (from motion.css) on mount/reveal — a light touch, not everywhere.

Recolor the whole app by editing `theme.muten`'s color tokens (they drive every shadcn token) — not per-element.

## Real components, not hand-rolled Stacks
For cards, avatars, badges, tabs, dialogs, selects → use the **shadcn parts** (`plugins { shadcn }`): `Card { CardHeader { CardTitle "…" } CardContent { … } }`, `Avatar(name: …)`, `Badge(label: …, variant: …)`, `Tabs`, `Combobox`. Hand-building these from raw `Stack`+classes is what reads as flat/AI-made. (The injected reference shows the exact call.)
- **Avatar contrast (a real bug to avoid):** a hand-rolled initials avatar needs a colored/gradient background AND a CONTRASTING initial — e.g. `Span "{initial(name)}" class("grid size-8 place-items-center rounded-full bg-gradient-to-br from-neutral-600 to-neutral-800 text-neutral-100 text-xs font-semibold")`. NEVER `bg-white text-white` (white-on-white = an invisible, blank circle). Better yet, use the `Avatar` part.

## Layout — the bones
- **App shell = FIXED height, scroll the CONTENT, not the page.** An app (dashboard · CRM · chat · admin · inbox · anything with a sidebar/topbar) fills the viewport and scrolls INSIDE its panes — the page itself must NOT grow and document-scroll (a table/feed getting taller should scroll its own pane, never stretch the whole screen). So: put `h-screen overflow-hidden` on the root `Page` shell — **NOT `min-h-screen`, which GROWS** — lay the panes with `flex`, keep sidebars/headers fixed, and give ONLY the scrollable pane `flex-1 overflow-y-auto min-h-0` (the `min-h-0` lets a flex child actually shrink so its own scrollbar kicks in). `min-h-screen` is for MARKETING/landing/content pages ONLY (those are meant to document-scroll).
- **App shell:** a persistent `Header`/`Nav` (and `Sidebar`/rail for apps) on every page, `Page` for the body. Landmarks (`Header`/`Nav`/`Sidebar`/`Footer`) are flex-column by default; a horizontal region = `Stack class("flex flex-row items-center")`.
- **Density with intent:** dashboards/chat/admin = **dense** (`gap-2`, `p-3`, `text-sm`, tight rows). Marketing/landing = **airy** (`gap-8`, `py-16 md:py-24`, big type). Match the product; don't make a chat app breathe like a landing page.
- **Rhythm:** lay out siblings with `flex`/`grid` + `gap`, never per-element margins. One spacing scale, reused. Content column capped (`max-w-3xl`/`max-w-5xl` + `mx-auto`) for reading; full-bleed only for shells.
- **Hierarchy:** every screen has ONE focal point. Group with cards/sections; separate zones with `border` + `bg-muted`, not just gaps.

## Contrast & layering — NEVER ship invisible text
Text must contrast with what is **actually rendered behind it** — this is the #1 bug that ruins an otherwise good page.
- **Know your ground.** The editorial theme is **LIGHT** (warm cream). So default text is **dark** (`text-foreground` / `text-stone-800`) on the page. `text-white` / light text is ONLY for a genuinely dark surface *directly behind* it. Light-on-light or dark-on-dark = an unreadable, blank-looking block. When unsure, use the semantic tokens (`text-foreground` / `text-muted-foreground` on `bg-background` / `bg-card`) — they are contrast-safe by construction.
- **Text over an image/gradient hero — the exact layering that WORKS (and the trap that kills it):**
  ```
  Stack class("relative overflow-hidden") {                                  # positioned parent
    Image "…" alt("…") class("absolute inset-0 h-full w-full object-cover")  # bg image — NO negative z
    Stack class("absolute inset-0 bg-stone-950/70") {}                       # dark overlay — NO negative z
    Stack class("relative z-10 … text-white") { Title "…" h1  Text "…" }     # content LIFTED with relative z-10
  }
  ```
  **NEVER push the image/overlay back with a NEGATIVE z-index (`-z-10` / `-z-20`).** A child with negative z sinks
  *behind its ancestor's own background* — so on the cream page the dark overlay disappears and your white headline
  lands on cream = an **invisible hero**. Correct layering is always POSITIVE: background layers sit at the base
  (`absolute inset-0`, no z), the content is raised with **`relative z-10`**. If a hero has NO image, don't invent a
  dark background just to use white text — keep dark text on the light theme, or give the hero a real `bg-*` block.
- **Overlay strength:** an image behind text needs a real scrim — `bg-black/50`…`/70` or a `bg-gradient-to-t from-black/80` — so the text reads on ANY photo. A faint `/20` overlay is not enough.

## Typography
- Titles carry weight: `Title "…" h1 class("text-3xl md:text-4xl font-semibold tracking-tight")`. The editorial theme pairs a serif display (Fraunces) with a clean body (Inter) — lean into that contrast for headings vs body.
- Body `text-sm`/`text-base` with `text-muted-foreground` for secondary. Uppercase labels get `text-xs uppercase tracking-widest text-muted-foreground`. Numbers that line up → `tabular-nums`.
- Never a wall of same-size text. Establish a scale (display / heading / body / meta) and stay on it.

## Make it feel REAL (this is what "scale in complexity" needs)
- **Real seed data, plenty of it:** 6–12 rows per list with believable names/values/timestamps — not "Item 1, Item 2". A list with 2 rows looks like a demo; 10 looks like an app.
- **Every state:** empty (`when list.length == 0 { … a real empty state … }`), active/selected (`class("bg-accent" when …)`), hover, loading (`when q.loading`), counts/badges. An app is its states.
- **Formatting via built-ins:** `money()`, `ago()`, `initial()`, `date()`/`time()` — never raw values or hand-rolled JS.
- **Interactions that work:** the composer appends, the tab switches the view, the filter filters, the toggle toggles. Wire the obvious actions.

## Make it MODERN — the polish that reads as 2025, not 2015
A page can be correct and still look flat. Modern = considered **depth, restraint, and motion**. Spend effort here:
- **Depth, not flat fills.** Cards and panels float on soft, layered shadow + a hairline border: `rounded-2xl border border-border bg-card shadow-sm` (or `shadow-lg shadow-black/5` for a hero card). One consistent generous radius across the page (`rounded-xl`/`rounded-2xl`), never a mix.
- **A restrained gradient/glow — ONE, with purpose.** A hero band, a primary button, or a stat strip can carry a subtle `bg-gradient-to-br` (two close hues) or a soft radial glow behind the headline. Never a rainbow, never a gradient on every card. Depth beats saturation.
- **Translucency + blur** on anything sticky/overlaid: `sticky top-0 bg-background/80 backdrop-blur-lg border-b` for a nav; `bg-card/60 backdrop-blur` for a glass panel. This one detail reads as instantly modern.
- **Confident, oversized display type.** The hero headline should be genuinely large (`text-5xl md:text-7xl tracking-tight leading-[1.02]`) with an **eyebrow** label above it (`text-xs uppercase tracking-[0.2em] text-muted-foreground`). Big type + generous whitespace is the whole look.
- **Micro-motion on reveal + hover.** `animate-fade-in`/`animate-scale-in` on sections as they mount; `transition-colors`/`transition-transform hover:-translate-y-0.5` on cards and buttons. A light touch — motion everywhere reads as cheap.
- **Real imagery in rounded frames**, `object-cover`, with a subtle ring/overlay — a page with photos feels 10× more real than one of solid blocks. (Only use an image URL you're confident resolves; a broken image is worse than a tasteful gradient frame — fall back to `bg-gradient-to-br from-muted to-accent` with an `Icon` centered.)
- **Refined details:** hairline dividers between sections (`border-t border-border`), `text-muted-foreground` for every secondary line, `tabular-nums` on figures, tight `tracking-tight` on headings and `tracking-widest` on tiny labels. Modern lives in the small stuff.

## Copy is design
Name things the way a user recognizes them (a person manages *notifications*, not *webhook config*). Buttons say what happens ("Publish"). Errors say what's wrong + how to fix. Write real labels, never lorem.

## The pre-ship pass before you call a page done
1. **Every text is legible** — dark-on-light or light-on-dark, never light-on-light; no negative-z overlay hiding a scrim. Read every heading; if you can't, the contrast is wrong.
2. One clear focal point + real hierarchy (not a flat list of same-weight blocks).
3. Semantic tokens only — no random hexes; accent used once, with purpose.
4. Right density for the product; consistent spacing + radius; depth via shadow+border, not flat fills.
5. Real, plentiful seed data; empty/active/hover states present.
6. shadcn parts for components; a light motion touch on reveal.
7. It doesn't look like the default template — you elevated the showcase, not just recolored it.

## Avoid the generic-AI look
Centered-everything, one acid accent on near-black, `rounded-lg` on every box, emoji as section markers, a giant hero on a tool that isn't a landing page, Inter-for-everything. Copy the showcase's *considered* choices instead; spend boldness in ONE place and keep the rest quiet.
