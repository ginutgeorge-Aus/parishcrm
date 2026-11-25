import { cache } from "react"
import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { compare, hash } from "bcryptjs"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { UserRole } from "@/lib/generated/prisma/enums"
import { authConfig } from "@/auth.config"
import { notifyFailedLogin } from "@/lib/notifications"
import { generateOtp, hashOtp, sendOtpEmail } from "@/lib/otp"
import { logAudit } from "@/lib/audit"
import { parseTrustedDeviceCookie, hashDeviceToken, generateDeviceToken, DEVICE_TRUST_GRANT_PREFIX, DEVICE_TRUST_GRANT_TTL_MS } from "@/lib/trustedDevice"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { logger } from "@/lib/logger"
import { resolveClientIp } from "@/lib/clientIp"
import { verifySecondFactor } from "@/lib/totpVerify"
import { isDemoMode, isDemoEmail } from "@/lib/demoMode"
import { findUserByEmailInsensitive, normalizeEmail } from "@/lib/userLookup"
import { REMEMBERED_IDLE_MINUTES, REMEMBERED_MAX_DAYS } from "@/lib/sessionWindows"
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server"
import { consumeChallenge, getRelyingParty } from "@/lib/webauthn"

// bcrypt hash (cost 12, matching the real hash cost used at
// signup/reset — src/lib/actions/auth.ts, src/lib/actions/user.ts) for a dummy
// compare when the submitted email doesn't exist. Running this on the
// "unknown user" fast path equalises response time with the real ~100ms
// bcrypt.compare below, closing the email-enumeration timing oracle (an
// unknown email otherwise returns near-instantly, a known one doesn't).
// Generated at module load from random bytes (never a literal in source, so
// no credential-shaped string for secret scanners to flag); kicked off eagerly
// so the first unknown-email login doesn't also pay the hash cost.
const DUMMY_PASSWORD_HASH = hash(randomBytes(32).toString("hex"), 12)

/** The password lock or the OTP lock is active: the login form shows the 15-minute lockout message. */
export class AccountLocked extends CredentialsSignin {
  code = "AccountLocked"
}

/** The password was correct and a fresh email code was sent: the login form moves to the code step. */
export class OtpSent extends CredentialsSignin {
  code = "OtpSent"
}

/**
 * A code was issued less than 30 seconds ago, so no new one is sent. Judged from the stored `otpExpiresAt`
 * (a recent issuance attempt), not from confirmed email delivery: if sending and the rollback both failed,
 * the expiry stays set and an immediate retry can still get this error.
 */
class OtpCooldown extends CredentialsSignin {
  code = "OtpCooldown"
}

/**
 * The password was correct but the verification code could not be emailed. Kept distinct from
 * OtpSent so the UI shows a delivery error and lets the user retry immediately, instead of prompting
 * for a code that never arrived.
 */
export class OtpDeliveryFailed extends CredentialsSignin {
  code = "OtpDeliveryFailed"
}

/**
 * The password was correct and the user has an authenticator enrolled: the UI should ask for the app
 * code (or a backup code). No email is sent.
 */
export class TotpRequired extends CredentialsSignin {
  code = "TotpRequired"
}

/**
 * Same as TotpRequired, but the user still holds unused backup codes, so the server will refuse the
 * email-code fallback (AUD-1-18). The login form uses the distinct code to hide that button instead
 * of leaving a dead end. Only reachable after the password was verified; revealing the backup-code
 * state to the password holder is accepted by design (#776).
 */
class TotpRequiredWithBackup extends TotpRequired {
  code = "TotpRequiredBackup"
}

/**
 * Resolves the request's client IP once per login attempt: `ip` is the validated address for audit
 * logging and OTP/lockout records (CLIENT_IP_HEADER if set, else the rightmost x-forwarded-for
 * entry; see src/lib/clientIp.ts and docs/environment.md), `key` the rate-limit bucket.
 * @param request the NextAuth request, if any
 * @returns the validated IP (or undefined) and the bucket key ("unknown" when no request)
 */
function clientIpFrom(request?: Request): { ip: string | undefined; key: string } {
  return request ? resolveClientIp(request.headers) : { ip: undefined, key: "unknown" }
}

type DbUser = NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>

type AttemptField = "failedLoginAttempts" | "failedOtpAttempts"

const LOCK_FIELD = { failedLoginAttempts: "lockedUntil", failedOtpAttempts: "otpLockedUntil" } as const
const LOCK_MS = 15 * 60 * 1000

type Claim = { attempts: number; lockedUntil: Date | null }

