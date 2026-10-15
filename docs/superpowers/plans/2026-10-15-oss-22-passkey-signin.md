# Passkey (WebAuthn) Sign-in Implementation Plan

> **Superseded in places by review fixes on PR #286.** The shipped code uses a separate `passkey` Credentials provider (`authorizePasskey`, client `signIn("passkey", …)`) instead of `mode: "passkey"`. It rejects IP hosts as the RP ID (only `https://` or `http://localhost`), checks the account lock only after the signature verifies, and wipes passkeys and trusted devices on password reset, admin password change, TOTP reset and admin revoke. The code is the source of truth.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users register passkeys on `/account` and sign in with one, so a single passkey ceremony replaces the password and the second-factor steps.

**Architecture:** `@simplewebauthn/server` on the server, `@simplewebauthn/browser` on the client. Challenges live in a new `WebAuthnChallenge` table. Each one is single-use (consumed by `delete`) and expires after 5 minutes. Credentials live in a new `Passkey` table. Login is a new `mode: "passkey"` branch in the existing NextAuth Credentials `authorizeCredentials`, which keeps the JWT/session machinery unchanged. Login uses discoverable credentials (usernameless): the browser picks the passkey and the server finds the user from `credentialId`. The RP ID and origin come from `AUTH_URL`.

**Tech Stack:** Next.js 16 server actions, NextAuth v5 Credentials, Prisma 7 / PostgreSQL, `@simplewebauthn/server@^13`, `@simplewebauthn/browser@^13`, Jest.

## Global Constraints

- `userVerification: "required"` on every ceremony; `requireUserVerification: true` on every verify. Passkey login stands in for the password and the 2FA steps.
- Discoverable credentials: `residentKey: "required"`; `attestationType: "none"`.
- Challenge TTL is 5 minutes, single-use, and scoped by purpose (`"register"` | `"login"`). Register challenges are also scoped by userId.
- RP ID = `new URL(AUTH_URL).hostname`, origin = `new URL(AUTH_URL).origin`. If `AUTH_URL` is missing or unparseable, or it is http on a host other than loopback, passkeys are disabled: the UI is hidden and the actions return `{ error: "Passkeys are not available on this server" }`.
- Password + email OTP / TOTP stay fully available. Nothing on those paths changes.
- Every management action acts on the session user only (no userId arg). Admin revoke lives in `src/lib/actions/user.ts`.
- `assertNotDemo()` on every mutating action. In `authorizeCredentials`, the existing demo guard already rejects demo emails for any mode except `"demo"`. The passkey branch adds its own check after resolving the user.
- Audit actions: `PASSKEY_REGISTERED`, `PASSKEY_REMOVED`, `PASSKEYS_REVOKED`, and `USER_LOGIN` with metadata `{ via: "passkey" }`. Failures log `USER_LOGIN_FAILED` with `{ reason: "passkey_invalid" }`.
- Max 10 passkeys per user. Name is trimmed, 1–50 chars.
- Never log email addresses; log the userId only.
- Comments match the surrounding density: explain the *why* of security decisions, like the existing auth code does.
- No `npm run build` locally. Verify with the touched jest suites, `npx tsc --noEmit` and `npm run lint`.

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | + `Passkey`, `WebAuthnChallenge` models, `User` back-relations |
| `prisma/migrations/20261015000000_passkeys/migration.sql` | DDL |
| `src/lib/webauthn.ts` (new, server-only) | RP config from `AUTH_URL`, challenge create/consume, cuid/name validation |
| `src/lib/actions/passkey.ts` (new) | session-user actions: status/list, start/finish registration, remove; public `startPasskeyLogin` |
| `src/auth.ts` | `mode: "passkey"` branch + `assertion`/`challengeId` credential fields |
| `src/lib/actions/user.ts` | `revokeUserPasskeys(id)` (admin) |
| `src/components/account/PasskeySettings.tsx` (new) | list / add / remove UI |
| `src/app/(dashboard)/account/page.tsx` | mount `PasskeySettings` |
| `src/components/auth/LoginForm.tsx` | "Sign in with a passkey" button |
| `src/components/users/RevokePasskeysButton.tsx` (new) + `src/app/(dashboard)/users/page.tsx` | admin button |
| `__tests__/lib/webauthn.test.ts`, `__tests__/actions/passkey.test.ts`, `__tests__/lib/auth.test.ts`, `__tests__/actions/user*.test.ts` | tests |
| `docs/environment.md`, `docs/self-hosting.md`, `.claude/rules/auth.md` (local, untracked) | docs |

---

