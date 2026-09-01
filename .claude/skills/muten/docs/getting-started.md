# Installation & first app

## Scaffold

```sh
npm create muten@latest my-app
cd my-app
npm install
npm run dev
```

The scaffolder (`create-muten`) is cross-platform (Windows + macOS + Linux) and offers options:

```sh
npm create muten@latest my-app -- --scss --tailwind --vercel --tauri --pm bun
```

| Flag | Effect |
|---|---|
| `--css` / `--scss` | stylesheet flavour (`src/styles.css` or `.scss`) |
| `--tailwind` / `--daisyui` | add Tailwind (and DaisyUI) on top of CSS, with a seeded `theme.muten` |
| `--vercel` | a `vercel.json` with the SPA fallback |
| `--tauri` | wrap the same web build as a native desktop app |
| `--pm npm\|pnpm\|yarn\|bun` | which package manager to install with |

## The project, by convention

```
my-app/
├─ src/
│  ├─ app.muten            # the ROOT: routes (+ optional persistent shell) - read first
│  ├─ pages/
│  │  └─ home/home.muten   # a page; the folder name is its route target
│  ├─ parts/               # reusable .muten fragments (inlined at build)
│  ├─ components/          # host-written Custom JS (the escape hatch)
│  └─ <domain>.store       # app-global state slices
├─ theme.muten             # the project's design values (space/font/colors/…)
├─ src/styles.css          # the look (Muten ships structure; the skin is yours)
├─ index.html              # loads /src/app.muten - don't hand-edit the boot
└─ muten.config            # the build, in muten (theme adapter) - only with Tailwind/DaisyUI
```

`src/app.muten` is the single source of truth - `index.html` loads it, the plugin boots it. **Never create a
`main.js` or a `<script>` bootstrap.**

## The dev loop

```sh
npm run dev      # `muten dev` - esbuild dev server + surgical HMR + client-side routing
npm run lint     # `muten check` - the deterministic oracle (validate every page, no browser)
npm run build    # `muten bundle` - production CSR build
```

- **Author** in `.muten`. muten's runner compiles on the fly; a text/class edit re-renders just that node (surgical HMR), bigger changes reload.
- **Check** with `muten check` (alias `lint`): structured diagnostics (code + location + "did you mean…?") in
  milliseconds, no browser. This is the AI-first feedback loop - and the VS Code extension surfaces the same
  diagnostics inline as you type, with one-click quick-fixes.
- **Build** with `muten bundle` (a SPA/CSR bundle) or `muten build` (static SSG with SEO). See [Deployment](deployment.md).

## Your first edit

Open `src/pages/home/home.muten` and change the `Page`. Add a route in `src/app.muten`
(`"/about" -> about`) and create `src/pages/about/about.muten`. `muten check` (or the editor) tells you
immediately if a reference is wrong.

## Next
- [Mental model](mental-model.md) - how to think in Muten.
- [Pages & routing](routing.md), [State](state.md), [Forms](forms.md) - the core.
