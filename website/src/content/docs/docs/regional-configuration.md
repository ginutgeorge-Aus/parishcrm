---
title: "Regional Configuration"
description: "ParishCRM defaults to Australian conventions (July–June financial year, Sydney timezone, en-AU locale, AUD currency), but these are runtime settings, not…"
---

ParishCRM defaults to Australian conventions (July–June financial year,
Sydney timezone, `en-AU` locale, AUD currency), but these are runtime
settings, not hardcoded — one published container image can serve a church
in any region by setting a few environment variables.

## Using it

Set these in your `.env` (see [Installation](/parishcrm/docs/installation/)), not in the app UI — regional
config is read once when the server process starts.

| Variable | Meaning | Default |
|---|---|---|
| `APP_FY_START_MONTH` | Financial-year start month, `1`–`12` (`7` = July) | `7` |
| `APP_TIMEZONE` | IANA timezone name (e.g. `America/New_York`, `Europe/London`) | `Australia/Sydney` |
| `APP_LOCALE` | BCP-47 locale for money/date formatting (e.g. `en-US`, `en-GB`) | `en-AU` |
| `APP_CURRENCY` | ISO-4217 currency code — also the currency used for Stripe checkout, when card payments are enabled | `AUD` |

All four are optional; leave any unset to keep its default.

## How it works

- Values are validated at server start, not lazily: an out-of-range
  `APP_FY_START_MONTH`, an unrecognised `APP_TIMEZONE`, a malformed
  `APP_LOCALE`, or a non-3-letter `APP_CURRENCY` throws immediately at boot
  rather than surfacing as a confusing error later in a report or PDF.
- The financial-year setting drives every FY-scoped view — dashboard
  summaries, budgets, and financial reports all derive "current FY" and FY
  date ranges from `APP_FY_START_MONTH` (see
  [Financial Reports](/parishcrm/docs/financial-reports/) and [Budgets](/parishcrm/docs/budgets/)).
- The timezone and locale drive date/time and money formatting consistently
  across server-rendered pages, generated PDFs, and emails, and are also
  injected into the browser at page load so client-rendered components
  format identically to the server — there's no separate client-side
  timezone/locale config to keep in sync.
- `APP_CURRENCY` is also the currency ParishCRM requests when creating a
  Stripe Checkout session for event ticket payments (see
  [Card Payments (Stripe)](/parishcrm/docs/card-payments-stripe/)).

## Configuration

Set at deployment time in `.env` (or your platform's environment variable
configuration) — see [Environment Variables](/parishcrm/docs/environment-variables/) for the
complete list. A change to any of these four variables requires a container
restart to take effect.

## Related pages

- [Environment Variables](/parishcrm/docs/environment-variables/)
- [Financial Reports](/parishcrm/docs/financial-reports/)
- [Budgets](/parishcrm/docs/budgets/)
- [Card Payments (Stripe)](/parishcrm/docs/card-payments-stripe/)
