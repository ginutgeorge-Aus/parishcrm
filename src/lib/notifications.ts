import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { getChurchName } from "@/lib/emailTemplateStore"
import { APP_TIMEZONE, APP_LOCALE } from "@/lib/appConfig"

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

export async function notifyFailedLogin(attemptedEmail: string): Promise<void> {
  const setting = await prisma.appSetting.findUnique({
    where: { key: "ownerNotificationEmail" },
  })
  if (!setting?.value) return

  const churchName = await getChurchName()
  const now = new Date().toLocaleString(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    timeZoneName: "short",
  })
  const subject = `Failed login attempt — ${churchName}`
  const html = `
    <p>A failed login attempt was recorded on <strong>${escHtml(churchName)}</strong>.</p>
    <table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">
      <tr><td style="color:#64748b;padding:6px 16px 6px 0">Account</td><td><strong>${escHtml(attemptedEmail)}</strong></td></tr>
      <tr><td style="color:#64748b;padding:6px 16px 6px 0">Time</td><td>${now}</td></tr>
    </table>
    <p style="font-size:12px;color:#94a3b8;margin-top:24px">If this was not you, no action is required. The account locks after 5 failed attempts.</p>
  `
  const text = `Failed login attempt on ${churchName}\nAccount: ${attemptedEmail}\nTime: ${now}`

  await sendEmail(setting.value, subject, html, text)
}

// Owner alert for a Stripe webhook money-leak path — a customer was charged but
// the seat could not be delivered (amount mismatch, persist failure, duplicate
// charge, or an unexpected error). Money is retained under the no-refund policy
// ([[project-no-ticket-refunds]]) and a human must resolve it, so surface it
// beyond console.error → App Insights.
//
// Self-swallows ALL errors (settings lookup and send). Unlike notifyFailedLogin,
// this runs inside the Stripe webhook: a mail failure must never turn a 200 into
// a throw, or Stripe would redeliver an event we already fully processed. The
// console.error at each call site remains the durable, always-present signal;
// this email is best-effort escalation on top.
export async function notifyStripeAlert(subject: string, detail: string): Promise<void> {
  try {
    const setting = await prisma.appSetting.findUnique({
      where: { key: "ownerNotificationEmail" },
    })
    if (!setting?.value) return

    const churchName = await getChurchName()
    const now = new Date().toLocaleString(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    timeZoneName: "short",
  })
    const fullSubject = `Stripe alert: ${subject} — ${churchName}`
    const html = `
      <p>A Stripe payment on <strong>${escHtml(churchName)}</strong> needs manual review — a customer was charged but the registration could not be completed. Money is retained (no-refund policy); please resolve it.</p>
      <table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">
        <tr><td style="color:#64748b;padding:6px 16px 6px 0">Issue</td><td><strong>${escHtml(subject)}</strong></td></tr>
        <tr><td style="color:#64748b;padding:6px 16px 6px 0">Detail</td><td>${escHtml(detail)}</td></tr>
        <tr><td style="color:#64748b;padding:6px 16px 6px 0">Time</td><td>${now}</td></tr>
      </table>
      <p style="font-size:12px;color:#94a3b8;margin-top:24px">Check the Stripe Dashboard and the app's checkout sessions to reconcile.</p>
    `
    const text = `Stripe alert: ${subject}\n${detail}\nTime: ${now}\nMoney retained (no-refund policy) — manual review needed.`

    await sendEmail(setting.value, fullSubject, html, text)
  } catch {
    // Best-effort escalation only — never propagate into the webhook response.
  }
}