/**
 * Claims one guess slot BEFORE the secret is compared. The `lt: 5` filter makes the claim atomic,
 * so N concurrent guesses can never produce more than 5 compares (a read-then-increment lets them
 * all pass the check first). The filter also needs the lock to be null or expired, so a request
 * that read the user before a lock was written cannot guess during it. When the claim is the 5th,
 * the lock is written in the SAME transaction (counter reset to 0 with it), so a crash can never
 * leave counter 5 with no lock. The claimed attempt stays counted on failure; success resets it.
 * @param userId the account being guessed against
 * @param field which counter to claim from
 * @param healed true on the single retry after healing a stuck counter (stops recursion)
 * @returns the counter after the claim plus the lock this claim set (if any), or null when no slot is free or the account is locked
 */
async function claimAttempt(userId: number, field: AttemptField, healed = false): Promise<Claim | null> {
  const lockField = LOCK_FIELD[field]
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: {
          id: userId,
          [field]: { lt: 5 },
          OR: [{ [lockField]: null }, { [lockField]: { lte: new Date() } }],
        },
        data: { [field]: { increment: 1 } },
        select: { [field]: true },
      })
      const attempts = (row as Partial<Record<AttemptField, unknown>> | null)?.[field]
      if (typeof attempts !== "number") throw new Error(`claimAttempt: ${field} counter is not a number`)
      if (attempts < 5) return { attempts, lockedUntil: null }
      const lockedUntil = new Date(Date.now() + LOCK_MS)
      // Reset the counter as we lock, else one wrong guess after expiry re-locks on the stale counter.
      await tx.user.update({ where: { id: userId }, data: { [lockField]: lockedUntil, [field]: 0 } })
      return { attempts, lockedUntil }
    })
  } catch (err) {
    if ((err as { code?: string })?.code !== "P2025") throw err
    if (healed) {
      logger.warn("login attempt claim rejected", { reason: "claim_rejected", field, healed: true })
      return null
    }
    // Heal a row stuck at counter >= 5 with no live lock (left by the pre-claim code, which wrote the
    // lock in a separate step): the `lt: 5` claim never matches it, so the account would stay locked
    // with no expiry. Live claims never leave this state (the 5th zeroes the counter), so a row the
    // heal matches gets exactly one fresh claim.
    const heal = await prisma.user.updateMany({
      where: { id: userId, [field]: { gte: 5 }, OR: [{ [lockField]: null }, { [lockField]: { lte: new Date() } }] },
      data: { [field]: 0 },
    })
    if (heal?.count === 1) return claimAttempt(userId, field, true)
    logger.warn("login attempt claim rejected", { reason: "claim_rejected", field, healed: false })
    return null
  }
}

/**
 * Undoes one claimed guess slot for a failure that was not a wrong guess (server fault, or a
 * correct code that lost the consume race). Best-effort: a failed write is logged, never thrown.
 * @param userId the account the claim was made against
 * @param field which counter the claim came from
 * @param claim the claim to refund
 */
