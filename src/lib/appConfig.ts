/**
 * Install-time locale/regional config. Defaults are Australian (July–June FY,
 * Sydney, en-AU, AUD); an instance can set its own country's fiscal year,
 * timezone, and currency.
 *
 * Read at RUNTIME, not build time, so one published container image serves
 * any church: the server reads plain env vars (APP_*, TURNSTILE_SITE_KEY), and
 * the root layout injects the resolved values as `window.__APP_CONFIG__`
 * (beforeInteractive) so client components format money/dates identically.
 * * would be inlined at `next build` and frozen into the image.
 * They are invariants for the process lifetime — no runtime editing.
 *
 * Invalid values throw at module load — fail-fast, same convention as envCheck.
 */

export type PublicAppConfig = {
  fyStartMonth: number
  timezone: string
  locale: string
  currency: string
  turnstileSiteKey?: string
}

declare global {
  interface Window {
    __APP_CONFIG__?: Partial<PublicAppConfig>
  }
}

const LEGACY_TURNSTILE_SITE_KEY = "NEXT_PUBLIC_TURNSTILE_SITE_KEY"

// Browser: the injected server config. Server (and tests / un-injected
// pages): process.env. Keyed on the injected object, not `typeof window`,
// because jsdom test suites define window too.
const injected = typeof window !== "undefined" ? window.__APP_CONFIG__ : undefined
const source = injected
  ? {
      fyStartMonth: injected.fyStartMonth?.toString(),
      timezone: injected.timezone,
      locale: injected.locale,
      currency: injected.currency,
      turnstileSiteKey: injected.turnstileSiteKey,
    }
  : {
      fyStartMonth: process.env.APP_FY_START_MONTH,
      timezone: process.env.APP_TIMEZONE,
      locale: process.env.APP_LOCALE,
      currency: process.env.APP_CURRENCY,
      // Deprecated name kept as a fallback so an env that still carries it keeps
      // its widget. Bracket access on purpose: dotted `process.env.NEXT_PUBLIC_*`
      // is inlined at build time even in server code, which would miss the value.
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || process.env[LEGACY_TURNSTILE_SITE_KEY],
    }

function readFyStartMonth(): number {
  const raw = source.fyStartMonth
  if (raw == null || raw === "") return 7
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    throw new Error(`APP_FY_START_MONTH must be an integer 1–12, got "${raw}"`)
  }
  return n
}

function readTimezone(): string {
  const tz = source.timezone || "Australia/Sydney"
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
  } catch {
    throw new Error(`APP_TIMEZONE is not a valid IANA timezone: "${tz}"`)
  }
  return tz
}

function readLocale(): string {
  const loc = source.locale
  if (!loc || !loc.trim()) return "en-AU"
  // Validate at load — a structurally invalid tag (e.g. the `en_US` underscore
  // typo) passes a non-empty check but throws `RangeError: Incorrect locale
  // information provided` later inside fmtAUD. Turn that into a boot-time error.
  try {
    new Intl.NumberFormat(loc)
  } catch {
    throw new Error(`APP_LOCALE is not a valid BCP-47 locale: "${loc}"`)
  }
  return loc
}

function readCurrency(): string {
  const cur = source.currency || "AUD"
  if (!/^[A-Z]{3}$/.test(cur)) {
    throw new Error(`APP_CURRENCY must be a 3-letter uppercase ISO-4217 code, got "${cur}"`)
  }
  return cur
}

export const FY_START_MONTH: number = readFyStartMonth()
export const APP_TIMEZONE: string = readTimezone()
export const APP_LOCALE: string = readLocale()
export const APP_CURRENCY: string = readCurrency()
export const TURNSTILE_SITE_KEY: string | undefined = source.turnstileSiteKey || undefined

/** Resolved config for the root layout to inject into the browser. */
export function publicAppConfig(): PublicAppConfig {
  return {
    fyStartMonth: FY_START_MONTH,
    timezone: APP_TIMEZONE,
    locale: APP_LOCALE,
    currency: APP_CURRENCY,
    turnstileSiteKey: TURNSTILE_SITE_KEY,
  }
}