### Task 1: Schema, deps, `src/lib/webauthn.ts`

**Files:**
- Modify: `package.json` (deps)
- Modify: `prisma/schema.prisma` (after `BackupCode`; add relations to `User`)
- Create: `prisma/migrations/20261015000000_passkeys/migration.sql`
- Create: `src/lib/webauthn.ts`
- Test: `__tests__/lib/webauthn.test.ts`

**Interfaces — Produces:**
```ts
export type RelyingParty = { rpID: string; origin: string }
export function getRelyingParty(): RelyingParty | null
export const PASSKEY_CHALLENGE_TTL_MS: number            // 5 * 60_000
export const MAX_PASSKEYS_PER_USER: number               // 10
export type ChallengePurpose = "register" | "login"
export async function createChallenge(challenge: string, purpose: ChallengePurpose, userId: number | null): Promise<string> // returns row id
export async function consumeChallenge(id: unknown, purpose: ChallengePurpose, userId: number | null): Promise<string | null> // returns challenge string or null
export function normalisePasskeyName(name: unknown): string | null
```

- [ ] **Step 1: Install deps**

Run: `npm install @simplewebauthn/server@^13 @simplewebauthn/browser@^13`

- [ ] **Step 2: Schema**

Add to `User`: `passkeys Passkey[]` and `webAuthnChallenges WebAuthnChallenge[]`. Add the models:

```prisma
// Passkey (WebAuthn) credential. publicKey is the COSE public key — not secret,
// so stored plain. counter is the authenticator's signature counter (u32, hence
// BigInt); many platform passkeys always report 0, which disables the check.
model Passkey {
  id           String    @id @default(cuid())
  userId       Int
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  credentialId String    @unique
  publicKey    Bytes
  counter      BigInt    @default(0)
  transports   String[]
  name         String
  backedUp     Boolean   @default(false)
  createdAt    DateTime  @default(now())
  lastUsedAt   DateTime?

  @@index([userId])
}

// Server-side WebAuthn challenge. Single-use: consumed by delete, so only one
// request can ever win it. userId is set for registration (bound to the
// session user) and null for usernameless login.
model WebAuthnChallenge {
  id        String   @id @default(cuid())
  challenge String
  purpose   String
  userId    Int?
  user      User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([expiresAt])
}
```

- [ ] **Step 3: Migration**

Run: `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > /dev/null` to confirm that the tooling works. Then write `prisma/migrations/20261015000000_passkeys/migration.sql` by hand. Compare it against the output of `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script --shadow-database-url "$SHADOW_DATABASE_URL"` if a shadow DB is available; otherwise copy the shape of an existing migration:

```sql
CREATE TABLE "Passkey" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "name" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Passkey_credentialId_key" ON "Passkey"("credentialId");
CREATE INDEX "Passkey_userId_idx" ON "Passkey"("userId");
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WebAuthnChallenge" (
    "id" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "userId" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebAuthnChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WebAuthnChallenge_expiresAt_idx" ON "WebAuthnChallenge"("expiresAt");
ALTER TABLE "WebAuthnChallenge" ADD CONSTRAINT "WebAuthnChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Then run `npx prisma generate` and `npx prisma migrate deploy` against the local DB (`.claude.local.md` has the URL).

- [ ] **Step 4: Failing tests** — `__tests__/lib/webauthn.test.ts`

```ts
/** @jest-environment node */
jest.mock("server-only", () => ({}))
jest.mock("@/lib/prisma", () => ({
  prisma: { webAuthnChallenge: { create: jest.fn(), delete: jest.fn(), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) } },
}))
import { prisma } from "@/lib/prisma"
import { getRelyingParty, createChallenge, consumeChallenge, normalisePasskeyName } from "@/lib/webauthn"

const ch = prisma.webAuthnChallenge as unknown as Record<string, jest.Mock>
const OLD = process.env.AUTH_URL
afterEach(() => { process.env.AUTH_URL = OLD; jest.clearAllMocks() })

describe("getRelyingParty", () => {
  it("derives rpID + origin from AUTH_URL", () => {
    process.env.AUTH_URL = "https://crm.example.org/some/path"
    expect(getRelyingParty()).toEqual({ rpID: "crm.example.org", origin: "https://crm.example.org" })
  })
  it("allows http on loopback", () => {
    process.env.AUTH_URL = "http://localhost:3000"
    expect(getRelyingParty()).toEqual({ rpID: "localhost", origin: "http://localhost:3000" })
  })
  it("disables on plain http public host", () => {
    process.env.AUTH_URL = "http://crm.example.org"
    expect(getRelyingParty()).toBeNull()
  })
  it("disables when missing or unparseable", () => {
    delete process.env.AUTH_URL
    expect(getRelyingParty()).toBeNull()
    process.env.AUTH_URL = "not a url"
    expect(getRelyingParty()).toBeNull()
  })
})