async function refundAttempt(userId: number, field: AttemptField, claim: Claim): Promise<void> {
  const lockField = LOCK_FIELD[field]
  try {
    if (claim.lockedUntil) {
      // The claim was the 5th and set the lock (counter reset to 0): undo that lock, matched on
      // its exact value, and restore the 4 real failures it zeroed.
      await prisma.user.updateMany({ where: { id: userId, [lockField]: claim.lockedUntil }, data: { [lockField]: null, [field]: 4 } })
    } else {
      await prisma.user.updateMany({ where: { id: userId, [field]: { gt: 0 } }, data: { [field]: { decrement: 1 } } })
    }
  } catch (err) {
    logger.warn("login attempt refund failed", { field, error: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * Handles one wrong second-factor code: audit-logs the failed login. The attempt (and the lock on
 * the 5th) was already written by `claimAttempt`.
 * @param userId the account that failed
 * @param reason short reason code for the audit log
 * @param ip client IP for the audit log, if known
 */
function recordOtpFailure(userId: number, reason: string, ip: string | undefined): void {
  void logAudit(userId, "USER_LOGIN_FAILED", "User", userId, { reason }, ip)
}

/**
 * Finishes a login after a fresh second factor (email OTP or authenticator) passed: clears the OTP
 * counters, mints a pending device-trust grant when asked, and builds the session user.
 * @param user the verified user row
 * @param remember the submitted "remember me" flag (any type; only "true" counts)
 * @param ip client IP for log context, if known
 */
async function completeSecondFactorLogin(user: DbUser, remember: unknown, ip: string | undefined) {
  // Only fresh second-factor verification (email OTP or authenticator) can grant device trust.
  // A pending row cannot bypass OTP; trustDevice exchanges it once using this session's signed ID.
  let deviceTrustGrant: string | undefined
  if (remember === "true") {
    // The OTP has already been atomically consumed above; the device-trust
    // grant is a best-effort convenience. If either write fails, log in
    // anyway without a grant (the browser just re-prompts OTP next time)
    // rather than rejecting an already-verified code.
    try {
      const now = new Date()
      await prisma.trustedDevice.deleteMany({
        where: { userId: user.id, tokenHash: { startsWith: DEVICE_TRUST_GRANT_PREFIX }, expiresAt: { lte: now } },
      })
      const grant = await prisma.trustedDevice.create({
        data: {
          userId: user.id,
          tokenHash: DEVICE_TRUST_GRANT_PREFIX + hashDeviceToken(generateDeviceToken()),
          expiresAt: new Date(now.getTime() + DEVICE_TRUST_GRANT_TTL_MS),
        },
        select: { id: true },
      })
      deviceTrustGrant = grant.id
    } catch {
      void logAudit(user.id, "USER_LOGIN", "User", user.id, { deviceTrustGrant: "failed" }, ip)
    }
  }
  void logAudit(user.id, "USER_LOGIN", "User", user.id, undefined, ip)
  return {
    ...(deviceTrustGrant ? { deviceTrustGrant } : {}),
    id: String(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    remember: remember === "true",
  }
}

/**
 * Look up a user by email and verify the password, with a dummy bcrypt compare
 * on a miss to keep timing uniform.
 * @param email trimmed email, any case (the lookup matches case-insensitively)
 * @param password submitted plaintext password
 * @param ip client IP for log context, if known
 * @returns the user on success, else null
 */
async function verifyPassword(email: string, password: string, ip: string | undefined): Promise<DbUser | null> {
  const user = await findUserByEmailInsensitive(email)
  if (!user) {
    // Burn the same bcrypt cost as the real compare below so this
    // fast path can't be timed apart from a valid-email/wrong-password path.
    await compare(password, await DUMMY_PASSWORD_HASH)
    logger.warn("credential login rejected", { reason: "no_user", ipPresent: !!ip })
    return null
  }
  // Reject a soft-deleted user (email is also tombstoned on archive).
  if (user.archivedAt) return null

  // Accepted risk (LOW): the lockout is checked before verifying the password,
  // so an unauthenticated caller can distinguish a real+locked account from an
  // unknown/unlocked one. This is inherent to surfacing "account locked" to the
  // legitimate user (the login UI shows it) and to the lockout-first ordering
  // required by the OTP step (a locked account must always surface
  // AccountLocked, even after its OTP expires). Bounded info leak, no credential
  // compromise; the per-account 5-attempt lock and per-IP throttle backstop it.
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AccountLocked()
  }

  // Claim the guess slot before the compare so concurrent guesses can't all pass the lock check.
  const claimed = await claimAttempt(user.id, "failedLoginAttempts")
  if (claimed === null) throw new AccountLocked()

  const passwordValid = await compare(password, user.passwordHash)

  if (!passwordValid) {
    notifyFailedLogin(user.email).catch((err: unknown) => {
      console.error("[notify] Failed to send failed-login alert:", err instanceof Error ? err.message : String(err))
    })
    void logAudit(user.id, "USER_LOGIN_FAILED", "User", user.id, { reason: "invalid_password" }, ip)
    logger.warn("credential login rejected", { reason: "bad_password", ipPresent: !!ip })
    return null
  }
  // Correct password clears the password-failure counter for every path, not
  // just the email-OTP one — trusted-device and DISABLE_OTP logins skip the
  // OTP write, so stale typos would otherwise accumulate into a lockout.
  // The OTP counter/lock is separate and deliberately untouched here.
  // Compare-and-swap on the value this request claimed: a concurrent wrong-password
  // increment makes this a no-op instead of being silently wiped.
  // A correct 5th password still logs in: drop the lock that claim set (matched on its exact value).
  // Every claim bumped the counter, so a non-5th claim always has a value to reset. The write is
  // retried once and is non-fatal: a correct password must not be rejected over a failed cleanup.
  const clearWhere = claimed.lockedUntil
    ? { id: user.id, lockedUntil: claimed.lockedUntil }
    : { id: user.id, failedLoginAttempts: claimed.attempts }
  const clearData = claimed.lockedUntil ? { lockedUntil: null } : { failedLoginAttempts: 0 }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await prisma.user.updateMany({ where: clearWhere, data: clearData })
      break
    } catch (err) {
      if (attempt === 2) {
        logger.warn("login attempt reset failed", { reason: "reset_failed", error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
  return user
}

/**
 * Per-IP throttle shared by both providers (the e2e exemption and its rationale are documented at
 * the call site in authorizeCredentials). Keyed on the already-resolved bucket key (IPv4 or IPv6
 * /64); requests with no valid IP share the "unknown" bucket.
 * @param client the `{ ip, key }` from one `clientIpFrom` call for this attempt
 * @param bucket rate-limit key prefix; demo one-click logins use their own
 * @param limit max attempts per minute for this bucket
 * @returns true when the attempt is allowed
 */
async function loginIpAllowed(client: { ip: string | undefined; key: string }, bucket = "login:ip", limit = 10): Promise<boolean> {
  if (process.env.E2E_ALLOW_TEST_OVERRIDES === "true") return true
  if (await dbRateLimit(`${bucket}:${client.key}`, limit, 60_000)) return true
  // Reason-coded so a valid-cred rejection (e2e flake, prod incident) is
  // diagnosable from container logs. No PII beyond the ip already logged.
  logger.warn("credential login rejected", {
    reason: "ip_rate_limited",
    ipPresent: Boolean(client.ip),
  })
  return false
}

/**
 * Usernameless passkey login (its own Credentials provider, id "passkey"): the authenticator proves
 * possession of the private key AND (userVerification "required") a local biometric/PIN, so it
 * stands in for both the password and the second factor. The user is resolved from the credential.
 * @param credentials the submitted passkey assertion fields
 * @param request the incoming request, used to derive the client IP for throttling and audit
 * @returns the session user, or null when verification or the throttle fails
 */
export async function authorizePasskey(
  credentials: Partial<Record<"challengeId" | "assertion" | "remember", unknown>>,
  request?: Request,
) {
  const client = clientIpFrom(request)
  const { ip } = client
  if (!(await loginIpAllowed(client))) return null
  const rp = getRelyingParty()
  if (!rp || typeof credentials.assertion !== "string" || credentials.assertion.length > 16_384) return null
  // Consume first: a malformed or unknown-credential attempt still burns the challenge.
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
    logger.warn("credential login rejected", { reason: "passkey_unknown", ipPresent: Boolean(ip) })
    return null
  }
  const user = passkey.user
  if (user.archivedAt || (isDemoMode() && isDemoEmail(user.email))) return null

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>> | null
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
        transports: passkey.transports,
      },
    })
  } catch {
    verification = null
  }
  if (!verification?.verified) {
    void logAudit(user.id, "USER_LOGIN_FAILED", "User", user.id, { reason: "passkey_invalid" }, ip)
    return null
  }
  // An OTP-locked account stays locked (repeated bad second-factor guesses).
  // The password lock is deliberately not checked: a passkey never uses the
  // password, and an anonymous caller can set that lock with bad guesses.
  // Checked only after the signature verifies, so a bare credential id can't
  // probe lock state.
  if (user.otpLockedUntil && user.otpLockedUntil > new Date()) {
    throw new AccountLocked()
  }

  // Compare-and-swap on the counter just read: a cloned authenticator racing the
  // real one can't both win. The library already rejected a non-increasing
  // counter (unless both are 0, i.e. the authenticator doesn't count).
  const { count } = await prisma.passkey.updateMany({
    where: { id: passkey.id, counter: passkey.counter },
    data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
  })
  if (count === 0) {
    void logAudit(user.id, "USER_LOGIN_FAILED", "User", user.id, { reason: "passkey_counter_race" }, ip)
    return null
  }
  // Like a correct password, a verified passkey clears stale typo counters. CAS on
  // the values read so a concurrent failure increment isn't silently wiped. The
  // lock timestamps are left alone — a lock already stopped us above.
  if (user.failedLoginAttempts > 0 || user.failedOtpAttempts > 0) {
    await prisma.user.updateMany({
      where: { id: user.id, failedLoginAttempts: user.failedLoginAttempts, failedOtpAttempts: user.failedOtpAttempts },
      data: { failedLoginAttempts: 0, failedOtpAttempts: 0 },
    })
  }
  void logAudit(user.id, "USER_LOGIN", "User", user.id, { via: "passkey" }, ip)
  // No device-trust grant: a passkey has no OTP step to skip.
  return { id: String(user.id), name: user.name, email: user.email, role: user.role, remember: credentials.remember === "true" }
}

/**
 * NextAuth `authorize` callback for the Credentials provider: applies the per-IP throttle, then the
 * password / OTP / backup-code / email-fallback steps with their lockouts.
 * @param credentials the submitted form fields
 * @param request the incoming request, used only to derive the client IP for throttling and audit
 * @returns the session user, or null when authentication fails or is throttled
 */
export async function authorizeCredentials(
  credentials: Partial<Record<"email" | "password" | "otp" | "mode" | "remember" | "code" | "emailFallback", unknown>>,
  request?: Request,
) {
  const client = clientIpFrom(request)
  const { ip } = client
  if (!credentials?.email) return null
  // Password, OTP and TOTP paths pass rawEmail (trimmed, case kept) to the
  // lookup, which matches it with one case-insensitive lower(email) query.
  // normalizedEmail (trimmed + lowercased) is used only for the demo checks and
  // the whitespace-only exit (after the IP throttle, so whitespace-only probes still
  // count against it; an empty string returns above, before any DB work). Lockout counters are keyed on user.id, so case/space
  // variants resolve to one account and share one counter.
  const rawEmail = String(credentials.email).trim()
  const normalizedEmail = normalizeEmail(rawEmail)

  // IP-based throttle on the whole credentials path (password + OTP
  // steps) — the only prior ceiling was the per-account 5-attempt lock, which
  // never trips a low-and-slow password spray across many different accounts
  // from one IP. Postgres-backed (dbRateLimit), so it stays correct if
  // --max-replicas is ever raised, unlike the in-memory rateLimit(). Mirrors
  // the public register route's per-IP cap (10/min) recommended by the audit.
  // No IP (e.g. a direct internal call) skips the check rather than blocking.
  // The e2e suite drives login from a single runner IP, serially,
  // dozens of times — it trips its own 10/60s throttle and every later spec's
  // loginAs is then rejected `ip_rate_limited` (the long-mistaken "auth flake").
  // Skip the throttle ONLY under E2E_ALLOW_TEST_OVERRIDES.
  // That flag is the sole e2e-vs-real-prod signal — the suite runs a genuine
  // production build — so envCheck can't reject the flag itself; it merely uses
  // it as the exemption key for DISABLE_OTP + E2E_MOCK_EMAIL. The flag already
  // unlocks disabling OTP (strictly worse than dropping a per-IP rate limit),
  // so gating the throttle on it adds no new prod exposure; the guarantee that
  // it is never set on a real deployment is operational, not enforced. Systemic
  // hardening of the flag against prod misuse is a known follow-up.
  // Keyed on the resolved bucket key (IPv4 or IPv6 /64), so a request with no
  // valid IP falls back to a shared "unknown" bucket rather than skipping the
  // throttle — matches the sibling limiters (publicFeedback.ts, membership.ts).
  // Live demo one-click login (/login role buttons). Honoured ONLY when
  // DEMO_MODE=true AND the email is on the reserved @demo.invalid domain, so a
  // real deployment that sets the flag by mistake still has no account this can
  // reach. No password, no OTP/TOTP, no trusted-device grant. Runs before the
  // 10/min password throttle with its own 120/min bucket: on Render the
  // rightmost XFF entry is an internal proxy address (10.x) shared by many
  // visitors, so the password bucket locked the demo for everyone (#95).
  if (credentials.mode === "demo") {
    if (!isDemoMode() || !isDemoEmail(normalizedEmail)) return null
    if (!(await loginIpAllowed(client, "login:demo", 120))) return null
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (!user || user.archivedAt) return null
    void logAudit(user.id, "USER_LOGIN", "User", user.id, { demo: true }, ip)
    return { id: String(user.id), name: user.name, email: user.email, role: user.role, remember: false }
  }

  if (!(await loginIpAllowed(client))) return null
  if (!normalizedEmail) return null // whitespace-only: nothing to look up

  // Live demo users have no password path (one-click login is handled above).
  if (isDemoMode() && isDemoEmail(normalizedEmail) && credentials.mode !== "demo") {
    // Shared public users: any password/OTP/TOTP attempt would bump lockout
    // counters and lock every visitor out of that role.
    return null
  }

  if (credentials.mode === "otp") {
    if (typeof credentials.otp !== "string") return null
    const otp = credentials.otp.trim()
    if (otp.length !== 6) return null

    // Prove the password in this same request (login is stateless, like the
    // totp step): without it, anyone who knows an email could burn the owner's
    // OTP guesses and lock them out, and a phished code alone would log in.
    // A wrong or missing password returns before any OTP counter is touched.
    // verifyPassword also rejects archived users and throws AccountLocked while
    // the password lock is active (a locked account can't use the OTP step to
    // bypass the password lock).
    if (typeof credentials.password !== "string" || !credentials.password) return null
    const user = await verifyPassword(rawEmail, credentials.password, ip)
    if (!user) return null

    // OTP lock checked BEFORE the expiry check: a locked account must always
    // surface AccountLocked, not silently fall through once the OTP expires.
    if (user.otpLockedUntil && user.otpLockedUntil > new Date()) {
      throw new AccountLocked()
    }

    if (!user.otpCode || !user.otpExpiresAt) return null
    if (user.otpExpiresAt < new Date()) return null

    const claimedOtp = await claimAttempt(user.id, "failedOtpAttempts")
    if (claimedOtp === null) throw new AccountLocked()
    // DB stores the HMAC of the OTP; hash the submitted code and compare.
    // Timing-safe comparison — guard against length mismatch (throws if unequal lengths)
    const storedBuf = Buffer.from(user.otpCode, "utf8")
    const inputBuf = Buffer.from(hashOtp(otp), "utf8")
    const otpValid = storedBuf.length === inputBuf.length && timingSafeEqual(storedBuf, inputBuf)

    if (!otpValid) {
      recordOtpFailure(user.id, "invalid_otp", ip)
      return null
    }

    // Atomically verify-and-consume: two concurrent requests presenting the
    // same still-valid OTP could otherwise both pass the checks above before
    // either clears it, minting two sessions from a single one-time code.
    // Conditioning the update on the exact otpCode/otpExpiresAt just
    // read means only the request that "wins" the race affects a row — a
    // concurrent request that already cleared otpCode makes this a no-op.
    // Only the OTP fields are reset here: verifyPassword above already
    // attempted to clear failedLoginAttempts (compare-and-swap, which may
    // match no row if a concurrent wrong password bumped it) and refused an
    // active password lock. Consuming the OTP must therefore leave the
    // password counter and lock alone, so a concurrent increment survives.
    const { count } = await prisma.user.updateMany({
      where: { id: user.id, otpCode: user.otpCode, otpExpiresAt: { gt: new Date() } },
      data: {
        otpCode: null,
        otpExpiresAt: null,
        failedOtpAttempts: 0,
        otpLockedUntil: null,
      },
    })
    if (count === 0) {
      // Lost the race (or expired at the instant of the write) — treat like
      // an invalid code rather than minting a second session. The code was correct, so refund the
      // claimed attempt: only wrong codes count towards the lockout.
      await refundAttempt(user.id, "failedOtpAttempts", claimedOtp)
      void logAudit(user.id, "USER_LOGIN_FAILED", "User", user.id, { reason: "invalid_otp" }, ip)
      return null
    }
    return completeSecondFactorLogin(user, credentials.remember, ip)
  }

  if (credentials.mode === "totp") {
    // Login is stateless: unlike an emailed OTP (which only exists after a
    // password check), an authenticator code is valid at any time — so this
    // step MUST re-verify the password in the same request.
    if (typeof credentials.code !== "string" || typeof credentials.password !== "string" || !credentials.password) return null
    const user = await verifyPassword(rawEmail, credentials.password, ip)
    if (!user || !user.totpEnabledAt) return null
    if (user.otpLockedUntil && user.otpLockedUntil > new Date()) throw new AccountLocked()

    const claimedTotp = await claimAttempt(user.id, "failedOtpAttempts")
    if (claimedTotp === null) throw new AccountLocked()
    const result = await verifySecondFactor(user, credentials.code, { resetLockouts: true })
    if (!result.ok) {
      // Server-side fault (unreadable stored secret), not a wrong guess: don't
      // count it towards the user's OTP lockout.
      if (result.reason === "totp_secret_unreadable") {
        await refundAttempt(user.id, "failedOtpAttempts", claimedTotp)
        void logAudit(user.id, "USER_LOGIN_FAILED", "User", user.id, { reason: result.reason }, ip)
        return null
      }
      recordOtpFailure(user.id, result.reason, ip)
      return null
    }
    if (result.via === "backup") {
      void logAudit(user.id, "BACKUP_CODE_USED", "User", user.id, { remaining: result.remaining }, ip)
    }
    return completeSecondFactorLogin(user, credentials.remember, ip)
  }

  // Password step (default)
  if (typeof credentials?.password !== "string" || !credentials.password) return null
  const user = await verifyPassword(rawEmail, credentials.password, ip)
  if (!user) return null

  // Dev-only bypass: set DISABLE_OTP=true in .env.local to skip OTP during local dev/demo.
  // Never honour it in production even if the flag leaks into the env —
  // belt-and-suspenders behind the boot-time envCheck that already rejects it.
  // The E2E suite runs a production build (`next start` forces NODE_ENV=production)
  // but sets E2E_ALLOW_TEST_OVERRIDES=true; envCheck already exempts DISABLE_OTP on
  // that same flag, so mirror it here or the suite can never pass the login step.
  if (
    process.env.DISABLE_OTP === "true" &&
    (process.env.NODE_ENV !== "production" || process.env.E2E_ALLOW_TEST_OVERRIDES === "true")
  ) {
    void logAudit(user.id, "USER_LOGIN", "User", user.id, undefined, ip)
    return { id: String(user.id), name: user.name, email: user.email, role: user.role, remember: credentials.remember === "true" }
  }

  // Trusted-device skip: if this browser carries a valid, non-expired
  // trusted-device cookie for THIS user, skip OTP entirely. The cookie is set by
  // the trustDevice action after a prior successful OTP. authorize() can only
  // READ the cookie (it can't set response cookies — that's the action's job).
  const deviceToken = parseTrustedDeviceCookie(request?.headers?.get("cookie"))
  if (deviceToken) {
    const device = await prisma.trustedDevice.findFirst({
      where: { userId: user.id, tokenHash: hashDeviceToken(deviceToken), expiresAt: { gt: new Date() } },
      select: { id: true },
    })
    if (device) {
      await prisma.trustedDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } })
      void logAudit(user.id, "USER_LOGIN", "User", user.id, undefined, ip)
      // Trusted-device controls whether OTP is skipped; the submitted `remember`
      // flag independently controls session length. Honour it here like every
      // other success path — hardcoding remember:true would grant the
      // long 7-day session even when the user left "remember me" unchecked.
      return { id: String(user.id), name: user.name, email: user.email, role: user.role, remember: credentials.remember === "true" }
    }
  }

  // OTP brute-force lockout must survive a fresh password submission — otherwise a
  // password-aware attacker resets the counter by re-submitting the password.
  if (user.otpLockedUntil && user.otpLockedUntil > new Date()) {
    throw new AccountLocked()
  }

  // Authenticator enrolled → ask for the app code instead of emailing one. The email fallback
  // ("Send email code instead") is honoured only when the user has no unused backup codes left:
  // otherwise a taken-over mailbox would skip the authenticator (audit AUD-1-18). Backup codes are
  // the recovery route; an admin can also reset the authenticator.
  // Accepted by design (PO, #776): TotpRequiredBackup tells a caller who already holds the correct
  // password whether unused backup codes remain. The login form needs it to hide a dead-end button,
  // and the password is the real secret here. The findFirst runs on every authenticator password
  // step; it is one indexed lookup, cheaper than a bcrypt compare.
  if (user.totpEnabledAt) {
    const wantsEmail = credentials.emailFallback === "true"
    const hasBackupCodes = (await prisma.backupCode.findFirst({ where: { userId: user.id, usedAt: null }, select: { id: true } })) !== null
    if (hasBackupCodes) throw new TotpRequiredWithBackup()
    if (!wantsEmail) throw new TotpRequired()
  }

  // Enforce 30-second resend cooldown: otpExpiresAt > now + 9.5 min means OTP was sent < 30s ago
  if (user.otpExpiresAt && user.otpExpiresAt > new Date(Date.now() + 9.5 * 60 * 1000)) {
    throw new OtpCooldown()
  }

  const otp = generateOtp()
  const otpHash = hashOtp(otp)
  await prisma.user.update({
    where: { id: user.id },
    data: { otpCode: otpHash, otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000) },
  })
  try {
    await sendOtpEmail(user.email, otp)
  } catch (err: unknown) {
    // Log the user id, never the plaintext email — container logs are
    // readable by anyone with log access.
    console.error("[OTP] Failed to send OTP email for user", user.id, ":", err instanceof Error ? err.message : String(err))
    // Delivery failed → roll the just-stored code back (scoped to the hash we
    // wrote, so we never clear a newer code from a concurrent attempt). Leaving
    // it set would show the OTP prompt for a code that never arrived and block
    // an immediate retry behind the resend cooldown.
    // A failed rollback must not mask the delivery failure with a raw DB error.
    // Worst case the stale code survives: the undelivered hash can't
    // be guessed, and the resend cooldown it trips lapses within 30s.
    await prisma.user
      .updateMany({
        where: { id: user.id, otpCode: otpHash },
        data: { otpCode: null, otpExpiresAt: null },
      })
      .catch((rollbackErr: unknown) => {
        console.error("[OTP] Failed to roll back undelivered OTP for user", user.id, ":", rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr))
      })
    throw new OtpDeliveryFailed()
  }
  throw new OtpSent()
}

