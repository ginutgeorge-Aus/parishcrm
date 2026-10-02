# Contributing to ParishCRM

Thanks for your interest in improving ParishCRM! This guide covers how to get set up,
the workflow for changes, and the conventions we follow.

By contributing, you agree that your contributions are licensed under the project's
[AGPL-3.0](LICENSE) license. Before your first pull request is merged, you'll also be
asked to sign the [Contributor License Agreement](CLA.md) (a bot comments on your PR
with a sign-in link; one signature covers future PRs until the CLA changes).

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

### Keeping the docs current

User and admin docs live in [`website/src/content/docs/docs/`](website/src/content/docs/docs/) and
publish to the [project website](https://ginutgeorge-aus.github.io/parishcrm/docs/) on merge. The
**Wiki check** job (docs coverage) on every PR lists pages that cite files you changed; review them. A `feat:` PR
must add or extend a docs page explaining what the feature does, who can use it and how to
configure it — in the same PR. On the release PR the same job covers everything since the last
tag — clear it before merging a release. The release PR is opened with `GITHUB_TOKEN`, which
doesn't trigger CI, so close and reopen it (or push an empty commit) to get the Wiki check run.
Preview locally with `npm --prefix website install && npm --prefix website run dev`.

### Releasing

Releases are manual — merging PRs never releases. Run **Actions → Release → Run workflow** to
open or update the `chore(main): release x.y.z` PR, merge it when ready, then run the workflow
again to tag `vX.Y.Z`, create the GitHub release and publish the container image.

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
