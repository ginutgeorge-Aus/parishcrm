# Environment & Local Setup

> This is the generic, public configuration reference. Values shown are placeholders.
> (Private deployments: keep live production values in the gitignored `docs/private/environment.md`.)

## App environment

**`.env.example` is the canonical list** of every variable the app reads —
grouped, with defaults and behaviour. Copy it to `.env.local` for local dev
(README → Getting started) or `.env` for a deployment (`docs/self-hosting.md`).
Local dev typically adds `DISABLE_OTP=true` (never in production).

## CI-only secrets (GitHub Actions, not read by the app)

```
OPENROUTER_API_KEY="sk-or-..."      # optional weekly AI reviewer (weekly-review.yml); repo variable OPENROUTER_MODEL overrides the model
```

> **Stripe webhook endpoint**: prod needs a Stripe webhook endpoint registered (Stripe Dashboard → Developers → Webhooks) pointing at `<APP_URL>/api/stripe/webhook`, subscribed to `checkout.session.completed`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.

> **Event → website sync (optional)**: the CRM is the source of truth for events. When `WEBSITE_SYNC_URL` is set, `src/lib/websiteSync.ts` pushes an HMAC-signed webhook to an external site on create/update/publish/delete so it can mirror events into a public calendar. Best-effort and awaited (errors never fail the action, but a slow receiver can delay a save up to the 8 s timeout); an ADMIN "Resync website" button on `/events` is the backstop. `registerUrl` is set only when an event has ticket types → the site shows a Register button linking back to CRM `/e/[slug]`. Leave `WEBSITE_SYNC_URL` unset to disable (the Resync button is then hidden). Receiver contract → `docs/event-webhook.md`.

## Build-time (Docker ARG/ENV, CI injects automatically)

```
NEXT_PUBLIC_APP_VERSION   # git tag shown in sidebar
NEXT_PUBLIC_GIT_SHA       # commit SHA shown in Settings
```

## First-run setup (optional)

| Variable | Purpose |
|----------|---------|
| `SETUP_TOKEN` | Enables `/setup` (create the first ADMIN) while the database has zero users. Page self-disables once any user exists; unset it after setup. |
| `MIGRATE_ON_START` | Default `true`: the container runs `prisma migrate deploy` before starting. Set `false` to manage migrations yourself (e.g. a separate pre-deploy job). |
| `CLIENT_IP_HEADER` | Optional. Name of a request header carrying the real client IP (e.g. `cf-connecting-ip`), used for login throttling and audit-log IPs when your platform adds proxy hops. Unset: rightmost `x-forwarded-for` entry. **Security-sensitive:** see [the full explanation](#client_ip_header). |
| `DEMO_MODE` | Public live demo only. `true` enables one-click demo logins and blocks account/settings changes; see `docs/live-demo.md`. Never set on a real deployment. |

## CLIENT_IP_HEADER

Login throttling and audit-log IPs use the client IP. By default the app reads the rightmost
`x-forwarded-for` entry, which is correct when your reverse proxy is the last hop. Some platforms
append their own internal hop (e.g. Render: the rightmost entry is a private `10.x` address), so every
login shares one throttle bucket and audit IPs are useless. Set `CLIENT_IP_HEADER` to the name of a
header that carries the real client IP (e.g. `cf-connecting-ip`, `true-client-ip`) to use that instead.

**Security rule:** the outermost trusted proxy/CDN must **overwrite** that header on every request
(never append to it or pass the client's value through), and the app must not be reachable any other
way that bypasses that proxy (e.g. a direct `*.onrender.com` hostname, an open port). Otherwise clients
can send the header themselves and dodge rate limits. If the header holds several comma-separated
values the app uses the rightmost, and it must be a valid IP.

- A missing or non-IP header value falls back to `x-forwarded-for`. A one-time warning is logged only
  when a proxied request (one carrying `x-forwarded-for`) lacks a usable header.
- `x-forwarded-for` and `forwarded` (client-controlled first entry) and invalid header names are
  ignored, with a boot-log warning.
- Names some proxies pass through from the client unchanged (`x-real-ip`, `x-client-ip`, `client-ip`,
  `x-originating-ip`, `x-cluster-client-ip`) are honoured, with a boot-log warning so you confirm your
  proxy overwrites them.
- `cf-connecting-ip` fits when every request goes through Cloudflare (e.g. your own proxied zone).
  Render's edge appears to send it too, but Render does not document this, so confirm the header on
  your own deployment first.

## Seed Credentials

| Email | Password | Role |
|-------|----------|------|
| admin@example.com | admin123 | ADMIN |
| pastor@example.com | pastor123 | PASTOR |
| secretary@example.com | viewer123 | VIEWER |

AUDITOR role has no seeded user — create one manually via `/users` if needed for testing.