let idleMsCache: { value: number; expires: number } | null = null
/**
 * Cached read of the configurable idle-timeout setting. The per-request jwtCallback consults this on
 * every protected request, so a 60s in-process TTL keeps it from hitting the DB each time (the
 * setting changes a few times a year). Falls back to 60 minutes on any miss/error. Concurrent
 * requests can race to refresh the cache (last write wins); the values are identical, so the worst
 * case is a few redundant reads on expiry.
 * @returns the idle window in milliseconds
 */
async function getIdleMs(): Promise<number> {
  const now = Date.now()
  if (idleMsCache && now < idleMsCache.expires) return idleMsCache.value
  let minutes = 60
  try {
    const s = await prisma.appSetting.findUnique({ where: { key: "SESSION_IDLE_TIMEOUT_MINUTES" } })
    // Only honour a positive value — 0 (or a blank) would zero the idle window
    // and invalidate every non-remembered session on its next request.
    if (s && /^\d+$/.test(s.value)) {
      const parsed = Number.parseInt(s.value, 10)
      if (parsed > 0) minutes = parsed
    }
  } catch {
    // keep the default
  }
  idleMsCache = { value: minutes * 60_000, expires: now + 60_000 }
  return idleMsCache.value
}

/**
 * NextAuth `jwt` callback. At sign-in, stamps role/id + issue/activity timestamps from the freshly
 * authorized user and drops the email claim (keeps PII out of the long-lived token). On every later
 * request, re-queries the user and invalidates the session (returns null) if the account has since
 * been deleted, was logged out / force-invalidated, or has been idle past the configured window.
 * A login lock (`lockedUntil`) is NOT a revocation signal: anonymous bad guesses set it. Otherwise
 * refreshes role + activity timestamp.
 * @param params the current token and, at sign-in only, the authorized user
 * @returns the updated token, or null to end the session
 */