describe("challenges", () => {
  it("creates with TTL and sweeps expired rows", async () => {
    ch.create.mockResolvedValue({ id: "c1" })
    await expect(createChallenge("abc", "login", null)).resolves.toBe("c1")
    expect(ch.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lte: expect.any(Date) } } })
    const data = ch.create.mock.calls[0][0].data
    expect(data).toMatchObject({ challenge: "abc", purpose: "login", userId: null })
    expect(data.expiresAt.getTime() - Date.now()).toBeGreaterThan(4 * 60_000)
  })
  it("consume returns challenge once, valid purpose/user/expiry", async () => {
    ch.delete.mockResolvedValue({ challenge: "abc", purpose: "register", userId: 7, expiresAt: new Date(Date.now() + 60_000) })
    await expect(consumeChallenge("c1", "register", 7)).resolves.toBe("abc")
    expect(ch.delete).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1" } }))
  })
  it("consume rejects wrong purpose, wrong user, expired, missing, bad id", async () => {
    const future = new Date(Date.now() + 60_000)
    ch.delete.mockResolvedValueOnce({ challenge: "a", purpose: "login", userId: null, expiresAt: future })
    await expect(consumeChallenge("c1", "register", 7)).resolves.toBeNull()
    ch.delete.mockResolvedValueOnce({ challenge: "a", purpose: "register", userId: 8, expiresAt: future })
    await expect(consumeChallenge("c1", "register", 7)).resolves.toBeNull()
    ch.delete.mockResolvedValueOnce({ challenge: "a", purpose: "login", userId: null, expiresAt: new Date(Date.now() - 1) })
    await expect(consumeChallenge("c1", "login", null)).resolves.toBeNull()
    ch.delete.mockRejectedValueOnce(Object.assign(new Error("gone"), { code: "P2025" }))
    await expect(consumeChallenge("c1", "login", null)).resolves.toBeNull()
    await expect(consumeChallenge(42, "login", null)).resolves.toBeNull()
    await expect(consumeChallenge("x".repeat(65), "login", null)).resolves.toBeNull()
  })
})

describe("normalisePasskeyName", () => {
  it("trims and bounds", () => {
    expect(normalisePasskeyName("  My phone ")).toBe("My phone")
    expect(normalisePasskeyName("")).toBeNull()
    expect(normalisePasskeyName("x".repeat(51))).toBeNull()
    expect(normalisePasskeyName(5)).toBeNull()
  })
})
```

- [ ] **Step 5: Run — expect FAIL** (module not found)

Run: `npx jest __tests__/lib/webauthn.test.ts`

- [ ] **Step 6: Implement** `src/lib/webauthn.ts`

```ts
import "server-only"
import { prisma } from "@/lib/prisma"

export type RelyingParty = { rpID: string; origin: string }
export type ChallengePurpose = "register" | "login"

export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60_000
export const MAX_PASSKEYS_PER_USER = 10

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

// The RP ID is the domain a passkey is bound to. Derive it from AUTH_URL so it is
// the one stable public origin of this deployment — a self-hoster who moves
// domain loses their registered passkeys (documented in docs/self-hosting.md).
// Browsers only allow WebAuthn on https or loopback, so anything else disables
// passkeys rather than offering a button that can never work.
export function getRelyingParty(): RelyingParty | null {
  const raw = process.env.AUTH_URL
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null
  return { rpID: url.hostname, origin: url.origin }
}

export async function createChallenge(challenge: string, purpose: ChallengePurpose, userId: number | null): Promise<string> {
  // Opportunistic sweep keeps the table tiny without a cron; indexed on expiresAt.
  await prisma.webAuthnChallenge.deleteMany({ where: { expiresAt: { lte: new Date() } } })
  const row = await prisma.webAuthnChallenge.create({
    data: { challenge, purpose, userId, expiresAt: new Date(Date.now() + PASSKEY_CHALLENGE_TTL_MS) },
    select: { id: true },
  })
  return row.id
}

