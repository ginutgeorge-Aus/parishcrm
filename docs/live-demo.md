# Live demo

The public demo runs a tagged release with `DEMO_MODE=true` on a free host. A scheduled `demo-reset` workflow wipes and reseeds its database every night (added together with the hosted demo; until then, reset it manually with the commands below).

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
