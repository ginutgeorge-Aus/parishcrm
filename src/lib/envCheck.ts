import "server-only"
import { currentKeyId } from "@/lib/crypto"

// Loopback AUTH_URL hosts that identify a non-production (e2e/local) deployment.
// A real production AUTH_URL is a public domain — a loopback host would break
// every emitted link (password reset, invites, Stripe redirect) — so loopback is
// the ONE positive signal that cannot appear in live prod. Fail-closed against
// this allowlist instead of an allowlist of known prod domains, so a custom,
// migrated, or misconfigured prod host can never boot with test overrides.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

// True only when AUTH_URL points at a loopback host. Unparseable/absent URLs are
// treated as not-loopback (a missing AUTH_URL already fails boot above).
function isLoopbackAuthUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname.toLowerCase())
  } catch {
    return false
  }
}

// Either name works at runtime (otp.ts and website-sync.ts carry the same
// fallback), so a half-renamed env boots; finish the rename via.
//
// Both names accepted via fallback (otp.ts, website-sync.ts), but if both are
// set to *different* values they silently disagree — OTP HMAC reads one,
// NextAuth JWT signing the other — so OTPs/sessions break unpredictably during
// a half-finished rename. Fail boot rather than diverge (AUDIT-010).
function checkAuthSecret(): string[] {
  const errors: string[] = []
  if (!process.env.AUTH_SECRET && !process.env.NEXTAUTH_SECRET) {
    errors.push("AUTH_SECRET is not set")
  }
  if (
    process.env.AUTH_SECRET &&
    process.env.NEXTAUTH_SECRET &&
    process.env.AUTH_SECRET !== process.env.NEXTAUTH_SECRET
  ) {
    errors.push("AUTH_SECRET and NEXTAUTH_SECRET are both set but differ — they must be identical")
  }
  return errors
}

// currentKeyId() loads the full keyring: throws when no key is set, the
// current key id has no key, or any key is not 32 bytes.
function checkCryptoKeyring(): string[] {
  try {
    currentKeyId()
    return []
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)]
  }
}

// DISABLE_OTP silently removes the second factor — dev/e2e only.
// Playwright must exercise the real production build (`next start` forces
// NODE_ENV=production), so playwright.config.ts webServer env sets the
// explicit override below. Never set E2E_ALLOW_TEST_OVERRIDES on a real
// deployment — it exists solely for the e2e suite.
function checkDisableOtp(): string[] {
  if (
    process.env.DISABLE_OTP === "true" &&
    process.env.NODE_ENV === "production" &&
    process.env.E2E_ALLOW_TEST_OVERRIDES !== "true"
  ) {
    return ["DISABLE_OTP=true is not allowed in production"]
  }
  return []
}

// E2E_MOCK_EMAIL swaps the SMTP transport for an in-memory stub that console.logs
// recipients — must never run in production (AUDIT-005). Exempted for the
// e2e suite the same way DISABLE_OTP is: the suite runs a production build but
// sets E2E_ALLOW_TEST_OVERRIDES.
function checkMockEmail(): string[] {
  if (
    process.env.E2E_MOCK_EMAIL === "true" &&
    process.env.NODE_ENV === "production" &&
    process.env.E2E_ALLOW_TEST_OVERRIDES !== "true"
  ) {
    return ["E2E_MOCK_EMAIL=true is not allowed in production"]
  }
  return []
}

// E2E_ALLOW_TEST_OVERRIDES is the single flag that unlocks FOUR security
// controls — DISABLE_OTP + per-IP login throttle (src/auth.ts), the
// auth.config.ts opt-out, and the trustedDevice.ts prod-guard bypass — yet the
// e2e suite runs a genuine production build (`next start` → NODE_ENV=production),
// so the flag alone cannot separate e2e from real prod. Fail-CLOSED: allow it
// ONLY when AUTH_URL is loopback (the e2e/local signal); any other host —
// including a custom, migrated, or misconfigured prod domain — hard-fails boot
//.
function checkE2EOverridesAllowed(): string[] {
  if (process.env.E2E_ALLOW_TEST_OVERRIDES === "true" && !isLoopbackAuthUrl(process.env.AUTH_URL)) {
    return [
      "E2E_ALLOW_TEST_OVERRIDES=true is not allowed unless AUTH_URL is loopback (e2e/local only) — it disables OTP, the login throttle, and trusted-device guards, so it must never run on a real deployment",
    ]
  }
  return []
}

// OTP emails are login-critical, so Gmail creds are required unless OTP is
// explicitly disabled (dev/e2e only — never production).
function checkGmailCreds(): string[] {
  if (process.env.DISABLE_OTP === "true") return []
  const errors: string[] = []
  if (!process.env.GMAIL_USER) errors.push("GMAIL_USER is not set (required while OTP is enabled)")
  if (!process.env.GMAIL_APP_PASSWORD) errors.push("GMAIL_APP_PASSWORD is not set (required while OTP is enabled)")
  return errors
}

// Event→website sync: if the URL is configured the HMAC secret must be too,
// else website-sync.ts silently no-ops and the church website stops getting
// event updates with no alert. Unset URL = sync disabled = fine.
function checkWebsiteSync(): string[] {
  if (process.env.WEBSITE_SYNC_URL && !process.env.WEBSITE_SYNC_SECRET) {
    return ["WEBSITE_SYNC_SECRET is not set but WEBSITE_SYNC_URL is — event sync would silently no-op"]
  }
  return []
}