// Single-use: the delete is the boundary — of two concurrent requests presenting
// the same id, only one gets the row back. Validate AFTER deleting so a
// wrong-purpose/expired probe still burns the challenge.
export async function consumeChallenge(id: unknown, purpose: ChallengePurpose, userId: number | null): Promise<string | null> {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return null
  let row: { challenge: string; purpose: string; userId: number | null; expiresAt: Date }
  try {
    row = await prisma.webAuthnChallenge.delete({
      where: { id },
      select: { challenge: true, purpose: true, userId: true, expiresAt: true },
    })
  } catch (e) {
    if ((e as { code?: unknown })?.code === "P2025") return null
    throw e
  }
  if (row.purpose !== purpose || row.userId !== userId || row.expiresAt <= new Date()) return null
  return row.challenge
}

export function normalisePasskeyName(name: unknown): string | null {
  if (typeof name !== "string") return null
  const n = name.trim()
  return n.length >= 1 && n.length <= 50 ? n : null
}
```


- [ ] **Step 7: Run — expect PASS**; `npx tsc --noEmit`

- [ ] **Step 8: Commit** — `feat(auth): passkey schema + webauthn helpers`

---

### Task 2: Passkey management actions

**Files:**
- Create: `src/lib/actions/passkey.ts`
- Test: `__tests__/actions/passkey.test.ts`

**Interfaces — Consumes:** Task 1 exports. **Produces:**
```ts
export type PasskeySummary = { id: string; name: string; createdAt: Date; lastUsedAt: Date | null; backedUp: boolean }
export type PasskeyStatus = { available: boolean; passkeys: PasskeySummary[] }
export async function getPasskeyStatus(): Promise<PasskeyStatus>
export async function startPasskeyRegistration(password: string): Promise<{ error: string } | { challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>
export async function finishPasskeyRegistration(challengeId: string, response: unknown, name: string): Promise<{ error: string } | { success: true }>
export async function removePasskey(id: string): Promise<{ error: string } | { success: true }>
export async function startPasskeyLogin(): Promise<{ error: string } | { challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>
```

Behaviour:
- `startPasskeyRegistration(password)`: demo guard → session user → RP or "not available" error → rate limit `passkey:manage:<userId>` 5/15 min → **re-verify the password** with bcrypt `compare` against `user.passwordHash`. This stops a stolen session from planting a persistent passkey. A wrong password returns `{ error: "Incorrect password" }` and does not touch the lockout counters, matching the TOTP management actions. Then: count ≥ `MAX_PASSKEYS_PER_USER` → error. Then `generateRegistrationOptions({ rpName: await getChurchName(), rpID, userName: user.email, userDisplayName: user.name, userID: new TextEncoder().encode(String(userId)), attestationType: "none", excludeCredentials: existing.map(p => ({ id: p.credentialId, transports: p.transports })), authenticatorSelection: { residentKey: "required", userVerification: "required" } })` → `createChallenge(options.challenge, "register", userId)`.
- `finishPasskeyRegistration`: demo guard → session → RP → `normalisePasskeyName` → `consumeChallenge(challengeId, "register", userId)` → `verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true })` inside try/catch (throws on malformed input → `{ error: "Passkey could not be verified" }`) → `!verified` gives the same error → re-check the count cap → `prisma.passkey.create({ data: { userId, credentialId: credential.id, publicKey: Buffer.from(credential.publicKey), counter: BigInt(credential.counter), transports: credential.transports ?? [], name, backedUp: registrationInfo.credentialBackedUp } })`. P2002 → "This passkey is already registered". Then `logAudit(userId, "PASSKEY_REGISTERED", "User", userId, { passkeyId })`, send the security notice email (best-effort), and `revalidatePath("/account")`.
- `removePasskey(id)`: demo guard → session → id bounded (string, 1–64) → `deleteMany({ where: { id, userId } })` → count 0 → `{ error: "Passkey not found" }` → audit `PASSKEY_REMOVED` → notice → revalidate.
- `startPasskeyLogin()`: public (no session). RP missing → error. `dbRateLimit("passkey:login:ip:<ip ?? unknown>", 10, 60_000)`, skipped under `E2E_ALLOW_TEST_OVERRIDES` like `authorizeCredentials`, with ip from `auditIpFromHeaders(await headers())`. Then `generateAuthenticationOptions({ rpID, userVerification: "required", allowCredentials: [] })` → `createChallenge(options.challenge, "login", null)`. Demo mode: return `{ error: "Passkeys are not available in the demo" }`.
- `getPasskeyStatus()`: `{ available: getRelyingParty() !== null, passkeys }` (session user, `orderBy createdAt asc`, select summary fields). No session → `{ available: false, passkeys: [] }`.
- Notice email helper `notifyPasskeyChange(userId, to, added: boolean, name)`: copy the shape of `notifyTotpChange` in `src/lib/actions/totp.ts`. Subject: `Passkey added — <church>` / `Passkey removed — <church>`. Escape the name with the same `escapeHtml`.

- [ ] **Step 1: Failing tests** — `__tests__/actions/passkey.test.ts`. Copy the mock scaffolding from `__tests__/actions/totp.test.ts` (auth, prisma, audit, dbRateLimit, email, churchSettings/emailTemplateStore, next/cache, next/headers, demoMode). Add:

```ts
jest.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: jest.fn().mockResolvedValue({ challenge: "reg-ch" }),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn().mockResolvedValue({ challenge: "auth-ch" }),
}))
jest.mock("@/lib/webauthn", () => ({
  ...jest.requireActual("@/lib/webauthn"),
  getRelyingParty: jest.fn(() => ({ rpID: "crm.example.org", origin: "https://crm.example.org" })),
  createChallenge: jest.fn().mockResolvedValue("ch1"),
  consumeChallenge: jest.fn(),
}))
```

(`requireActual` loads `server-only`; mock it with `jest.mock("server-only", () => ({}))`.)

Cases (one `it` each):
1. `startPasskeyRegistration` unauthenticated → `{ error: "Unauthorized" }`.
2. RP null → `{ error: "Passkeys are not available on this server" }`.
3. Wrong password → `{ error: "Incorrect password" }`, `generateRegistrationOptions` not called, `prisma.user.update` not called.
4. Rate limited (`dbRateLimit` → false) → rate-limit error, no compare.
5. 10 existing passkeys → `{ error: "You can register up to 10 passkeys" }`.
6. Happy path → returns `{ challengeId: "ch1", options }`; `createChallenge` called with `("reg-ch", "register", 7)`; options requested with `authenticatorSelection: { residentKey: "required", userVerification: "required" }` and `excludeCredentials` mapped from existing rows.
7. `finishPasskeyRegistration` with challenge consumed/invalid (`consumeChallenge` → null) → `{ error: "Passkey request expired — try again" }`, verify not called.
8. Verify throws → `{ error: "Passkey could not be verified" }`.
9. Verify `{ verified: false }` → same error.
10. Verify requires UV: assert `verifyRegistrationResponse` called with `requireUserVerification: true`, `expectedOrigin`, `expectedRPID`, `expectedChallenge` = consumed value.
11. Happy path → `passkey.create` data matches (`counter: BigInt(0)`, `publicKey` Buffer, name trimmed), `logAudit(7, "PASSKEY_REGISTERED", …)` called.
12. Duplicate credential (create rejects P2002) → `{ error: "This passkey is already registered" }`.
13. Bad name (`""`) → `{ error: "Name must be 1–50 characters" }` before consuming.
14. `removePasskey` scopes `deleteMany` to `{ id, userId: 7 }`; count 0 → not found; success audits `PASSKEY_REMOVED`.
15. `startPasskeyLogin` → `createChallenge("auth-ch", "login", null)`; rate limited → `{ error: "Too many attempts. Try again shortly." }`; demo mode → error.
16. Demo mode blocks start/finish/remove.

- [ ] **Step 2: Run — FAIL.** `npx jest __tests__/actions/passkey.test.ts`
- [ ] **Step 3: Implement** `src/lib/actions/passkey.ts` (`"use server"`) per the behaviour above. Constants:
```ts
const UNAUTHORIZED = { error: "Unauthorized" } as const
const UNAVAILABLE = { error: "Passkeys are not available on this server" } as const
const EXPIRED = { error: "Passkey request expired — try again" } as const
const NOT_VERIFIED = { error: "Passkey could not be verified" } as const
const RATE_LIMITED = { error: "Too many attempts. Try again in 15 minutes." } as const
```
Use `sessionUserId()` exactly as in `totp.ts` (via `actorId`).
- [ ] **Step 4: Run — PASS**; `npx tsc --noEmit`
- [ ] **Step 5: Commit** — `feat(auth): passkey registration + management actions`

---

### Task 3: Passkey login branch in `authorizeCredentials`

**Files:**
- Modify: `src/auth.ts` (credential type union + Credentials field list + new branch placed right after the `mode === "demo"` block)
- Test: `__tests__/lib/auth.test.ts` (new `describe("passkey mode")`)

**Interfaces — Consumes:** `consumeChallenge`, `getRelyingParty` (Task 1). The client sends `signIn("credentials", { email: "passkey", mode: "passkey", challengeId, assertion: JSON.stringify(authResp), remember, redirect: false })`. `email` is a placeholder, because `authorizeCredentials` returns early when email is missing. Don't remove that guard; the placeholder is never used for lookup.

Branch:
```ts
  if (credentials.mode === "passkey") {
    // Usernameless passkey login: the authenticator proves possession of the
    // private key AND (userVerification "required") a local biometric/PIN, so
    // it stands in for both the password and the second factor. The user is
    // resolved from the credential, never from the submitted email.
    const rp = getRelyingParty()
    if (!rp || typeof credentials.assertion !== "string" || credentials.assertion.length > 16_384) return null
    const expectedChallenge = await consumeChallenge(credentials.challengeId, "login", null)
    if (!expectedChallenge) return null
    let response: AuthenticationResponseJSON
    try {
      response = JSON.parse(credentials.assertion) as AuthenticationResponseJSON
    } catch {
      return null
    }
    if (typeof response?.id !== "string") return null
    const passkey = await prisma.passkey.findUnique({ where: { credentialId: response.id }, include: { user: true } })
    if (!passkey) {
      logger.warn("credential login rejected", { reason: "passkey_unknown", ipPresent: !!ip })
      return null
    }
    const user = passkey.user
    if (user.archivedAt || (isDemoMode() && isDemoEmail(user.email))) return null
    // A password- or OTP-locked account stays locked: the lock is the admin's
    // and the user's signal that something is wrong with this account.
    if ((user.lockedUntil && user.lockedUntil > new Date()) || (user.otpLockedUntil && user.otpLockedUntil > new Date())) {
      throw new AccountLocked()
    }
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(passkey.publicKey),
          counter: Number(passkey.counter),
          transports: passkey.transports as AuthenticatorTransportFuture[],
        },
      })
    } catch {
      verification = { verified: false } as typeof verification
    }
    if (!verification.verified) {
      void logAudit(user.id, "USER_LOGIN_FAILED", "User", user.id, { reason: "passkey_invalid" }, ip)
      return null
    }
    // Compare-and-swap on the counter just read: a cloned authenticator racing
    // the real one can't both win. The library already rejected a non-increasing
    // counter (unless both are 0, i.e. the authenticator doesn't count).
    const { count } = await prisma.passkey.updateMany({
      where: { id: passkey.id, counter: passkey.counter },
      data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
    })
    if (count === 0) {
      void logAudit(user.id, "USER_LOGIN_FAILED", "User", user.id, { reason: "passkey_counter_race" }, ip)
      return null
    }
    void logAudit(user.id, "USER_LOGIN", "User", user.id, { via: "passkey" }, ip)
    // No device-trust grant: a passkey needs no OTP to skip.
    return { id: String(user.id), name: user.name, email: user.email, role: user.role, remember: credentials.remember === "true" }
  }
