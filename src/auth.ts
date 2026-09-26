import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { compare, hash } from "bcryptjs"
import { randomBytes, timingSafeEqual } from "crypto"
import { prisma } from "@/lib/prisma"
import { UserRole } from "@/lib/generated/prisma/enums"
import { authConfig } from "@/auth.config"
import { notifyFailedLogin } from "@/lib/notifications"
import { generateOtp, hashOtp, sendOtpEmail } from "@/lib/otp"
import { logAudit } from "@/lib/audit"
import { parseTrustedDeviceCookie, hashDeviceToken, generateDeviceToken, DEVICE_TRUST_GRANT_PREFIX, DEVICE_TRUST_GRANT_TTL_MS } from "@/lib/trustedDevice"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { logger } from "@/lib/logger"
import { auditIpFromHeaders } from "@/lib/clientIp"

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

export class AccountLocked extends CredentialsSignin {
  code = "AccountLocked"
}

export class OtpSent extends CredentialsSignin {
  code = "OtpSent"
}

class OtpCooldown extends CredentialsSignin {
  code = "OtpCooldown"
}

// The password was correct but the verification code could not be emailed. Kept
// distinct from OtpSent so the UI shows a delivery error and lets the user retry
// immediately, instead of prompting for a code that never arrived.
export class OtpDeliveryFailed extends CredentialsSignin {
  code = "OtpDeliveryFailed"
}

// Real client IP for audit logging. The trusted reverse proxy appends it as the rightmost
// x-forwarded-for entry (trusted proxy — not spoofable), same convention as
// src/lib/actions/auth.ts and the public register route.
function clientIpFrom(request?: Request): string | undefined {
  return auditIpFromHeaders(request?.headers)
}

