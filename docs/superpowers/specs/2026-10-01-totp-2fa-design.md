# TOTP authenticator 2FA + backup codes — design

Date: 2026-10-01 · Ticket: OSS-21 · Status: approved

## Goal

Let a user opt in to an authenticator app (Google/Microsoft Authenticator, 1Password, Authy …) as
their second factor instead of the email OTP. Free, offline, no Gmail send quota. Email OTP stays
the default for everyone else and remains available as a fallback for enrolled users.

## Scope

In:
- Per-user, optional TOTP enrolment from `/account` (QR code + manual key, confirm with a code).
- Authenticator-code login step for enrolled users, with "Send email code instead" fallback.
- 10 single-use backup codes, shown once, regenerable.
- Disable TOTP (requires a current TOTP code or a backup code).
- ADMIN/OFFICE_ADMIN "Reset 2FA" for another user.
- Audit logging, lockout, trusted-device and `DISABLE_OTP` parity with email OTP.

Out (explicit):
- Enforcing TOTP for any role (no policy setting).
- Disabling TOTP via password + email OTP — lost device → backup code or admin reset.
- Passkeys (OSS-22), alternative email senders.

## Data model (`prisma/schema.prisma`)

`User` gains:

| Field | Type | Notes |
|---|---|---|
| `totpSecret` | `String?` | Base32 secret, **encrypted** via `src/lib/crypto.ts` `encrypt()` |
| `totpPendingSecret` | `String?` | Encrypted; set during enrolment, cleared on confirm/cancel |
| `totpEnabledAt` | `DateTime?` | Non-null ⇔ TOTP active |
| `totpLastStep` | `Int?` | Last accepted 30-s time step; replay guard |

New model:

```prisma
model BackupCode {
  id        String    @id @default(cuid())
  userId    Int
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  codeHash  String    // bcryptjs hash, cost 10
  usedAt    DateTime?
  createdAt DateTime  @default(now())
  @@index([userId])
}
```

`totpSecret` / `totpPendingSecret` are added to the encrypted-field inventory in
`.claude/rules/encryption.md` and to `scripts/rotate-encryption-key.ts`. Migration added under
`prisma/migrations/`.

## Library

`otpauth` (CJS build loads under Jest; `validate()` returns the matched step delta for the replay guard; authenticator preset: SHA-1, 6 digits, 30-s step), verification window ±1 step. Existing
`qrcode` dependency renders the `otpauth://` URI to a data-URL PNG server-side. Issuer label = church
name from `AppSetting` (fallback `"ParishCRM"`), account label = user email.

A small `src/lib/totp.ts` (`server-only`) wraps it:
- `generateTotpSecret(): string`
- `totpKeyUri(secret, email, issuer): string`
- `matchTotpStep(secret, code, now?): number | null` — returns the matched time step within ±1, or
  null. Callers use the step for the replay guard.
- `generateBackupCodes(): string[]` — 10 codes, 10 chars from a Crockford base32 alphabet, shown
  grouped `XXXXX-XXXXX`; normalised (uppercase, dashes/spaces stripped) before hashing/comparing.

## Login flow (`src/auth.ts`, `src/components/auth/LoginForm.tsx`)

Login is stateless server-side: email OTP mode is safe with only `email + otp` because a code exists
only after the password was verified. A TOTP code is always valid, so **TOTP mode must re-verify
the password in the same request.**

1. **Password step** (`mode: "password"`), after the password is verified and before the email-OTP
   issue block: existing `DISABLE_OTP` and trusted-device bypasses run first and still return the
   user. Then, if `totpEnabledAt` is set and the request did not set `emailFallback: true`, throw a
   new `TotpRequired` (`CredentialsSignin` subclass, code `TotpRequired`). No email is sent.
2. **Client** switches to an "authenticator" step on `TotpRequired`, keeping email + password in
   component state. It offers a "Use a backup code" toggle and a "Send email code instead" link,
   which re-submits the password step with `emailFallback: true` → existing email OTP path.
