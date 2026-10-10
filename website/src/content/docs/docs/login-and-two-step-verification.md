---
title: "Login and Two-Step Verification"
description: "Every staff sign-in is two steps: a password, then a one-time email code or an authenticator-app code, unless the browser is already marked as a trusted device. This page covers the…"
---

Every staff sign-in is two steps: a password, then a one-time code, unless the browser is
already marked as a trusted device. The code is emailed by default, or comes from an
authenticator app if you've turned that on. This page covers the login flow, authenticator
apps and backup codes, lockouts, "remember this device," password reset, and session lifetime. For who can do what once
signed in, see [Roles-and-Permissions](/parishcrm/docs/roles-and-permissions/); for the underlying request-level protections, see
[Security-Model](/parishcrm/docs/security-model/).

## Using it

**Signing in:**
1. Go to `/login`, enter your email and password.
2. If the password is correct and this browser isn't already trusted, a 6-digit code is
   emailed to your address. Enter it on the next screen — it expires after 10 minutes.
3. **Remember this device** is on the password screen and ticked by default. If it stays
   ticked, this browser skips the code step for 14 days after you finish sign-in. Untick it
   on shared computers.
4. On success you're signed in and redirected to the dashboard (or, for an Event Organiser,
   straight to `/my-events`).

**Signing in with an authenticator app:** once you've turned one on (see below), step 2
changes. No email is sent; instead you enter the 6-digit code from your app. Choose **Use a
backup code** to enter a saved backup code instead, or **Send email code instead** to get an
emailed code if you don't have your phone. The app code step re-checks your password in the
same request, so it can't be used on its own.

**Turning on an authenticator app:**
1. Go to **My Account** (`/account`) and, under **Authenticator app**, choose **Set up
   authenticator app**.
2. Scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator,
   or a password manager). A manual key is shown too if you can't scan.
3. Enter the code the app shows and your current password, then choose **Turn on**.
4. You're shown 10 one-time backup codes. Use **Copy** or **Download** to save them, then
   choose **I've saved these codes**. They are only shown once.

When it's on, **My Account** shows how many of the 10 backup codes you have left. You'll get
a confirmation email whenever you turn the authenticator on or off yourself. An admin reset
does not send an email.

**Backup codes:** each of the 10 codes works once. Choose **New backup codes** on **My Account**
and enter a current app code to replace the whole set (the old codes stop working).

**Turning it off:** on **My Account**, choose **Turn off** and enter an app code or an unused
backup code. Sign-in goes back to emailed codes.

**Lost phone:** an admin or office admin can reset your authenticator from **Users** (see
[User-Management](/parishcrm/docs/user-management/)). You then sign in with emailed codes
until you set it up again.

**If you get locked out:** five wrong passwords, or five wrong verification codes, locks the
account for 15 minutes. The login screen tells you the account is locked — just wait, or ask
an admin to unlock you early from **Users** (see [User-Management](/parishcrm/docs/user-management/)).

**Forgotten password:**
1. On the login page, choose **Forgot password**, enter your email.
2. You'll always see the same "check your email" response, whether or not that email has an
   account — this is deliberate, so the page can't be used to find out who has an account.
3. If an account exists, a reset link arrives, valid for 1 hour and usable once. Follow it,
   choose a new password meeting the strength rule (8+ characters, upper, lower, digit,
   symbol). This also signs you out everywhere else and clears any lockouts.

**Managing trusted devices:** go to **My Account** (`/account`) to see every device you've
told the system to remember, with when it was last used, and revoke any you don't recognise
— useful if you ticked "remember" on a shared or public computer by mistake.

**Local development:** `DISABLE_OTP=true` in `.env.local` skips the code step entirely so you
don't need working email to develop locally. It is refused outright if the app detects a
production environment.

## How it works

The full flow is implemented in `src/auth.ts` (`authorizeCredentials`, the NextAuth
Credentials provider) plus `src/lib/actions/auth.ts` (self-service password reset). The
Edge-safe half of the config used by `middleware.ts` lives in `src/auth.config.ts` — see
[Security-Model](/parishcrm/docs/security-model/) for the Edge/Node split.

**Two-step flow in detail.** The credentials form is submitted twice under the hood: once in
`mode: "password"`, once in `mode: "otp"`. On the password step, a correct password causes
the server to generate, HMAC-hash, and store a 6-digit code (10-minute expiry) and email it —
then deliberately *reject* the sign-in attempt with a distinguishable error so the client
knows to show the code-entry screen. The client resubmits with `mode: "otp"` and the code;
only a valid, unexpired, unused code completes the sign-in. The code itself is generated with
rejection-sampling over a CSPRNG so every 6-digit value is equally likely, and it's compared
using a timing-safe comparison rather than `===`. Consuming an OTP is atomic — a database
update conditioned on the exact code still being present — so two near-simultaneous
submissions of the same correct code can't both succeed and mint two sessions.