```
Imports: `verifyAuthenticationResponse` from `@simplewebauthn/server`; types `AuthenticationResponseJSON`, `AuthenticatorTransportFuture` from `@simplewebauthn/server` (re-exported types; otherwise from `@simplewebauthn/types`, but check `node_modules/@simplewebauthn/server/esm/index.d.ts` first). `getRelyingParty`, `consumeChallenge` come from `@/lib/webauthn`. Add `"challengeId" | "assertion"` to the credentials key union and `challengeId`/`assertion` entries to `Credentials({ credentials })`.

Also check: `src/lib/webauthn.ts` imports `server-only`. `auth.ts` is server-side, but jest needs `jest.mock("server-only", () => ({}))` in `auth.test.ts` (or mock `@/lib/webauthn` entirely; prefer mocking it).

- [ ] **Step 1: Failing tests** in `__tests__/lib/auth.test.ts`. Add `passkey: { findUnique: jest.fn(), updateMany: jest.fn() }` to the prisma mock, plus:
```ts
jest.mock("@simplewebauthn/server", () => ({ verifyAuthenticationResponse: jest.fn() }))
jest.mock("@/lib/webauthn", () => ({
  getRelyingParty: jest.fn(() => ({ rpID: "crm.example.org", origin: "https://crm.example.org" })),
  consumeChallenge: jest.fn(),
}))
```
Cases:
1. Consumed/invalid challenge → null, no passkey lookup.
2. Malformed JSON / oversized assertion → null.
3. Unknown credential → null.
4. Archived user → null; locked user → throws `AccountLocked` (assert `code`).
5. Verify returns `{ verified: false }` → null + audit `USER_LOGIN_FAILED` `{ reason: "passkey_invalid" }`; verify throws → null.
6. Verify called with `requireUserVerification: true`, origin/rpID, and `credential.counter` as a number.
7. Counter CAS lost (`updateMany` → `{ count: 0 }`) → null.
8. Happy path → returns `{ id: "7", role, remember: true }` when `remember: "true"`, no `deviceTrustGrant`, audit `USER_LOGIN` `{ via: "passkey" }`, `updateMany` where `{ id, counter: 5n }` data `counter: 6n`.
9. Demo mode + demo email user → null.
10. RP null → null.

- [ ] **Step 2: Run — FAIL.** `npx jest __tests__/lib/auth.test.ts`
- [ ] **Step 3: Implement** the branch above.
- [ ] **Step 4: Run — PASS** (whole file, so existing tests still pass); `npx tsc --noEmit`
- [ ] **Step 5: Commit** — `feat(auth): passkey sign-in via credentials provider`

---

### Task 4: Admin revoke

**Files:**
- Modify: `src/lib/actions/user.ts` (after `resetUserTotp`)
- Create: `src/components/users/RevokePasskeysButton.tsx` (copy `ResetTotpButton.tsx`; change the label to "Revoke passkeys", the confirm text to "Remove every passkey for this user and sign them out?" and the action call)
- Modify: `src/app/(dashboard)/users/page.tsx` (both places `ResetTotpButton` renders — lines ~115 and ~170; show when `u._count.passkeys > 0`, so add `_count: { select: { passkeys: true } }` to the users query select)
- Test: the existing `resetUserTotp` test file (`grep -rln resetUserTotp __tests__`)

```ts
export async function revokeUserPasskeys(id: number): Promise<ActionResult> {
  const demo = assertNotDemo()
  if (demo) return demo
  const session = await auth()
  if (!canManageUsers(session?.user?.role)) return { error: "Unauthorized" }
  if (!isValidPgId(id)) return { error: "User not found" }
  if (actorId(session) === id) return { error: "Use My Account to manage your own passkeys" }

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, archivedAt: true } })
  if (!target || target.archivedAt) return { error: "User not found" }
  if (!canAssignRole(session?.user?.role, target.role)) return { error: "Unauthorized" }

  try {
    // Lost/stolen device: drop every passkey and kill live sessions (the device
    // may already be signed in). Password + OTP/TOTP still work.
    await prisma.$transaction([
      prisma.user.update({ where: { id, ...assignableTargetWhere(session?.user?.role) }, data: { sessionsValidFrom: new Date() } }),
      prisma.passkey.deleteMany({ where: { userId: id } }),
    ])
  } catch (e) {
    if ((e as { code?: unknown })?.code === "P2025") return { error: "Unauthorized" }
    throw e
  }
  await logAudit(actorId(session), "PASSKEYS_REVOKED", "User", id, { targetUserId: id })
  revalidatePath("/users")
}
```

- [ ] **Step 1: Failing tests:** non-admin → Unauthorized; self → error; archived → not found; role above actor → Unauthorized; happy path → `$transaction` called, `passkey.deleteMany({ where: { userId: id } })`, audit `PASSKEYS_REVOKED`.
- [ ] **Step 2: Run — FAIL.** **Step 3: Implement** the action + button + page wiring. **Step 4: Run — PASS**, `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(users): admin can revoke a user's passkeys`

