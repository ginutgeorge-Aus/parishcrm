---
title: "Security Model"
description: "This page describes the request-level defenses that sit in front of every page and API route: the authentication middleware, security headers,…"
---

This page describes the request-level defenses that sit in front of every page and API
route: the authentication middleware, security headers, Content-Security-Policy, and rate
limiting. For login/OTP specifics see [Login-and-Two-Step-Verification](/parishcrm/docs/login-and-two-step-verification/); for role checks
see [Roles-and-Permissions](/parishcrm/docs/roles-and-permissions/); for data-at-rest protection see [Data-Encryption](/parishcrm/docs/data-encryption/).

## Using it

There is nothing for day-to-day staff to configure here — these protections are always on.
The one operationally-relevant behaviour to know about:

- If the app is ever deployed behind more than one running instance, the in-memory rate
  limiter (used for a handful of lower-stakes public endpoints) stops being fully effective,
  because each instance keeps its own counters. The app logs a boot warning if it detects a
  replica count above 1. Self-hosters running a single instance are unaffected.
- Every response carries a strict cross-origin policy. If you embed a ParishCRM page inside
  another site (e.g. an iframe), it will refuse to render there by design — `frame-ancestors`
  is set to deny all framing.

## How it works

**Middleware runs on every route.** `src/middleware.ts` runs on effectively every request
(static assets excluded) rather than only on protected routes, because it also needs to
apply a per-request Content-Security-Policy nonce everywhere, including public pages. It does
three things in order: check a site-wide maintenance flag, enforce authentication, and then
apply security headers.

**Edge vs. Node split.** NextAuth's config is split in two: `src/auth.config.ts` is
Edge-runtime-safe (no database driver, no bcrypt) and is what `middleware.ts` uses for JWT
validation; `src/auth.ts` is the full Node.js config with database access, used everywhere
else (Server Components, Server Actions, the credentials provider itself). Middleware can
only read and validate the JWT — it never touches the database on the hot path, and account-
state checks (locked, deleted, idle-timeout) happen inside the Node.js `jwtCallback`, which
also runs on every authenticated request via Server Components.

**Authentication gate.** Any request without a valid session is redirected to `/login`,
*unless* the path matches an explicit public-path allowlist (`src/lib/csp.ts`,
`isPublicPath`). That allowlist is a short, deliberately narrow list — exact paths (login,
password reset, privacy policy, health check, PWA assets, robots.txt), a few whole
"trees" (NextAuth's own routes, public branding assets, the membership application form),
and a small number of tightly-scoped regular expressions for specific public event pages,
specific public event API endpoints, and the token-scoped family self-update form. New public
sub-routes are never automatically public just because they share a prefix with an existing
one — each has to be added deliberately, which is intentional: it's the difference between
"only this exact sub-path is exposed" and "any future route under here silently becomes
public."

**Trailing-slash and path normalization.** The public-path check strips a trailing slash
before matching, so `/login/` can't slip past the allowlist as a distinct string that neither
matches nor requires auth. Any path that doesn't cleanly match a known public pattern stays
gated — the check fails closed.

**Role confinement.** After the authentication gate, one additional per-role check runs in
middleware: an `EVENT_ORGANISER` session outside its allowed path set is redirected to its
own home page. See [Roles-and-Permissions](/parishcrm/docs/roles-and-permissions/) for the full role model — every other role's
page-level and action-level permissions are enforced deeper in the app (layouts, Server
Actions), not in middleware.

**Security headers**, applied to every dynamic response (`src/lib/csp.ts`,
`SECURITY_HEADERS`):

| Header | Effect |
|---|---|
| `Strict-Transport-Security` | Forces HTTPS for two years, including subdomains, and is preload-eligible. |
| `X-Content-Type-Options: nosniff` | Stops the browser from guessing content types. |
| `X-Frame-Options: DENY` | Refuses to be framed by any site (belt-and-suspenders alongside CSP `frame-ancestors`). |
| `Referrer-Policy` | Limits what's sent in the `Referer` header on cross-origin navigation. |
| `Permissions-Policy` | Camera access restricted to same-origin only (used by the event check-in QR scanner); microphone and geolocation fully disabled. |
| `Cross-Origin-Opener-Policy: same-origin` | Prevents a cross-origin page that opens this app from reaching into its window. |
| `Cross-Origin-Resource-Policy: same-origin` | Stops other origins from embedding this app's responses as a subresource — relaxed to `cross-origin` only for the specific public event-image endpoint, which an external site's calendar embeds. |

**Content-Security-Policy.** Built per-request with a fresh random nonce
(`src/lib/csp.ts::buildCsp`). Scripts are restricted to same-origin plus the nonce plus
`strict-dynamic` (so Next.js's own bootstrap scripts work); in production there is no
`unsafe-inline` or `unsafe-eval` for scripts. Styles use the same nonce approach in
production. `object-src 'none'`, `frame-ancestors 'none'`, and `base-uri`/`form-action`
pinned to same-origin close off the classic injection escape hatches. The Cloudflare
Turnstile CAPTCHA origin is allow-listed narrowly (script, frame, and connect) when
Turnstile is configured; it's inert otherwise.

**Rate limiting.** Two limiter implementations exist, used for different purposes:
- A **database-backed** fixed-window limiter (`src/lib/dbRateLimit.ts`) is used for
  security-sensitive, low-volume paths — login attempts (per source IP) and password-reset
  requests (per target email and per source IP). Being database-backed, it stays correct
  regardless of how many app instances are running.
- An **in-memory** fixed-window limiter (`src/lib/rateLimit.ts`) is used for a few
  higher-volume public paths where exact cross-instance correctness matters less. It is only
  fully effective at a single running instance, which is why the app is designed to run that
  way and warns on boot if it detects otherwise.

Both limiters use a fixed time window rather than a sliding one, which allows a modest burst
right at a window boundary — an accepted tradeoff at parish scale, backstopped by the
account-level lockout described in [Login-and-Two-Step-Verification](/parishcrm/docs/login-and-two-step-verification/).

**Maintenance mode.** A database-backed flag can put the entire app behind a self-contained
503 page (with a short cache so the check itself doesn't hammer the database), used around
deployments. It intentionally bypasses nobody — not even an admin — except a small set of
health-check and static-asset paths needed to keep the deploy pipeline and the maintenance
page itself working.

## Configuration

| Variable | Purpose |
|---|---|
| `AUTH_SECRET` | Signs session tokens; see [Login-and-Two-Step-Verification](/parishcrm/docs/login-and-two-step-verification/). |
| `AUTH_URL` | Must be the real `https://` origin in production — session cookies are only marked `Secure` when the app detects a production environment, and NextAuth uses this URL to reason about the deployment origin. |
| `CONTAINER_APP_REPLICA_COUNT` | Set by the hosting platform, not by hand. If greater than 1, a boot warning fires because the in-memory rate limiter is only fully correct at a single instance. |

No CSP or security-header values are environment-configurable — they're fixed in code so a
misconfiguration can't accidentally weaken them.