**Authenticator app (TOTP).** Enrolment, backup codes and turning it off live in
`src/lib/actions/totp.ts`; code checking is in `src/lib/totpVerify.ts` and `src/lib/totp.ts`.
Codes are standard 6-digit, 30-second authenticator codes, and the previous and next
30-second codes are also accepted to allow for clock drift. The secret is stored encrypted.
Starting setup stores a pending secret; it only becomes active when you confirm with a valid
code and your password. When an enrolled user passes the password step, the server rejects
the attempt with a distinguishable error (like the email flow) so the client shows the app
code screen, and no email is sent. The client then resubmits with `mode: "totp"`, the code and
the password. A code can only be used once: a replayed code is rejected, enforced by an
atomic update of the last accepted time step. An input of exactly 6 digits is treated as an
app code; anything else is checked as a backup code. Backup codes are 10 characters, stored
only as bcrypt hashes, and consumed atomically so one code can't be used twice. Every
management action acts only on the signed-in user, and turning on, regenerating and turning
off also require a current code (and the password, for turning on). Turning on and off, and
backup-code use and regeneration, are written to the audit log.

**Admin reset.** `resetUserTotp` in `src/lib/actions/user.ts` clears the authenticator, all
backup codes and all trusted devices for the user, and signs out their existing sessions.
It needs `canManageUsers` (ADMIN or OFFICE_ADMIN) and `canAssignRole` for the target, so only
an ADMIN can reset an ADMIN or PASTOR. You can't reset your own; use **My Account**. The
**Reset 2FA** button appears on a user's row in **Users** only when they have an authenticator
turned on.

**Trusted devices.** The "remember this device" checkbox sits on the password step and is ticked by default. When it is ticked, a successful second factor (emailed code, app code or backup code) writes an
opaque, random token into an httpOnly cookie and stores only its HMAC in the database
against your user, with a 14-day expiry. On a later password-only sign-in, if that cookie is
present, valid, unexpired, and belongs to the account being signed into, the code step is
skipped entirely, whether the account uses emailed codes or an authenticator app. Trust survives an ordinary sign-out (that's the point — "remember" should
mean the next normal login skips the code too), but a password reset or an admin-forced
password change clears all trusted devices for that account immediately. Trust can also be
revoked per-device from **My Account**.

**Lockouts.** Failed password attempts and failed code attempts (email codes, app codes and
backup codes alike) are tracked and locked out independently (5 attempts → 15-minute lock each), both stored in the database rather than in
memory, so they're correct no matter how many app instances are running. A lock is always
surfaced as "account locked," even if, for example, an outstanding code has since expired —
the lock check runs before the expiry check. A password-locked account cannot bypass the
lock by using a leftover unexpired code from before the lock, and an OTP-brute-force lock
survives a fresh, correct password resubmission (the code lockout isn't reset just because
the password step was retried). A successful app or backup code sign-in clears both counters.
The management actions on **My Account** have their own limit of 5 code checks per 15 minutes.

**Password reset.** Reset requests are rate-limited per target email and per requesting IP,
using the same database-backed limiter as login. The response is identical whether or not
the email belongs to an account, and a deliberate small random delay is added to the "no such
account" and "already have an active reset link" paths so they can't be distinguished from
each other by response timing. The reset token itself is single-use and time-boxed, consumed
atomically so two submissions of the same link can't both succeed.

**Session lifetime.** A sign-in issues a JWT-based session. Every request re-validates the
token server-side against the database: a deleted, archived, or now-locked account, or one
whose sessions were force-invalidated (by a password change, forced reset, or explicit
sign-out), has its session killed immediately even though the JWT itself hasn't expired.
Non-"remembered" sessions get a 4-hour hard cap plus an idle timeout (default 60 minutes,
configurable by an admin in Settings); "remembered" sessions instead get a 7-day sliding idle
window with no separate hard cap. The in-browser inactivity timer (the "Session expiring" warning)
follows the same rule, so an idle open tab only signs a remembered session out after 7 days.

## Configuration

| Variable | Purpose |
|---|---|
| `AUTH_SECRET` (or legacy `NEXTAUTH_SECRET`) | Signs sessions and is used to HMAC verification codes and trusted-device tokens. |
| `AUTH_URL` (or legacy `NEXTAUTH_URL`) | Public app URL; must match the real origin in production or sign-in redirects and reset links break. |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | SMTP credentials the verification-code and password-reset emails are sent through. |
| `DISABLE_OTP` | Local-development-only flag to skip the email code step. Refused if the app detects it's running in production. |
| `SESSION_IDLE_TIMEOUT_MINUTES` (in-app Settings, not an env var) | How long a non-"remembered" session may sit idle before expiring; defaults to 60 minutes if unset. |
