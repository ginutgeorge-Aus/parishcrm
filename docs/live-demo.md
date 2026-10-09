# Live demo

The public demo runs a tagged release with `DEMO_MODE=true` on a free host. The `demo-reset` workflow (`.github/workflows/demo-reset.yml`) wipes and reseeds its database every night at 17:00 UTC (03:00 AEST / 04:00 AEDT), then redeploys the demo. It seeds from the latest release tag. Run it manually from the Actions tab at any time. If a seed step fails part-way, rerun the workflow.

## What DEMO_MODE changes
- `/login` shows one-click "Try as <role>" buttons. They sign into `@demo.invalid` users only — no password, no 2FA.
- Blocked (returns "Disabled in the live demo"): user management, 2FA and trusted devices, password reset, first-run setup, settings, branding, email templates, file uploads (attachments, event images). Import is preview-only, capped at 200 KB.
- All email is suppressed. The in-app scheduler is off.
- Boot fails if any outbound integration is configured (mail, website sync, Azure Monitor, GitHub token, live Stripe key).
- A non-dismissable banner says the data is shared and resets nightly.

## Never set DEMO_MODE on a real deployment
Demo login only reaches `@demo.invalid` users, and user creation, first-run setup, and `scripts/create-admin-user.ts` reject that domain, so a real install has no account it can reach. It still blocks settings and user management.

## Reseed locally
    npx prisma migrate reset --force
    ALLOW_DEMO_SEED=true npm run db:seed
    ALLOW_DEMO_SEED=true DEMO_MODE=true npm run demo:seed
    DEMO_MODE=true npm run dev

Data comes from `scripts/demo/demoData.ts` (deterministic, synthetic).

## Hosting the demo (maintainer setup)
The demo runs on Render (free web service, image `ghcr.io/ginutgeorge-aus/parishcrm:latest`) with a Neon free Postgres database.

1. Neon: create project `parishcrm-demo`. Copy the **direct (unpooled)** connection string to repo secret `DEMO_DATABASE_URL`. `prisma migrate reset` needs a direct connection.
2. Run `openssl rand -base64 32` and save the result as repo secret `DEMO_ENCRYPTION_KEY`.
3. Render: create a web service from the image above, free plan. Env: `DEMO_MODE=true`, `DATABASE_URL` = Neon **pooled** connection string, `DIRECT_URL` = the direct string (the container runs `prisma migrate deploy` on start), `ENCRYPTION_KEY` = same value as `DEMO_ENCRYPTION_KEY`, fresh `AUTH_SECRET`, `AUTH_URL=https://<service>.onrender.com`, `CHURCH_NAME=Example Parish`. Copy the deploy hook URL to repo secret `RENDER_DEPLOY_HOOK`.
4. Run `demo-reset` from the Actions tab, then open the demo URL.

Each reset requests deployment of the image of the release it seeded (`:<tag>` via the hook's `imgURL`). The hook does not wait for the deploy to finish, so a slow or failed deploy can briefly leave the previous app running against the reset schema (deploy-status polling: #100). If that release's image is missing from GHCR, the reset fails and the demo keeps the previous night's data.