export async function jwtCallback({
  token,
  user,
}: {
  token: import("next-auth/jwt").JWT
  user?: { id?: string; role?: UserRole; remember?: boolean; deviceTrustGrant?: string }
}): Promise<import("next-auth/jwt").JWT | null> {
  if (user) {
    token.role = user.role
    token.deviceTrustGrant = user.deviceTrustGrant
    token.id = user.id as string
    token.remember = (user as { remember?: boolean }).remember === true
    const now = Date.now()
    token.loginAt = now
    token.lastActivity = now
    // name stays (the user's own display name, used across the UI); email is
    // only needed server-side and is fetched from the DB there.
    delete token.email
    return token
  }
  if (token.id) {
    // A malformed id parseInt's to NaN, which Prisma rejects with an unhandled
    // validation error that crashes the JWT callback. Kill the session.
    const userId = Number.parseInt(token.id as string, 10)
    if (Number.isNaN(userId)) return null
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, sessionsValidFrom: true, archivedAt: true },
    })
    if (!dbUser) return null
    // Kill a live session the instant its user is soft-deleted.
    if (dbUser.archivedAt) return null
    // A logout / forced invalidation sets sessionsValidFrom; any token
    // issued before that instant is dead even though the JWT has not expired.
    // A token minted before this change carries no loginAt — treat that as
    // epoch 0 (always before sessionsValidFrom), so logout still kills it.
    const loginAt = token.loginAt as number | undefined
    if (dbUser.sessionsValidFrom && (loginAt ?? 0) < dbUser.sessionsValidFrom.getTime()) {
      return null
    }
    // Remember-aware session windows.
    // Non-remembered: 4h hard cap from loginAt + DB-configurable idle (default 60min).
    // Remembered: 7-day sliding idle from lastActivity, 30-day absolute cap from loginAt.
    // A token minted before this change has no lastActivity — grandfather it in
    // by stamping now (below) and enforcing from this request onward.
    const now = Date.now()
    const remember = token.remember === true
    // loginAt already declared above for the sessionsValidFrom check — reuse it.
    const lastActivity = token.lastActivity as number | undefined

    if (remember) {
      // 7-day sliding idle: a continuously-used remembered session stays alive;
      // 7 days without activity ends it. A 30-day absolute cap from loginAt stops a
      // stolen cookie used weekly from living forever (AUD-1-08).
      if (loginAt && now - loginAt > REMEMBERED_MAX_DAYS * 24 * 60 * 60 * 1000) return null
      if (lastActivity && now - lastActivity > REMEMBERED_IDLE_MINUTES * 60 * 1000) return null
    } else {
      // Non-remembered: 4h hard cap + DB-configurable idle (default 60min).
      const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
      if (loginAt && now - loginAt > FOUR_HOURS_MS) return null
      if (lastActivity && now - lastActivity > (await getIdleMs())) return null
    }
    token.lastActivity = now
    token.role = dbUser.role
    // Drop a stale email claim from any token minted before the claim was removed.
    if (token.email) delete token.email
  }
  return token
}