---

### Task 5: UI — account settings + login button

**Files:**
- Create: `src/components/account/PasskeySettings.tsx` (client)
- Modify: `src/app/(dashboard)/account/page.tsx`
- Modify: `src/components/auth/LoginForm.tsx`
- Test: `src/components/account/__tests__/PasskeySettings.test.tsx` (follow the sibling tests in that dir)

`PasskeySettings({ status }: { status: PasskeyStatus })`:
- `!status.available` → muted text: "Passkeys need this site to be served over HTTPS." Nothing else.
- List rows: name, "Added {date}", "Last used {date | never}", a "Synced" badge when `backedUp`, and a Remove button (confirm → `removePasskey(id)` → `router.refresh()`).
- "Add a passkey" opens an inline form: name input (default: "Passkey"; maxLength 50) and current password input → `startPasskeyRegistration(password)` → `startRegistration({ optionsJSON: res.options })` from `@simplewebauthn/browser` → `finishPasskeyRegistration(res.challengeId, attResp, name)` → refresh. Catch `NotAllowedError` (the user cancelled) → message "Passkey setup was cancelled." Show any other `{ error }` inline.
- Hide the add button at 10 passkeys.
- Copy the classes/components from `TotpSettings.tsx` (Button, Input, error text styling) for visual consistency.

