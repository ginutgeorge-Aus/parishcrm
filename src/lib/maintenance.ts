import { DEFAULT_CHURCH_NAME } from "@/lib/settingsConstants"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"

export type MaintenanceState = {
  enabled: boolean
  backAt: string | null
  message: string | null
}

export const MAINTENANCE_KEY = "maintenance"

const DISABLED: MaintenanceState = { enabled: false, backAt: null, message: null }

export function parseMaintenanceValue(value: string | null | undefined): MaintenanceState {
  if (!value) return { ...DISABLED }
  try {
    const p = JSON.parse(value) as Record<string, unknown>
    return {
      enabled: p.enabled === true,
      backAt: typeof p.backAt === "string" ? p.backAt : null,
      message: typeof p.message === "string" ? p.message : null,
    }
  } catch {
    return { ...DISABLED }
  }
}

export function buildMaintenanceState(enabled: boolean, etaMinutes: number, now: Date): MaintenanceState {
  return {
    enabled,
    backAt: enabled ? new Date(now.getTime() + etaMinutes * 60_000).toISOString() : null,
    message: null,
  }
}

export function backAtLabel(backAt: string | null, now: Date): string {
  if (!backAt) return "shortly"
  const t = new Date(backAt)
  if (Number.isNaN(t.getTime()) || t.getTime() <= now.getTime()) return "shortly"
  const time = new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(t)
  // "Australia/Sydney" → "Sydney", "America/New_York" → "New York".
  const city = APP_TIMEZONE.split("/").pop()!.replace(/_/g, " ")
  return `around ${time} (${city})`
}

export function isMaintenanceBypassPath(pathname: string): boolean {
  return (
    pathname === "/api/health" ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/_next/") ||
    // Signature/bearer-secret-gated endpoints, not session auth — isPublicPath
    // (csp.ts) already exempts them from the login redirect for the same
    // reason. A maintenance 503 here risks a lost/delayed Stripe payment
    // confirmation or a missed cron run during a deploy window.
    pathname === "/api/stripe/webhook" ||
    pathname === "/api/cron/send-reminders" ||
    pathname === "/api/cron/sweep-checkouts"
  )
}

// Escape the five HTML-significant chars. CHURCH_NAME and the admin-set state
// message are interpolated into the page below; without escaping either could
// inject markup/script into the served HTML (/, Stored XSS).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function renderMaintenanceHtml(
  state: MaintenanceState,
  nonce: string,
  now: Date = new Date(),
): string {
  // Maintenance page renders when the DB is down, so it can't read the
  // AppSetting — env-only, but de-branded to the neutral default.
  const church = escapeHtml(process.env.CHURCH_NAME ?? DEFAULT_CHURCH_NAME)
  const line = escapeHtml(
    state.message ?? `We're installing an update — we'll be back ${backAtLabel(state.backAt, now)}.`,
  )
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>${church} — Updating</title>
<style nonce="${nonce}">
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:#0f1b2d; color:#f4f4f5; }
  .card { max-width:28rem; padding:2.5rem 2rem; text-align:center; }
  h1 { font-size:1.5rem; margin:0 0 .75rem; color:#e5b567; }
  p { font-size:1.05rem; line-height:1.6; margin:.5rem 0; color:#cbd5e1; }
  .small { font-size:.85rem; color:#94a3b8; margin-top:1.5rem; }
</style>
</head>
<body>
  <div class="card">
    <h1>${church}</h1>
    <p>${line}</p>
    <p class="small">This page refreshes automatically.</p>
  </div>
</body>
</html>`
}

let cache: { state: MaintenanceState; at: number } | null = null
const TTL_MS = 5_000

export async function getMaintenanceState(): Promise<MaintenanceState> {
  const now = Date.now()
  if (cache && now - cache.at < TTL_MS) return cache.state
  try {
    // Deferred import: @/lib/prisma is `server-only`, so a top-level import makes
    // this module unloadable from scripts/set-maintenance.ts. Inside the try so an
    // import failure also fails open (never 500 every request).
    const { prisma } = await import("@/lib/prisma")
    const row = await prisma.appSetting.findUnique({ where: { key: MAINTENANCE_KEY } })
    const state = parseMaintenanceValue(row?.value)
    cache = { state, at: now }
    return state
  } catch {
    // Fail-open: a DB blip must never lock everyone out.
    return { ...DISABLED }
  }
}

export function _resetMaintenanceCache(): void {
  cache = null
}
