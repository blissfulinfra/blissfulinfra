# site/, Documentation Website

The public documentation site deployed to **https://blissful-infra.com** via Cloudflare Pages.

See root [CLAUDE.md](../CLAUDE.md) for monorepo conventions.

---

## Stack

- **Astro 6** with `output: 'static'`, generates a fully static site at build time
- **Starlight 0.38.2**: Astro integration for documentation sites (sidebar, search, theming)
- **@astrojs/sitemap**: auto-generates `sitemap-index.xml`
- **Deployment:** Cloudflare Pages (via GitHub Actions on push to `main`)

**Node requirement:** >=22.12.0 (Astro 6 requirement). Cloudflare Pages uses Node 22 by default, do not add a `.nvmrc` file.

---

## Commands

```bash
# From site/ directory:
npm run dev       # Astro dev server with HMR at localhost:4321
npm run build     # Static build → site/dist/
npm run preview   # Preview built output locally
```

**Always run from `site/`**, not the repo root, to avoid npm workspace detection issues with wrangler.

---

## Content structure

```
src/content/docs/
├── index.mdx                    # Landing page (hero + CardGrid + feature tables)
├── getting-started.md           # Installation + quickstart guide
├── commands/
│   ├── start.md
│   ├── dev.md
│   ├── dashboard.md
│   └── jenkins.md
└── templates/
    ├── overview.md
    ├── spring-boot.md
    └── react-vite.md
```

All content files are Markdown (`.md`) or MDX (`.mdx`). MDX is only needed when importing Starlight components (like `<CardGrid>`, `<Card>`). Plain docs pages use `.md`.

Frontmatter fields used by Starlight:
```yaml
---
title: Page Title          # required
description: One sentence  # used for SEO meta description
---
```

---

## Sidebar configuration

The sidebar is defined in `astro.config.mjs` under `starlight({ sidebar: [...] })`. It does **not** auto-generate from the file system, every new page must be manually added to the sidebar array.

```js
sidebar: [
  { label: 'Getting Started', link: '/getting-started' },
  { label: 'Commands', items: [
    { label: 'start', link: '/commands/start' },
    // add new commands here
  ]},
  // ...
]
```

---

## Theme and styling

Custom CSS is in `src/styles/custom.css`. The theme uses a navy dark palette:

- Background: `#0b0e1a`
- Accent (blue): `#3b7ef4`
- Text: `#f0f4ff`
- Muted text: `#8899b4`

Starlight CSS variables are overridden using `--sl-color-*` custom properties. Do not use inline styles in content files, use custom CSS classes instead.

---

## SEO

- Canonical URL base: `https://blissful-infra.com` (set in `astro.config.mjs` → `site`)
- Sitemap: auto-generated at `/sitemap-index.xml` by `@astrojs/sitemap`
- Robots: `public/robots.txt` allows all crawlers, points to sitemap
- OG image: `public/og.svg` (1200×630, navy branded)
- OG/Twitter meta tags: added in `astro.config.mjs` → `starlight({ head: [...] })`

---

## Cloudflare Pages deployment

**Automatic:** GitHub Actions (`.github/workflows/deploy-docs.yml`) deploys on push to `main`.

**Manual (wrangler CLI):**
```bash
cd site
npm run build
npx wrangler pages deploy dist
```

The `site/wrangler.toml` configures:
```toml
[assets]
directory = "./dist"

[build]
command = "npm ci && npm run build"
```

**Important:** Cloudflare Pages root directory must be set to `site/` in the Cloudflare dashboard (Pages → Settings → Build & deployments). This avoids npm workspace detection errors from wrangler running at the monorepo root.

---

## Adding a new docs page

1. Create `src/content/docs/<section>/<page>.md`
2. Add frontmatter: `title` and `description`
3. Add the page to the sidebar in `astro.config.mjs`

For pages that use Starlight components (`<Card>`, `<CardGrid>`, `<Tabs>`, etc.), use `.mdx` extension and import from `@astrojs/starlight/components`.