export async function authorizeCredentials(
  credentials: Partial<Record<"email" | "password" | "otp" | "mode" | "remember", unknown>>,
  request?: Request,
) {
  const ip = clientIpFrom(request)
  if (!credentials?.email) return null

  // IP-based throttle on the whole credentials path (password + OTP
  // steps) — the only prior ceiling was the per-account 5-attempt lock, which
  // never trips a low-and-slow password spray across many different accounts
  // from one IP. Postgres-backed (dbRateLimit), so it stays correct if
  // --max-replicas is ever raised, unlike the in-memory rateLimit(). Mirrors
  // the public register route's per-IP cap (10/min) recommended by the audit.
  // No IP (e.g. a direct internal call) skips the check rather than blocking.
  // the e2e suite drives login from a single runner IP, serially,
  // dozens of times — it trips its own 10/60s throttle and every later spec's
  // loginAs is then rejected `ip_rate_limited` (the long-mistaken "auth flake",
  // //). Skip the throttle ONLY under E2E_ALLOW_TEST_OVERRIDES.
  // That flag is the sole e2e-vs-real-prod signal — the suite runs a genuine
  // production build — so envCheck can't reject the flag itself; it merely uses
  // it as the exemption key for DISABLE_OTP + E2E_MOCK_EMAIL. The flag already
  // unlocks disabling OTP (strictly worse than dropping a per-IP rate limit),
  // so gating the throttle on it adds no new prod exposure; the guarantee that
  // it is never set on a real deployment is operational, not enforced. Systemic
  // hardening of the flag against prod misuse is tracked in.
  // key on `ip ?? "unknown"` so a request whose XFF is missing or fails
  // the IP regex falls back to a shared bucket rather than skipping the throttle
  // entirely — matches the sibling limiters (publicFeedback.ts, membership.ts).
  const e2eOverride = process.env.E2E_ALLOW_TEST_OVERRIDES === "true"
  if (!e2eOverride && !(await dbRateLimit(`login:ip:${ip ?? "unknown"}`, 10, 60_000))) {
    // reason-coded so a valid-cred rejection (e2e flake, prod incident) is
    // diagnosable from container logs. No PII beyond the ip already logged.
    logger.warn("credential login rejected", { reason: "ip_rate_limited", ipPresent: true })
    return null
  }

  if (credentials.mode === "otp") {
    const email = credentials.email as string
    const otp = (credentials.otp as string | undefined)?.trim()
    if (!otp || otp.length !== 6) return null

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) return null
    // a soft-deleted user must never authenticate. (Its email is also
    // tombstoned on archive, so this is defence-in-depth.)
    if (user.archivedAt) return null

    // Check both lockouts BEFORE the expiry check — a locked account must always
    // surface AccountLocked, not silently fall through once the OTP expires.
    // Password lockout must also be honoured here — otherwise a
    // password-locked account (still holding an unexpired OTP from before the
    // lock) can sign in via the OTP step alone, bypassing the password lock.
    if (
      (user.lockedUntil && user.lockedUntil > new Date()) ||
      (user.otpLockedUntil && user.otpLockedUntil > new Date())
    ) {
      throw new AccountLocked()
    }

    if (!user.otpCode || !user.otpExpiresAt) return null
    if (user.otpExpiresAt < new Date()) return null

    // DB stores the HMAC of the OTP; hash the submitted code and compare.
    // Timing-safe comparison — guard against length mismatch (throws if unequal lengths)
    const storedBuf = Buffer.from(user.otpCode, "utf8")
    const inputBuf = Buffer.from(hashOtp(otp), "utf8")
    const otpValid = storedBuf.length === inputBuf.length && timingSafeEqual(storedBuf, inputBuf)

    if (!otpValid) {
      const { failedOtpAttempts: newOtpAttempts } = await prisma.user.update({
        where: { id: user.id },
        data: { failedOtpAttempts: { increment: 1 } },
        select: { failedOtpAttempts: true },
      })
      if (newOtpAttempts >= 5) {
        // Match null OR an already-expired lock — filtering on `otpLockedUntil: null`
        // alone means the account can never re-lock after its first lockout expires,
        // because the field then holds a stale (past) timestamp, not null.
        await prisma.user.updateMany({
          where: { id: user.id, OR: [{ otpLockedUntil: null }, { otpLockedUntil: { lte: new Date() } }] },
          // Reset the counter as we lock — else a single wrong code after
          // the lock expires re-locks instantly on the still-stale counter.
          data: { otpLockedUntil: new Date(Date.now() + 15 * 60 * 1000), failedOtpAttempts: 0 },
        })
      }
      void logAudit(user.id, "USER_LOGIN_FAILED", "User", user.id, { reason: "invalid_otp" }, ip)
      return null
    }

    // Atomically verify-and-consume: two concurrent requests presenting the
    // same still-valid OTP could otherwise both pass the checks above before
    // either clears it, minting two sessions from a single one-time code
    //. Conditioning the update on the exact otpCode/otpExpiresAt just
    // read means only the request that "wins" the race affects a row — a
    // concurrent request that already cleared otpCode makes this a no-op.
    const { count } = await prisma.user.updateMany({
      where: { id: user.id, otpCode: user.otpCode, otpExpiresAt: { gt: new Date() } },
      data: {
        otpCode: null,
        otpExpiresAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        failedOtpAttempts: 0,
        otpLockedUntil: null,
      },
    })
    if (count === 0) {
      // Lost the race (or expired at the instant of the write) — treat like
      // an invalid code rather than minting a second session.
      void logAudit(user.id, "USER_LOGIN_FAILED", "User", user.id, { reason: "invalid_otp" }, ip)
      return null
    }
    // Only fresh OTP verification can grant device trust. A pending row cannot
    // bypass OTP; trustDevice exchanges it once using this session's signed ID.
    let deviceTrustGrant: string | undefined
    if (credentials.remember === "true") {
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
      remember: credentials.remember === "true",
    }
  }

  // Password step (default)
  if (!credentials?.password) return null
  const email = credentials.email as string
  const password = credentials.password as string

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    // burn the same bcrypt cost as the real compare below so this
    // fast path can't be timed apart from a valid-email/wrong-password path.
    await compare(password, await DUMMY_PASSWORD_HASH)
    logger.warn("credential login rejected", { reason: "no_user", ipPresent: !!ip })
    return null
  }
  // reject a soft-deleted user (email is also tombstoned on archive).
  if (user.archivedAt) return null

  // (accepted, LOW): the lockout is checked before verifying the password,
  // so an unauthenticated caller can distinguish a real+locked account from an
  // unknown/unlocked one. This is inherent to surfacing "account locked" to the
  // legitimate user (the login UI shows it) and to the lockout-first ordering
  // required by// (a locked account must always surface
  // AccountLocked, even after its OTP expires). Bounded info leak, no credential
  // compromise; the per-account 5-attempt lock and per-IP throttle backstop it.
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AccountLocked()
  }

  const passwordValid = await compare(password, user.passwordHash)

  if (!passwordValid) {
    const { failedLoginAttempts: newAttempts } = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    })
    if (newAttempts >= 5) {
      // Match null OR an already-expired lock — (same class of bug as
      // the OTP lock above): `lockedUntil: null` alone never re-locks after expiry.
      await prisma.user.updateMany({
        where: { id: user.id, OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }] },
        // Reset the counter as we lock — else a single wrong password after
        // the lock expires re-locks instantly on the still-stale counter.
        data: { lockedUntil: new Date(Date.now() + 15 * 60 * 1000), failedLoginAttempts: 0 },
      })
    }
    notifyFailedLogin(user.email).catch((err: unknown) => {
      console.error("[notify] Failed to send failed-login alert:", err instanceof Error ? err.message : String(err))
    })
    void logAudit(user.id, "USER_LOGIN_FAILED", "User", user.id, { reason: "invalid_password" }, ip)
    logger.warn("credential login rejected", { reason: "bad_password", ipPresent: !!ip })
    return null
  }

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
    // A failed rollback must not mask the delivery failure with a raw DB error
    //. Worst case the stale code survives: the undelivered hash can't
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