// Regional config (APP_FY_START_MONTH / APP_TIMEZONE / APP_LOCALE /
// APP_CURRENCY). Importing appConfig runs its module-load validation, which
// throws on a bad value — surface that as a boot error rather than a silent
// mis-format. Unset values default to the AU config and never throw.
function checkAppConfig(): string[] {
  try {
    require("@/lib/appConfig")
    return []
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)]
  }
}

// Boot-time env validation. A missing/invalid required var must crash
// the container at startup — a revision-based host then keeps the previous
// revision serving (free rollback) instead of shipping a silently broken
// deploy (2026-06-06 AUTH_SECRET incident: deploy "succeeded", /api/health
// 200, every login dead).
//
// Called from instrumentation.ts register() — server boot only, never during
// `next build` (no env in the Docker build stage; same trap as/).
export function collectEnvErrors(): string[] {
  const errors: string[] = [...checkAuthSecret()]

  if (!process.env.DATABASE_URL) {
    errors.push("DATABASE_URL is not set")
  }

  // AUTH_URL is load-bearing for password reset links, welcome invites, family-update
  // invites, and Stripe checkout redirect base — a misconfigured value fails
  // silently and mails broken links, same failure class as the 2026-06-06 AUTH_SECRET
  // outage. Fail boot rather than let it drift unnoticed.
  if (!process.env.AUTH_URL) {
    errors.push("AUTH_URL is not set")
  }

  errors.push(...checkCryptoKeyring())
  errors.push(...checkDisableOtp())
  errors.push(...checkMockEmail())
  errors.push(...checkE2EOverridesAllowed())
  errors.push(...checkGmailCreds())
  errors.push(...checkWebsiteSync())
  errors.push(...checkAppConfig())

  return errors
}

// Non-fatal misconfiguration signals — logged once at boot (instrumentation.ts)
// but never crash the container. Use for values that have a safe runtime
// fallback yet usually indicate a deploy mistake.
export function collectEnvWarnings(): string[] {
  const warnings: string[] = []

  // CHURCH_NAME/ADDRESS/ABN fall back to placeholders in getChurchSettings()
  // and print on every official donation receipt. They can also come from the
  // AppSetting table (checked at runtime, not here), so this is a warning, not
  // a hard error — but an all-unset deploy almost certainly issues receipts
  // with the wrong church identity.
  if (!process.env.CHURCH_NAME) {
    warnings.push("CHURCH_NAME is not set — receipts fall back to a placeholder unless the churchName AppSetting is configured")
  }

  // The in-memory rate limiter (src/lib/rateLimit.ts) is correct only at a
  // single replica. deploy.yml pins --max-replicas 1, so this env is normally
  // unset/1; if it is ever raised the limiter silently degrades (each replica
  // keeps its own bucket) — surface it loudly.
  const replicas = Number(process.env.CONTAINER_APP_REPLICA_COUNT)
  if (Number.isFinite(replicas) && replicas > 1) {
    warnings.push(`CONTAINER_APP_REPLICA_COUNT=${replicas} > 1 — the in-memory rate limiter is per-replica and no longer enforces global limits; move it to a shared store before scaling out`)
  }

  // CRON_SECRET gates the scheduled cron endpoints (send-reminders + sweep-checkouts).
  // If it is unset both crons fail-closed (503) at run time, so the PII-retention
  // sweep and event reminder emails silently stop — the exact 2026-08-02 incident
  // class where reminders went unsent for weeks. The routes surface it per
  // run; this adds a boot-time signal too. Warning (not fatal): the app serves fine
  // for users without it, so it must not crash the container.
  if (!process.env.CRON_SECRET) {
    warnings.push("CRON_SECRET is not set — the scheduled crons (event reminders + abandoned-checkout PII sweep) are DISABLED and will 503")
  }

  // Turnstile: the server enforces a token whenever the secret is set
  // (src/lib/turnstile.ts), but the widget only renders with the site key. Secret
  // without key = every public registration/membership/feedback submit fails.
  // Warning, not fatal: the rest of the app still serves.
  // Deprecated name read via a variable key so it is not inlined at build time.
  const legacySiteKey = "NEXT_PUBLIC_TURNSTILE_SITE_KEY"
  if (process.env.TURNSTILE_SECRET_KEY && !(process.env.TURNSTILE_SITE_KEY || process.env[legacySiteKey])) {
    warnings.push("TURNSTILE_SECRET_KEY is set but TURNSTILE_SITE_KEY is not set — no CAPTCHA widget renders, so public form submissions will fail verification")
  }

  // Belt-and-suspenders for the/ hard guard above. That guard now
  // fail-closes on any non-loopback host, but keep surfacing the flag on ANY
  // production build too. In the e2e suite this fires by design (harmless — a
  // boot-log line, not a crash); on a real deployment it makes a stray value
  // loud in boot logs.
  if (process.env.E2E_ALLOW_TEST_OVERRIDES === "true" && process.env.NODE_ENV === "production") {
    warnings.push(
      "E2E_ALLOW_TEST_OVERRIDES=true is set under NODE_ENV=production — this disables OTP, the login throttle, and trusted-device guards, and must only ever be the e2e suite",
    )
  }

  return warnings
}

export function assertRequiredEnv(): void {
  const errors = collectEnvErrors()
  if (errors.length > 0) {
    throw new Error(`Startup env validation failed:\n- ${errors.join("\n- ")}`)
  }
}
