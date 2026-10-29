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
`x-forwarded-for` entry. That is only trustworthy when your trusted reverse proxy appends or sets the
real client IP as that rightmost entry (e.g. nginx `proxy_set_header X-Forwarded-For
$proxy_add_x_forwarded_for;` or `$remote_addr`); a proxy that passes the client's own header through
unchanged makes it spoofable. Some platforms
append their own internal hop (e.g. Render: the rightmost entry is a private `10.x` address), so every
login shares one throttle bucket and audit IPs are useless. Set `CLIENT_IP_HEADER` to the name of a
header that carries the real client IP (e.g. `cf-connecting-ip`) to use that instead.

**Security rule (applies whether or not `CLIENT_IP_HEADER` is set):** the app must not be reachable
any way that bypasses your trusted proxy (e.g. a direct `*.onrender.com` hostname, an open port);
otherwise clients can send the header themselves and dodge rate limits. When `CLIENT_IP_HEADER` is
set, the outermost trusted proxy/CDN must also **overwrite** that header on every request (never
append to it or pass the client's value through). Every proxy behind that edge must pass the header
through unchanged rather than append its own address. This holds for any name you choose: a header
is trusted only if the outermost proxy overwrites it on every request. If the header holds several comma-separated
values the app uses the rightmost, and it must be a valid IP.

- A configured header is honoured whether or not the request carries `x-forwarded-for` (many proxies
  set only e.g. `X-Real-IP`). Nothing here authenticates the request: if an attacker can reach the
  origin directly they can send the header themselves, so the origin must not be reachable except
  through your proxy (the security rule above).
- **Fallback order:** when `CLIENT_IP_HEADER` is set but the header is missing or not a valid IP, the
  resolver falls back to the rightmost `x-forwarded-for` entry, and if that is absent too, to one
  shared `unknown` rate-limit bucket. On platforms such as Render the rightmost `x-forwarded-for` entry
  can be the proxy's own hop, so every such request shares one throttle bucket: make sure your edge
  sends the header on every request. The fallback warning is logged at most once every 10 minutes per
  process, header name only.
- Only a well-formed IP is ever persisted as an IP (audit log) or sent as Turnstile `remoteip` by the membership and public-feedback forms (event registration and waitlist send the validated IP, or no `remoteip` when there is none). An empty rightmost
  entry (e.g. `x-forwarded-for: 6.6.6.6,`) is treated as untrusted and yields no IP. The rate-limit key uses
  the same trusted entry as the audit IP: any rightmost `x-forwarded-for` entry that is not a
  well-formed IP (`a1`, `evil`, a literal `unknown`, an empty trailing entry) shares the single
  `unknown` bucket, never the whole header; valid IPv4, `ip:port` and `[v6]:port` forms key on the
  canonical IP, except IPv6, which keys on its /64 prefix (one subscriber typically controls a whole /64).
  The audit IP stays the full address. A non-IP `CLIENT_IP_HEADER` value is never used.
- `cloudfront-viewer-address` carries `ip:port`; the port is stripped (including for unbracketed IPv6).
- Ignored with a boot-log warning: invalid header names and spoofable/append-list headers
  (`x-forwarded-for`, `forwarded`, `x-forwarded`, `forwarded-for`, `x-forwarded-client-ip`,
  `x-original-forwarded-for`).
- Known CDN/proxy headers (`cf-connecting-ip`, `fly-client-ip`,
  `fastly-client-ip`, `x-appengine-user-ip`,
  `cloudfront-viewer-address`) and any other custom name are honoured without a boot warning; confirm
  your proxy overwrites the header.
- Names some proxies pass through from the client unchanged (`x-real-ip`, `x-client-ip`, `client-ip`,
  `x-originating-ip`, `x-cluster-client-ip`, `true-client-ip`, which Cloudflare Free/Pro passes through, `x-envoy-external-address`, `x-azure-clientip`, `x-azure-socketip`) are honoured, with a boot-log warning so you confirm your
  proxy overwrites them.
- IPv6 values are canonicalised (case, zero compression, `::ffff:a.b.c.d` unwrapped to IPv4, zone id
  and port stripped) so equivalent spellings share one rate-limit bucket.
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
