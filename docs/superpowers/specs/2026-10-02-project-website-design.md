# Project website (landing + docs) — design

**Date:** 2026-10-02
**Status:** Draft for review

## Goal

A free, modern, professional public website for ParishCRM that (1) showcases the product to
churches evaluating it and (2) hosts the full user/admin manual. Replaces the GitHub wiki as the
canonical documentation.

## Decisions

| Topic | Decision |
|---|---|
| Scope | Landing page + full docs site. Wiki content migrated in; wiki retired to a pointer. |
| Hosting | GitHub Pages, source in `website/` in this repo. URL `https://ginutgeorge-aus.github.io/parishcrm/`. Custom domain out of scope (add later via `CNAME`). |
| Generator | Astro + Starlight (docs) with a custom Astro landing page. |
| Styling | Tailwind CSS v4 on the landing page; Starlight theme overridden via CSS custom properties so both share one palette/type scale. |
| Design process | `frontend-design` for landing layout/build; `impeccable` for design-system tokens, critique and polish passes. |
| Search | Starlight built-in Pagefind (static, client-side, no external service). |
| Live demo | Out of scope (needs a server + DB). |

## Structure

```
website/
  package.json            # isolated deps — not part of the app's npm install / CI build
  astro.config.mjs        # site + base '/parishcrm', Starlight sidebar groups
  src/
    pages/index.astro     # custom landing page
    components/landing/   # Hero, FeatureGrid, FeatureRow, TrustStrip, GetStarted, Footer
    content/docs/docs/    # migrated wiki pages → served under /parishcrm/docs/...
    styles/               # shared tokens (colours, fonts), Starlight overrides
  public/screenshots/     # demo-data screenshots (optimised WebP)
  scripts/screenshots.mjs # reproducible screenshot capture
```

Landing page at `/parishcrm/`; docs at `/parishcrm/docs/...`.

## Landing page

Sections, top to bottom:

1. **Nav** — logo, Features, Docs, GitHub, "Get started" button. Sticky, collapses to menu on mobile.
2. **Hero** — headline (e.g. "Church management your parish owns"), one-line subhead (free,
   self-hosted, encrypted), primary CTA → Installation docs, secondary CTA → GitHub. Dashboard
   screenshot in a browser-frame mockup.
3. **Feature grid** — 8 cards with icons: People & Families, Accounting & Reports, Events &
   Ticketing (Stripe), Check-in, Petty Cash, Receipts & Membership letters, Bank statement import,
   Roles & Permissions. Each links to its docs page.
4. **Feature rows** — 3 alternating screenshot/text rows for the strongest features
   (accounting, events/registration, family records).
5. **Trust strip** — AES-256-GCM encryption at rest, 2FA (email OTP + TOTP), role-based access,
   audit log, AGPL-3.0, self-hosted (your data stays on your server), OpenSSF Scorecard badge.
6. **Get started** — Docker / one-click Railway template, each linking to docs.
7. **Footer** — docs, GitHub, licence, security policy, contributing.

Quality bar: responsive down to 360px, light + dark mode, no horizontal scroll, WCAG AA contrast,
Lighthouse (mobile) ≥ 95 on performance, accessibility, best practices and SEO. One `impeccable`
critique/polish pass before PR.

## Docs

- 43 wiki pages (44 files minus `_Sidebar.md`) migrated to Starlight Markdown with frontmatter (`title`, `description`).
- Sidebar groups: Getting started · People & Members · Events · Accounting · Administration &
  Security · Operations & Integrations · Reference.
- Wiki-style links (`[Text](Page-Name)`) rewritten to site-relative links; `_Sidebar.md` replaced
  by Starlight sidebar config; `Home.md` becomes the docs index page.
- "Edit this page" links point to `website/src/content/docs/` on GitHub.
- Wiki retirement (after site is live, owner action): wiki `Home.md` replaced with a pointer to the
  site; remaining wiki pages removed one release later.

## Screenshots

Taken only from a local instance seeded with `ALLOW_DEMO_SEED=true npm run db:seed` — never real
church data (public repo). Captured with Playwright at a fixed viewport (light only — the app has no dark mode), converted
to WebP, checked into `website/public/screenshots/`. `website/scripts/screenshots.mjs` makes them
reproducible.

## CI / deploy

- New `.github/workflows/pages.yml`:
  - PRs touching `website/**`: install + `astro build` (build check only).
  - Push to `main` touching `website/**`: build + deploy via `actions/upload-pages-artifact` +
    `actions/deploy-pages`. Minimal permissions (`pages: write`, `id-token: write` on deploy job
    only). All actions pinned by SHA (zizmor/Scorecard).
- Repo setting: Pages source = "GitHub Actions" (owner action).
- `wiki-check.yml` retargeted from the `.wiki` checkout to `website/src/content/docs`.
- `links.yml` wiki pass replaced by a pass over `website/src/content/docs/**/*.md`.
- README "Documentation wiki" link → website.
- App tooling (`ci.yml` build, ESLint, knip, Jest, tsconfig) excludes `website/`.

## Out of scope

Live demo instance, custom domain, blog/news, i18n, versioned docs, analytics.

## Success criteria

- Site live on GitHub Pages; landing + all 43 docs pages reachable; search works.
- `astro build` passes with zero broken internal links (Starlight link validation).
- App CI unaffected.
- Lighthouse (mobile) ≥ 95 on landing page.
- No real data in screenshots or content.
