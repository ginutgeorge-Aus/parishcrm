---
title: "History of ParishCRM"
description: "ParishCRM did not start as an open-source project. It began as a private, in-house app built for a single church, ran that church's day-to-day operations for…"
---

ParishCRM did not start as an open-source project. It began as a private, in-house app built for a single church, ran that church's day-to-day operations for four months, and was then generalised and released publicly. This page tells that story.

## Chapter 1: A private workshop (May 2026)

The private predecessor was started on **15 May 2026** as a closed repository serving one congregation.

- **Day one**: a Next.js 14 scaffold with shadcn/ui, a Docker Compose PostgreSQL database, and a Prisma schema with `Family`, `Person` and `User` models.
- It was built in phases. Phases 1a–1e covered families, the people directory, mobile navigation and print. Phases 5a and 5b covered the chart of accounts and manual transactions. All of that landed **within the first 48 hours**.
- May was by far the busiest month: **530 commits, 206 of them features**.

## Chapter 2: Hardening in production (June to September 2026)

Once the church was running on it daily, the work moved from building features to making them correct and safe.

| Month | Commits | Feature commits |
|---|---|---|
| May | 530 | 206 |
| June | 363 | 57 |
| July | 277 | 51 |
| August | 237 | 12 |
| September | 160 | 22 |

Over the private phase there were **578 fix commits against 348 feature commits**. The main themes were:

- **Money math that is safe to the cent** across reports and petty cash
- **Bank statement import**: splitting one statement line across multiple categories, and keeping review drafts when the page is refreshed
- **Encryption key rotation**, with the data-loss traps closed
- **Security headers** (CSP with nonces, COOP/CORP cross-origin isolation)
- **Safe deploys**: moving from `prisma db push --accept-data-loss` to proper migrations
- **Framework upgrades**: from Next.js 14 to Next.js 16, and to Prisma 7

## Chapter 3: Deciding to open source (mid-September 2026)

By September the app was mature, but it had one church hard-coded everywhere: its name, its logo, one country's tax rules, one bank's statement format, a fixed financial year, and one denomination's membership rules.

A migration plan locked in these decisions:

| Decision | Choice |
|---|---|
| Target | A generic, reusable product, not a code dump |
| Tenancy | **Single-tenant**: one deployment per church, driven by configuration |
| Depth | **Full generalisation** before publishing, removing structural coupling as well as branding |
| Git history | A fresh public repository, **squashed to one commit** so no private history can leak |
| Licence | **AGPL-3.0**: churches self-host for free, and anyone who runs a modified copy as a service must share their source |
| Name | **ParishCRM** |
| Original church | Becomes **instance #1** of the product and runs on the published container images |

The rule that kept this manageable: *renovate the house you live in*. All the generalisation work happened in the private repository and was rolled out to the live app step by step. Only at the end was a clean snapshot published as a new public repository. Hard-coded values became [Settings & Branding](/parishcrm/docs/settings-and-branding/) and [Regional Configuration](/parishcrm/docs/regional-configuration/).

## Chapter 4: ParishCRM goes public (25 September 2026)

On **25 September 2026** the public repository was created with a single commit: *"ParishCRM v1.0.0 — initial public release"*. **v1.1.0** followed the same day.

The first day as an open-source project was spent on the tooling a public repository needs:

- **12 CI workflows**: build and test, gitleaks, Semgrep, OpenSSF Scorecard, zizmor, dependency review, link checking, PR-title linting, release-please, container image publishing, stale-issue handling and wiki drift checks
- **Codecov** coverage reporting with a project check
- This **feature wiki**
- Issue templates aimed at people hosting it themselves
- An optional **starter chart of accounts** for new installs

About **145 private-only files** were left out of the public snapshot. These were internal AI-assistant configuration, internal review reports, postmortems, the private roadmap, deployment and disaster-recovery runbooks, and the original church's branding.

## By the numbers

| | Private predecessor | ParishCRM (public) |
|---|---|---|
| Started | 15 May 2026 | 25 Sep 2026 |
| Visibility | Private | Public |
| Commits | 1,567 | 24 in the first day (squashed start) |
| Merged pull requests | 1,049 | 23 |
| Issues closed | 2,074 | 3 |
| Releases | 110 tags, up to v1.50.1 | v1.0.0 and v1.1.0 |
| Database models | 43 | 43 |
| Pages / API routes | 100 / 27 | 100 / 27 |
| Test files | 410 | 410 |
| Licence | AGPL-3.0 | AGPL-3.0 |

The product itself is the same size: every model, page, route and test carried over. What changed is that church-specific values became configuration, and the public repository gained its open-source tooling.

## Tech stack

- **Frontend**: Next.js 16 App Router, React 19, TypeScript
- **Backend**: Server Actions and API routes
- **Database**: Prisma 7 on PostgreSQL
- **Auth**: NextAuth v5 (JWT, email OTP two-step verification, trusted devices)
- **UI**: shadcn/ui and Tailwind CSS v4
- **Payments and email**: Stripe, Nodemailer
- **Validation**: Zod
- **Testing**: Jest 30, React Testing Library, Playwright
- **Runtime**: Node 24 or later

## Features at launch

- [People and families](/parishcrm/docs/people-and-families/), with [self-update links](/parishcrm/docs/family-self-update/)
- [Accounting](/parishcrm/docs/accounting-overview/): ledger, [bank import](/parishcrm/docs/bank-statement-import/), [budgets](/parishcrm/docs/budgets/), [financial reports](/parishcrm/docs/financial-reports/), [receipts](/parishcrm/docs/receipts/), [reconciliation](/parishcrm/docs/reconciliation/)
- [Petty cash](/parishcrm/docs/petty-cash/)
- [Events](/parishcrm/docs/events-overview/), with [public registration](/parishcrm/docs/public-event-registration/), [Stripe payments](/parishcrm/docs/card-payments-stripe/) and [check-in](/parishcrm/docs/check-in/)
- [Membership applications](/parishcrm/docs/membership-applications/) and [letters](/parishcrm/docs/membership-letters/)
- [Audit log](/parishcrm/docs/privacy-and-audit-log/), [What's New](/parishcrm/docs/help-and-whats-new/) and a [feedback widget](/parishcrm/docs/feedback-widget/)

In four and a half months: **over 1,000 pull requests, over 2,000 issues closed, and 110 releases**, followed by a public launch for any church to use.