Account page: add `getPasskeyStatus()` to the `Promise.all`, and a section **above** "Authenticator app":
```tsx
<h3 className="text-sm font-medium text-muted-foreground mt-6 mb-2">Passkeys</h3>
<p className="text-sm text-muted-foreground mb-4">
  Sign in with your fingerprint, face or device PIN instead of a password and code. Your password
  still works if you don&apos;t have the device with you.
</p>
<PasskeySettings status={passkeyStatus} />
```

LoginForm (password step only): below the main submit, a divider and an outline button "Sign in with a passkey". It renders only when `browserSupportsWebAuthn()` is true; check this in `useEffect` and keep the result in state to avoid a hydration mismatch. Handler:
```ts
async function handlePasskey() {
  setError(""); setLoading(true)
  try {
    const start = await startPasskeyLogin()
    if ("error" in start) { setError(start.error); return }
    const assertion = await startAuthentication({ optionsJSON: start.options })
    const result = await signIn("credentials", {
      email: "passkey", mode: "passkey", challengeId: start.challengeId,
      assertion: JSON.stringify(assertion), remember: remember ? "true" : "false", redirect: false,
    })
    // reuse the existing success / AccountLocked handling from the password submit
  } catch (e) {
    setError(e instanceof Error && e.name === "NotAllowedError" ? "Passkey sign-in was cancelled." : "Passkey sign-in failed. Use your password instead.")
  } finally { setLoading(false) }
}
```
Read `LoginForm.tsx` lines ~95–135 to find how success (redirect/router push) and `AccountLocked` are handled. Factor that into a small local helper if needed, so both paths share it. Don't duplicate it. A null result (generic failure) → "Passkey not recognised. Use your password instead." Hide the button when `startPasskeyLogin` reports unavailable: call it lazily only on click; don't prefetch.

