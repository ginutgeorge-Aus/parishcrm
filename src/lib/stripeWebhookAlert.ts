import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { sendEmail } from "@/lib/email"
import { getChurchName } from "@/lib/emailTemplateStore"
import { UserRole } from "@/lib/generated/prisma/enums"

// Repeated Stripe webhook signature failures mean the signing secret is stale or
// wrong: every delivery 400s and paid registrations stay unpaid. Alert admins once
// per cooldown instead of waiting for a member to report a missing confirmation.
export const FAILURE_THRESHOLD = 3
export const FAILURE_WINDOW_MS = 10 * 60_000
export const ALERT_COOLDOWN_MS = 60 * 60_000
export const LAST_SENT_KEY = "stripeWebhookAlertLastSentAt"

export type WebhookAlertDeps = {
  now: () => number
  /** Epoch ms of the last alert, or null when never sent. */
  getLastSentAt: () => Promise<number | null>
  setLastSentAt: (ms: number) => Promise<void>
  sendAlert: () => Promise<void>
}

/**
 * Tracks failures in memory (single replica) and sends at most one alert per
 * cooldown. Never throws: a broken alert path must not change the webhook's 400.
 */
export function createWebhookFailureTracker(deps: WebhookAlertDeps) {
  let failures: number[] = []
  let cooldownUntil = 0
  let sending = false

  return async function recordFailure(): Promise<void> {
    try {
      const now = deps.now()
      failures = failures.filter((t) => now - t < FAILURE_WINDOW_MS)
      failures.push(now)
      if (failures.length < FAILURE_THRESHOLD || sending || now < cooldownUntil) return

      sending = true
      try {
        const last = await deps.getLastSentAt()
        if (last !== null && now - last < ALERT_COOLDOWN_MS) {
          cooldownUntil = last + ALERT_COOLDOWN_MS
          return
        }
        await deps.sendAlert()
        cooldownUntil = now + ALERT_COOLDOWN_MS
        failures = []
        await deps.setLastSentAt(now)
      } finally {
        sending = false
      }
    } catch (err) {
      logger.error("[stripeWebhookAlert] alert failed", { error: err instanceof Error ? err.message : String(err) })
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

async function sendAdminAlert(): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: UserRole.ADMIN, archivedAt: null },
    select: { email: true },
  })
  const recipients = [...new Set(admins.map((a) => a.email.trim()).filter(Boolean))]
  if (recipients.length === 0) throw new Error("no active ADMIN to email")
  const churchName = await getChurchName()
  const text = [
    `Stripe webhook verification is failing on ${churchName}: ${FAILURE_THRESHOLD} deliveries were rejected within ${FAILURE_WINDOW_MS / 60_000} minutes.`,
    "",
    "Check that STRIPE_WEBHOOK_SECRET matches the signing secret of this site's webhook endpoint in the Stripe Dashboard (Developers > Webhooks).",
    "Until it is fixed, card payments still complete at Stripe but registrations stay unpaid and no confirmation email is sent.",
    "",
    "You will not get another alert about this for at least 1 hour.",
  ].join("\n")
  const html = text
    .split("\n")
    .map((l) => (l ? `<p>${escapeHtml(l)}</p>` : ""))
    .join("")
  const subject = `Action needed: Stripe webhook verification failing — ${churchName}`
  let sent = 0
  for (const to of recipients) {
    try {
      await sendEmail(to, subject, html, text)
      sent++
    } catch (err) {
      logger.error("[stripeWebhookAlert] email failed", { error: err instanceof Error ? err.message : String(err) })
    }
  }
  if (sent === 0) throw new Error("alert email failed for every admin")
}

const defaultTracker = createWebhookFailureTracker({
  now: () => Date.now(),
  getLastSentAt: async () => {
    const row = await prisma.appSetting.findUnique({ where: { key: LAST_SENT_KEY } })
    const n = row ? Number(row.value) : NaN
    return Number.isFinite(n) ? n : null
  },
  setLastSentAt: async (ms) => {
    await prisma.appSetting.upsert({
      where: { key: LAST_SENT_KEY },
      create: { key: LAST_SENT_KEY, value: String(ms) },
      update: { value: String(ms) },
    })
  },
  sendAlert: sendAdminAlert,
})

/** Fire-and-forget from the webhook: counts one signature-verification failure. */
export function recordWebhookVerificationFailure(): void {
  void defaultTracker()
}