const nextAuth = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        otp: { label: "Code", type: "text" },
        mode: { label: "Mode", type: "text" },
        remember: { label: "Remember device", type: "text" },
        code: { label: "Authenticator or backup code", type: "text" },
        emailFallback: { label: "Email fallback", type: "text" },
      },
      authorize: authorizeCredentials,
    }),
    Credentials({
      id: "passkey",
      name: "Passkey",
      credentials: {
        challengeId: { label: "Passkey challenge", type: "text" },
        assertion: { label: "Passkey assertion", type: "text" },
        remember: { label: "Remember device", type: "text" },
      },
      authorize: authorizePasskey,
    }),
  ],
  callbacks: {
    jwt: jwtCallback,
    /**
     * Copies the role, id, pending device-trust grant and remember flag from the JWT onto the session.
     * @param params the session being built and the decoded token
     * @returns the session with the auth fields set
     */
    async session({ session, token }) {
      session.user.role = token.role as UserRole
      session.user.id = token.id as string
      session.deviceTrustGrant = token.deviceTrustGrant
      session.remember = token.remember === true
      return session
    },
  },
  // 7-day cookie TTL ceiling (was 4h). The REAL per-session lifetime is enforced
  // in jwtCallback by the `remember` claim: non-remembered tokens still die at
  // 4h hard cap + 60min idle; remembered tokens get 7-day sliding idle. The
  // hard cap now lives in jwtCallback (non-remember branch), not in maxAge.
  session: { strategy: "jwt", maxAge: 604800 },
})

export const { auth, handlers, signOut } = nextAuth

/**
 * Per-request session: wraps `auth()` in React `cache()` so the layout, the
 * page guards and any other server component in one request decode the JWT
 * (and run the jwt callback's user re-query) once. Same semantics as `auth()`.
 * Server components only; route handlers and server actions keep calling `auth()`.
 * @returns the current session, or null when signed out
 */
export const getSession = cache(() => nextAuth.auth())