// Cached read of the configurable idle-timeout setting. The per-request
// jwtCallback consults this on every protected request, so a 60s in-process TTL
// keeps it from hitting the DB each time — the setting changes a few times a
// year. Falls back to 60 minutes on any miss/error.
// Concurrent requests can race to refresh the cache (each does its own DB read
// and last-write-wins); the values are identical and the setting is read-only
// here, so the worst case is a few redundant reads on expiry — acceptable.
let idleMsCache: { value: number; expires: number } | null = null
async function getIdleMs(): Promise<number> {
  const now = Date.now()
  if (idleMsCache && now < idleMsCache.expires) return idleMsCache.value
  let minutes = 60
  try {
    const s = await prisma.appSetting.findUnique({ where: { key: "SESSION_IDLE_TIMEOUT_MINUTES" } })
    // Only honour a positive value — 0 (or a blank) would zero the idle window
    // and invalidate every non-remembered session on its next request.
    if (s && /^\d+$/.test(s.value)) {
      const parsed = parseInt(s.value, 10)
      if (parsed > 0) minutes = parsed
    }
  } catch {
    // keep the default
  }
  idleMsCache = { value: minutes * 60_000, expires: now + 60_000 }
  return idleMsCache.value
}

// At sign-in, stamp role/id + issue/activity timestamps from the freshly-
// authorized user, and drop the email claim (keep PII out of the long-
// lived token). On every later request, re-query the user and invalidate the
// session (return null) if the account has since been deleted, is locked
//, was logged out / force-invalidated, or has been idle past the
// configured window. Otherwise refresh role + activity timestamp.
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
    const userId = parseInt(token.id as string, 10)
    if (Number.isNaN(userId)) return null
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, lockedUntil: true, sessionsValidFrom: true, archivedAt: true },
    })
    if (!dbUser) return null
    // kill a live session the instant its user is soft-deleted.
    if (dbUser.archivedAt) return null
    const nowDate = new Date()
    if (dbUser.lockedUntil && dbUser.lockedUntil > nowDate) {
      return null
    }
    // a logout / forced invalidation sets sessionsValidFrom; any token
    // issued before that instant is dead even though the JWT has not expired.
    // A token minted before this change carries no loginAt — treat that as
    // epoch 0 (always before sessionsValidFrom), so logout still kills it.
    const loginAt = token.loginAt as number | undefined
    if (dbUser.sessionsValidFrom && (loginAt ?? 0) < dbUser.sessionsValidFrom.getTime()) {
      return null
    }
    // /: remember-aware session windows.
    // Non-remembered: 4h hard cap from loginAt + DB-configurable idle (default 60min).
    // Remembered: 7-day sliding idle from lastActivity, no separate hard cap.
    // A token minted before this change has no lastActivity — grandfather it in
    // by stamping now (below) and enforcing from this request onward.
    const now = Date.now()
    const remember = token.remember === true
    // loginAt already declared above for the sessionsValidFrom check — reuse it.
    const lastActivity = token.lastActivity as number | undefined

    if (remember) {
      // 7-day sliding idle: a continuously-used remembered session stays alive;
      // 7 days without activity ends it. No separate hard cap.
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
      if (lastActivity && now - lastActivity > SEVEN_DAYS_MS) return null
    } else {
      // Non-remembered: 4h hard cap + DB-configurable idle (default 60min).
      const FOUR_HOURS_MS = 4 * 60 * 60 * 1000
      if (loginAt && now - loginAt > FOUR_HOURS_MS) return null
      if (lastActivity && now - lastActivity > (await getIdleMs())) return null
    }
    token.lastActivity = now
    token.role = dbUser.role
    // Drop a stale email claim from any token minted before.
    if (token.email) delete token.email
  }
  return token
}

export const { auth, handlers, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        otp: { label: "Code", type: "text" },
        mode: { label: "Mode", type: "text" },
        remember: { label: "Remember device", type: "text" },
      },
      authorize: authorizeCredentials,
    }),
  ],
  callbacks: {
    jwt: jwtCallback,
    async session({ session, token }) {
      session.user.role = token.role as UserRole
      session.user.id = token.id as string
      session.deviceTrustGrant = token.deviceTrustGrant
      return session
    },
  },
  // 7-day cookie TTL ceiling (was 4h). The REAL per-session lifetime is enforced
  // in jwtCallback by the `remember` claim: non-remembered tokens still die at
  // 4h hard cap + 60min idle; remembered tokens get 7-day sliding idle.'s
  // hard cap now lives in jwtCallback (non-remember branch), not in maxAge.
  session: { strategy: "jwt", maxAge: 604800 },
})