3. **TOTP step** (`mode: "totp"`, fields `email, password, code, remember`):
   - per-IP `dbRateLimit` (existing), password lock + OTP lock checks (existing helpers).
   - verify password with bcrypt exactly as the password branch (dummy hash for unknown users;
     password failures count toward `failedLoginAttempts`).
   - code matching 6 digits → `matchTotpStep`; accept only if `step > totpLastStep`, committed with
     an atomic `updateMany({ where: { id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] } })`
     that also resets `failedOtpAttempts`/`otpLockedUntil`. Zero rows updated → treated as failure
     (replay).
   - otherwise treat as a backup code: bcrypt-compare against the user's unused codes; on match,
     `updateMany({ where: { id, usedAt: null } })` to consume (zero rows → failure), reset OTP
     counters, audit `BACKUP_CODE_USED` with remaining-count metadata.
   - failure → increment `failedOtpAttempts`, lock 15 min at 5 (same code path as email OTP),
     audit `USER_LOGIN_FAILED` with `reason: "totp_invalid" | "backup_invalid" | "totp_replay"`.
   - success + `remember` → same pending trusted-device grant as email OTP success.
4. Non-enrolled users: flow unchanged.

## Enrolment & management (`src/lib/actions/totp.ts`, `/account`)

Server actions, all session-guarded on the acting user (no `userId` argument → no IDOR surface),
return the standard `ActionResult`:

| Action | Behaviour |
|---|---|
| `startTotpEnrolment()` | Rejects if already enabled. Generates secret, stores encrypted in `totpPendingSecret`, returns `{ qrDataUrl, manualKey }`. Re-calling replaces the pending secret. |
| `confirmTotpEnrolment(code)` | Verifies against pending secret; on success in one transaction: move to `totpSecret`, set `totpEnabledAt`, `totpLastStep`, clear pending, replace backup codes. Returns plaintext codes once. Audit `TOTP_ENABLED`. |
| `cancelTotpEnrolment()` | Clears `totpPendingSecret`. |
| `regenerateBackupCodes(code)` | Requires valid current TOTP code (replay-guarded). Deletes old codes, creates 10 new, returns them once. Audit `BACKUP_CODES_REGENERATED`. |
| `disableTotp(code)` | Accepts a current TOTP code or an unused backup code. Clears TOTP fields + all backup codes. Audit `TOTP_DISABLED`. |

Code-checking calls in these actions are rate-limited with `dbRateLimit("totp:manage:<userId>", 5, 15 min)`.

UI: new `src/components/account/TotpSettings.tsx` on `/account` above `TrustedDeviceList` —
status badge, enrol dialog (QR, manual key, code input), backup-codes panel (copy / download .txt,
"I've saved these" confirm), regenerate and disable dialogs. Backup codes are only ever in the
action response, never refetchable.

## Admin reset (`src/lib/actions/user.ts`, `/users`)

`resetUserTotp(userId)`: `canManageUsers`, target constrained by `assignableTargetWhere` (OFFICE_ADMIN
can't reset an ADMIN), self-reset rejected (use `/account`). Clears TOTP fields, deletes backup codes
and the user's trusted devices. Audit `TOTP_RESET` (actor + target). `ResetTotpButton` shown in the
users list next to `UnlockUserButton` only for enrolled users.

## Error handling

- Decryption failure of `totpSecret` at login → log server-side, treat as invalid code, audit reason
  `totp_secret_unreadable`; the user can still use "Send email code instead" or a backup code.
- `TotpRequired` / `AccountLocked` / `OtpCooldown` surfaced via `result.code` like existing codes.
- All code comparisons are constant-time (otpauth / bcrypt compare).

## Testing (Jest, `.claude/rules/testing.md` conventions)

- `totp.ts`: step match at −1/0/+1, reject ±2, backup-code format + normalisation.
- `authorize` TOTP mode: success, wrong code, missing/wrong password rejected even with a valid
  code, replay of same step rejected, backup code single-use, lockout after 5 failures, password
  lock honoured, trusted-device + `DISABLE_OTP` bypass enrolled users, `emailFallback` issues email
  OTP, non-enrolled flow unchanged.
- Actions: enrol confirm with valid/invalid code, already-enabled rejection, regenerate requires
  code, disable via TOTP and via backup code, rate limit.
- `resetUserTotp`: guards (role, target role, self), clears devices, audit.
- LoginForm: `TotpRequired` → authenticator step, fallback link.

## Docs

Update `.claude/rules/auth.md` (TOTP section) and `.claude/rules/encryption.md` (inventory).

## Review

Auth change > 150 logic lines → `/code-review high` + specialist reviewers before merge.
