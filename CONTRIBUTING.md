# Contributing to ParishCRM

Thanks for your interest in improving ParishCRM! This guide covers how to get set up,
the workflow for changes, and the conventions we follow.

By contributing, you agree that your contributions are licensed under the project's
[AGPL-3.0](LICENSE) license.

## Getting set up

See [README.md](README.md) → **Getting started** for local setup (Node ≥ 24, `.env.local`,
local PostgreSQL via `npx prisma dev`, seed, and `npm run dev`).

## Before you start

- **Search existing issues** before filing a new one, and comment on an issue before starting
  significant work so we can avoid duplicate effort.
- For anything beyond a small fix, open an issue to discuss the approach first.
- Found a security vulnerability? **Do not open a public issue** — follow [SECURITY.md](SECURITY.md).

## Workflow

**All changes go through a branch and a pull request — no direct pushes to `main`.**

1. Fork the repo (external contributors) or create a branch (maintainers).
2. Branch naming: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>`.
3. Make your change with tests.
4. Run the checks below locally.
5. Open a PR with a clear description of **what** changed and **why**. Link the issue it
   closes (`Closes #123`).
6. Keep PRs focused — one logical change per PR is much easier to review.

### Checks to run before opening a PR

```bash
npm run lint                 # ESLint
npx tsc --noEmit             # TypeScript
npm test -- --no-coverage    # unit tests (Jest)
npm run build                # production build
```

### Keeping the wiki current

The [wiki](https://github.com/ginutgeorge-Aus/parishcrm/wiki) is maintained by hand — each page
cites the source files it describes. The **Wiki check** job on every PR lists the pages that cite
files you changed; review them. A `feat:` PR must add or extend a wiki page explaining what the
feature does, who can use it (roles) and any configuration. On the release PR the same job covers
everything since the last tag — clear it before merging a release. The release PR is opened
with `GITHUB_TOKEN`, which doesn't trigger CI, so close and reopen it (or push an empty commit) to
get the Wiki check run. The wiki is a separate repo:
`git clone https://github.com/ginutgeorge-Aus/parishcrm.wiki.git`.

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`
(e.g. `fix(accounting): correct FY range off-by-one`). Keep the subject imperative and under
~50 characters; add a body only when the *why* isn't obvious.

## Schema changes

Database changes use Prisma Migrate:

```bash
# on a branch
npx prisma migrate dev --name <change>   # creates a migration + syncs your local DB
npx prisma generate                      # regenerate the client
npm test -- --no-coverage
git add prisma/                          # commit schema + generated migration together
```

- **Never** hand-edit a committed migration or the generated Prisma client
  (`src/lib/generated/prisma/**`) — regenerate it with `npx prisma generate`.
- Design migrations to be safe to apply to a live database (additive first; avoid destructive
  drops in the same release as the code that stops using a column).

## Code style

- **TypeScript strict mode.** No `any` unless genuinely unavoidable and commented.
- **Server Components by default;** add `"use client"` only for components that need hooks or
  browser events.
- **Guard every DB mutation** with role checks at **both** the page/route and the Server Action.
- **Money is stored as `Decimal` (dollars, not cents)** — never use floating-point math for money.
- **Tailwind design tokens**, not inline styles. Prefer existing shadcn/ui components.
- Keep church-specific identity and region behavior **configurable** — don't hardcode a church
  name, currency, fiscal year, or tax rules. Route them through settings/config.
- Match the style of the surrounding code.

## Reporting bugs & requesting features

Open a GitHub issue with:
- What you expected vs. what happened
- Steps to reproduce (for bugs)
- Version / commit and environment details where relevant

## Code of Conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it.