- [ ] **Step 1: Failing component tests** (PasskeySettings): unavailable message; list renders names; remove calls action with the id; add flow calls start → browser `startRegistration` (mocked) → finish with the name; a cancelled ceremony shows the cancel message.
- [ ] **Step 2: Run — FAIL.** **Step 3: Implement.** **Step 4: Run — PASS**, plus `npx jest src/components/auth` (existing LoginForm tests still pass), `npx tsc --noEmit`, `npm run lint`.
- [ ] **Step 5: Commit** — `feat(account): passkey settings + passkey login button`

---

### Task 6: Docs + rules

**Files:** `docs/environment.md`, `docs/self-hosting.md`, `website/` user docs if a sign-in/account page exists (`grep -rli "authenticator" website/docs`), `.claude/rules/auth.md` (local only, gitignored — edit, never `git add -f`).

- `docs/environment.md` → under `AUTH_URL`: "Also the passkey relying party: its hostname is the RP ID and its origin the expected WebAuthn origin. Passkeys are disabled unless AUTH_URL is https (or http on localhost)."
- `docs/self-hosting.md` → a "Passkeys" subsection: needs HTTPS and a stable domain. **Changing the domain invalidates every registered passkey** (users fall back to password + code and re-register). Admin can revoke a user's passkeys on /users.
- `website` user doc (if an account/2FA page exists): how to add/remove a passkey and sign in with one; the password still works.
- `.claude/rules/auth.md` → one bullet: **Passkeys (opt-in)**: `src/lib/webauthn.ts` (RP from AUTH_URL, single-use `WebAuthnChallenge` consumed by delete, 5-min TTL); `src/lib/actions/passkey.ts` (session-user only; registration re-verifies the password; `passkey:manage:<userId>` 5/15 min; `startPasskeyLogin` public, `passkey:login:ip:<ip>` 10/min); `authorizeCredentials` `mode: "passkey"` resolves the user from credentialId, requires UV, honours `lockedUntil`/`otpLockedUntil`, counter CAS, no device-trust grant; admin `revokeUserPasskeys` in `user.ts` also stamps `sessionsValidFrom`.

- [ ] Commit — `docs: passkey sign-in`

---

### Task 7: Verify + PR

- [ ] `npx jest __tests__/lib/webauthn.test.ts __tests__/actions/passkey.test.ts __tests__/lib/auth.test.ts <user action test> src/components/account src/components/auth`
- [ ] `npx tsc --noEmit && npm run lint`
- [ ] Manual check on `http://localhost:3000` (Chrome DevTools → WebAuthn → virtual authenticator with UV + resident keys): register → sign out → passkey sign-in → remove.
- [ ] Review: this is auth, so run `/code-review high` (one review path).
- [ ] Push and open the PR (`Closes` nothing — OSS-22 is a draft card; reference OSS-22 in the body). Add the PR to the board.
