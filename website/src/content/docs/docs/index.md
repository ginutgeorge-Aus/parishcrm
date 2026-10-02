---
title: "ParishCRM documentation"
description: "User and administrator documentation for ParishCRM, a free, self-hosted church management system."
---

**ParishCRM** is a free, self-hosted church/parish management system — families
and members, accounting, event ticketing, petty cash, membership applications,
and donation receipts, in one app your church runs itself.

> **Single-tenant by design.** One deployment per church, configured through
> environment variables and an in-app Settings page — not a multi-tenant SaaS.
> Your data stays on your own server, encrypted at rest.

Built with Next.js 16 (App Router), Prisma 7 + PostgreSQL, NextAuth v5, and
shadcn/ui. Licensed under [AGPL-3.0](https://github.com/ginutgeorge-Aus/parishcrm/blob/main/LICENSE).

## Getting started

- [Installation](/parishcrm/docs/installation/) — Docker image, PostgreSQL, migrations, seeding, first login
- [Environment Variables](/parishcrm/docs/environment-variables/) — full `.env` reference, grouped
- [Upgrading](/parishcrm/docs/upgrading/) — safely moving to a new release
- [Settings and Branding](/parishcrm/docs/settings-and-branding/) — church identity, logo/colours, membership form options
- [Regional Configuration](/parishcrm/docs/regional-configuration/) — financial year, timezone, currency
- [Scheduled Jobs](/parishcrm/docs/scheduled-jobs/) — cron endpoints for reminders, cleanup, celebrations
- [Operations Scripts](/parishcrm/docs/operations-scripts/) — one-off `scripts/*.ts` catalogue

## Features

### People & families

- [People and Families](/parishcrm/docs/people-and-families/)
- [Family CSV Import](/parishcrm/docs/family-csv-import/)
- [Birthdays and Celebrations](/parishcrm/docs/birthdays-and-celebrations/)
- [Family Self-Update](/parishcrm/docs/family-self-update/)

### Dashboard & accounting

- [Dashboard](/parishcrm/docs/dashboard/)
- [Accounting Overview](/parishcrm/docs/accounting-overview/)
- [Transactions](/parishcrm/docs/transactions/)
- [Budgets](/parishcrm/docs/budgets/)
- [Financial Reports](/parishcrm/docs/financial-reports/)
- [Bank Statement Import](/parishcrm/docs/bank-statement-import/)
- [Receipts](/parishcrm/docs/receipts/)
- [Petty Cash](/parishcrm/docs/petty-cash/)
- [Reconciliation](/parishcrm/docs/reconciliation/)

### Events

- [Events Overview](/parishcrm/docs/events-overview/)
- [Public Event Registration](/parishcrm/docs/public-event-registration/)
- [Registrations Management](/parishcrm/docs/registrations-management/)
- [Card Payments (Stripe)](/parishcrm/docs/card-payments-stripe/)
- [Check-In](/parishcrm/docs/check-in/)
- [Event Organisers](/parishcrm/docs/event-organisers/)
- [Volunteer Crew Page](/parishcrm/docs/volunteer-crew-page/)
- [Event Reminders](/parishcrm/docs/event-reminders/)
- [Event Website Webhook](/parishcrm/docs/event-website-webhook/)

### Membership & communication

- [Membership Applications](/parishcrm/docs/membership-applications/)
- [Membership Letters](/parishcrm/docs/membership-letters/)
- [Email Notifications](/parishcrm/docs/email-notifications/)
- [Feedback Widget](/parishcrm/docs/feedback-widget/)
- [Help and What's New](/parishcrm/docs/help-and-whats-new/)

### Accounts & security

- [Roles and Permissions](/parishcrm/docs/roles-and-permissions/)
- [User Management](/parishcrm/docs/user-management/)
- [Login and Two-Step Verification](/parishcrm/docs/login-and-two-step-verification/)
- [Security Model](/parishcrm/docs/security-model/)
- [Data Encryption](/parishcrm/docs/data-encryption/)
- [Privacy and Audit Log](/parishcrm/docs/privacy-and-audit-log/)

## Core feature summary

- **Families & members** — family and person records with member numbers,
  email-consent tracking, soft-archive, role-gated pastoral notes.
- **Accounting** — chart of accounts, transaction ledger, bank-statement
  import with member auto-match, budgets, P&L / trial balance / cash flow /
  general ledger reports, annual giving summary, receipt emails.
- **Events** — public registration pages, ticketed events with custom
  questions, tiered pricing, optional card payments, check-in, CSV export.
- **Petty cash** — multiple concurrent sessions, cash-in / cash-out /
  bank-transfer entries, running balance, close-with-variance.
- **Membership** — public application form, approval workflow, letters and
  receipts.
- **Family self-update** — secure tokenised links let families review and
  update their own details.
- **Ops** — in-app bug/feature reporting, "What's New" changelog, audit log,
  admin-customisable email templates.

## Support

Found a bug or have a feature idea? Use the in-app feedback widget (see
[Feedback Widget](/parishcrm/docs/feedback-widget/)) or open an issue on GitHub.
