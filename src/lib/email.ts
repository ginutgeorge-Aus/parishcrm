import "server-only"
import * as React from "react"
import * as nodemailer from "nodemailer"
import { render } from "@react-email/render"
import { ReceiptEmail } from "@/lib/emails/ReceiptEmail"
import type { ReceiptData } from "@/lib/emails/ReceiptEmail"
import { WelcomeEmail } from "@/lib/emails/WelcomeEmail"
import { PasswordResetEmail } from "@/lib/emails/PasswordResetEmail"
import { FamilyUpdateInviteEmail } from "@/lib/emails/FamilyUpdateInviteEmail"
import { DgrReceiptEmail } from "@/lib/emails/DgrReceiptEmail"
import { RegistrationConfirmationEmail } from "@/lib/emails/RegistrationConfirmationEmail"
import type { RegistrationConfirmationData } from "@/lib/emails/RegistrationConfirmationEmail"
import { EventReminderEmail } from "@/lib/emails/EventReminderEmail"
import type { EventReminderData } from "@/lib/emails/EventReminderEmail"
import { PaymentReminderEmail } from "@/lib/emails/PaymentReminderEmail"
import type { PaymentReminderData } from "@/lib/emails/PaymentReminderEmail"
import { MembershipNotificationEmail } from "@/lib/emails/MembershipNotificationEmail"
import { WelcomeLetterEmail } from "@/lib/emails/WelcomeLetterEmail"
import type { WelcomeLetterModel } from "@/lib/welcomeLetter"
import { prisma } from "@/lib/prisma"
import { getEmailTemplate, getChurchName } from "@/lib/emailTemplateStore"
import { applyVars } from "@/lib/emailTemplates"
import { withRetry } from "@/lib/retry"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"
import { zoneLabel } from "@/lib/dates"

// Lazily-initialized module-level singleton. nodemailer.createTransport pools
// SMTP connections internally and is designed to be called once, not per send —
// re-creating it on every email opens a fresh connection each time (a 200-row
// batch would open 200). Created on first use (not at import) so the module can
// be imported during build/test without SMTP creds present.
let cachedTransporter: ReturnType<typeof nodemailer.createTransport> | null = null

function makeTransporter(): { transporter: ReturnType<typeof nodemailer.createTransport>; user: string } {
  // E2E: short-circuit to an in-memory stub so tests assert success without SMTP.
  // Dead code in prod (env var unset). Covers sendEmail + sendReceiptEmail (single chokepoint).
  if (process.env.E2E_MOCK_EMAIL === "true") {
    if (!cachedTransporter) {
      cachedTransporter = {
        sendMail: async (opts: { to: string; subject?: string }) => {
          // Log the recipient only — never echo the subject or body, even in
          // e2e. OTP codes live in the email body, not the
          // subject, so keeping logs to the recipient avoids leaking them.
          console.log("[E2E_MOCK_EMAIL] sendMail", opts.to)
          return { messageId: "e2e-mock", accepted: [opts.to], rejected: [] }
        },
      } as unknown as ReturnType<typeof nodemailer.createTransport>
    }
    return { transporter: cachedTransporter, user: process.env.GMAIL_USER ?? "e2e@test.local" }
  }

  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) throw new Error("Email not configured: GMAIL_USER or GMAIL_APP_PASSWORD missing")
  if (!cachedTransporter) {
    // Explicit SMTP deadlines (nodemailer defaults: 2 min connect, 10 min socket
    // idle). A send is at most 3 attempts + 1 owner alert, so these keep one send
    // — and so one parallel reminder chunk — well under the reminder sweep's
    // 10-min lease.
    cachedTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
      connectionTimeout: 20_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    })
  }
  return { transporter: cachedTransporter, user }
}

// nodemailer surfaces transport problems with a string `code` and SMTP replies
// with a numeric `responseCode`. Retrying is only SAFE when the message provably
// never reached the server — a retry after the server already accepted it delivers
// a duplicate: SMTP can accept the mail and then lose the final ack, so a
// socket error at that point is ambiguous, not a clean failure. Only retry errors
// that occur BEFORE message submission:
//   - 4xx SMTP reply (greylist/rate-limit/temp reject) — server refused before accepting.
//   - Connection-establishment failures (refused/DNS/TLS handshake) — never sent DATA.
// Auth failures (5xx / EAUTH → 535) and hard rejects are permanent.
export function isTransientSmtpError(err: unknown): boolean {
  const e = err as { code?: string; responseCode?: number }
  if (typeof e?.responseCode === "number") return e.responseCode >= 421 && e.responseCode < 500
  if (typeof e?.code === "string") {
    // Pre-submission only: connection refused, DNS lookup failure, TLS handshake
    // failure, generic connection error. (Notably excludes ETIMEDOUT/ECONNRESET/
    // ESOCKET/EPIPE — those can strike after DATA and are handled as ambiguous.)
    return ["ECONNREFUSED", "EDNS", "EAI_AGAIN", "ETLS", "ECONNECTION"].includes(e.code)
  }
  return false
}

// Post-submission-ambiguous socket errors: a timeout/reset/broken-pipe can
// occur after the message DATA was sent but before the acceptance reply arrived, so
// the mail may already be delivered. These are NOT retried (a retry risks a
// duplicate); instead the send fails and the owner is alerted with an "unknown
// delivery" signal so a human decides, rather than an automatic resend.
export function isAmbiguousDeliveryError(err: unknown): boolean {
  const e = err as { code?: string }
  return typeof e?.code === "string" && ["ETIMEDOUT", "ECONNRESET", "ESOCKET", "EPIPE"].includes(e.code)
}

// Best-effort owner alert when a transactional send exhausts its retries.
// Uses a single raw send — no withRetry, no recursion into sendEmail — and swallows
// its own errors: the caller already handles the original failure, and alerting
// must never throw or loop (if SMTP is globally down this send fails too, harmlessly).
async function alertOwnerEmailFailure(failedSubject: string, cause: unknown, ambiguous = false): Promise<void> {
  try {
    // Dynamic import so email.ts's module graph never pulls in Prisma at load —
    // only the (rare) failure path touches the DB.
    const { prisma } = await import("@/lib/prisma")
    const setting = await prisma.appSetting.findUnique({ where: { key: "ownerNotificationEmail" } })
    if (!setting?.value) return
    const { transporter, user } = makeTransporter()
    const churchName = await getChurchName()
    const reason = cause instanceof Error ? cause.message : String(cause)
    const at = new Date()
    const now = `${at.toLocaleString(APP_LOCALE, { timeZone: APP_TIMEZONE })} (${zoneLabel(at)})`
    // Ambiguous: the mail may already have been delivered, so the alert must
    // NOT claim it failed — a human checks whether to resend rather than assuming unsent.
    const subject = ambiguous
      ? `Email delivery UNKNOWN — ${churchName}`
      : `Email delivery failure — ${churchName}`
    const text = ambiguous
      ? `A transactional email had an ambiguous delivery result (a socket error after the message was submitted). It MAY already have been delivered and was NOT automatically resent, to avoid a duplicate. Check with the recipient before resending.\nSubject: ${failedSubject}\nReason: ${reason}\nTime: ${now}`
      : `A transactional email failed to send after retries.\nSubject: ${failedSubject}\nReason: ${reason}\nTime: ${now}`
    await transporter.sendMail({
      from: `"${churchName}" <${user}>`,
      to: setting.value,
      subject,
      text,
    })
  } catch {
    // Nothing more we can do — the mail system itself is unavailable.
  }
}

type EmailAttachment = { filename: string; content: Buffer | string; contentType: string }

type MailOptions = {
  from: string
  to: string
  subject: string
  html: string
  text: string
  attachments?: EmailAttachment[]
}

// Single send chokepoint: bounded transient-retry so a Gmail-SMTP hiccup
// self-heals instead of blocking the first send, plus a best-effort owner
// alert when retries are exhausted. EVERY transactional send routes through here —
// no sender may call transporter.sendMail directly, or it silently loses both.
async function sendMailWithRetry(
  transporter: ReturnType<typeof nodemailer.createTransport>,
  options: MailOptions,
): Promise<void> {
  try {
    await withRetry(() => transporter.sendMail(options), {
      attempts: 3,
      baseDelayMs: 500,
      isRetryable: isTransientSmtpError,
    })
  } catch (err) {
    // Retries exhausted, a permanent error, or a post-submission-ambiguous socket
    // error — surface to the owner (best-effort), then rethrow so the caller
    // still sees the failure. Ambiguous errors get the "unknown delivery" wording so
    // nobody assumes the mail was lost and blindly resends a possible duplicate.
    await alertOwnerEmailFailure(options.subject, err, isAmbiguousDeliveryError(err))
    throw err
  }
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
  attachments?: EmailAttachment[]
): Promise<void> {
  const { transporter, user } = makeTransporter()
  const churchName = await getChurchName()
  await sendMailWithRetry(transporter, {
    from: `"${churchName}" <${user}>`,
    to,
    subject,
    html,
    text,
    ...(attachments?.length ? { attachments } : {}),
  })
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string
): Promise<void> {
  const churchName = await getChurchName()
  const el = React.createElement(PasswordResetEmail, { resetUrl, churchName })
  const html = await render(el)
  const text = await render(el, { plainText: true })
  await sendEmail(to, `Password Reset — ${churchName}`, html, text)
}

export async function sendFamilyUpdateInviteEmail(
  to: string,
  updateUrl: string,
  familyName: string
): Promise<void> {
  const churchName = await getChurchName()
  const tpl = await getEmailTemplate("familyUpdate")
  const vars = { familyName, churchName }
  const el = React.createElement(FamilyUpdateInviteEmail, {
    updateUrl,
    churchName,
    intro: applyVars(tpl.intro, vars),
    body: applyVars(tpl.body, vars),
    signoff: applyVars(tpl.signoff, vars),
  })
  const html = await render(el)
  const text = await render(el, { plainText: true })
  await sendEmail(to, applyVars(tpl.subject, vars), html, text)
}

export async function sendWelcomeEmail(
  to: string,
  opts: { name: string; role: string; setPasswordUrl: string; helpUrl: string }
): Promise<void> {
  const churchName = await getChurchName()
  const tpl = await getEmailTemplate("welcome")
  const vars = { name: opts.name, role: opts.role, churchName }
  const el = React.createElement(WelcomeEmail, {
    setPasswordUrl: opts.setPasswordUrl,
    helpUrl: opts.helpUrl,
    churchName,
    intro: applyVars(tpl.intro, vars),
    body: applyVars(tpl.body, vars),
    signoff: applyVars(tpl.signoff, vars),
  })
  const html = await render(el)
  const text = await render(el, { plainText: true })
  await sendEmail(to, applyVars(tpl.subject, vars), html, text)
}

// Notifies the church secretary that a new public membership application arrived
// (#membership form). No PII in the email body — just a link into the CRM where
// the application can be reviewed. Destination precedence: the admin-set
// `membershipSecretaryEmail` AppSetting, then the MEMBERSHIP_SECRETARY_EMAIL env,
// then GMAIL_USER. Silently no-ops if none is configured so a missing destination
// never throws and blocks the public submit action.
export async function sendMembershipNotificationEmail(applicantName: string, pdf?: Buffer): Promise<void> {
  const setting = await prisma.appSetting
    .findUnique({ where: { key: "membershipSecretaryEmail" } })
    .catch(() => null)
  const to =
    (setting?.value?.trim() || undefined) ??
    process.env.MEMBERSHIP_SECRETARY_EMAIL ??
    process.env.GMAIL_USER
  if (!to) return
  const churchName = await getChurchName()
  const reviewUrl = `${process.env.AUTH_URL ?? ""}/memberships`
  const el = React.createElement(MembershipNotificationEmail, { applicantName, reviewUrl, churchName })
  const html = await render(el)
  const text = await render(el, { plainText: true })
  // Attach the completed application PDF so the secretary can read/file it
  // without logging into the CRM. The filename carries the applicant's name.
  const safeName = applicantName.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "application"
  const attachments = pdf
    ? [{ filename: `membership-${safeName}.pdf`, content: pdf, contentType: "application/pdf" }]
    : undefined
  await sendEmail(to, "New membership application", html, text, attachments)
}

// Sends the new-member welcome letter PDF with a short cover email. `to` may be
// a comma-joined list (sendWelcomeLetter in actions/welcomeLetter.ts re-resolves
// every recipient's email server-side and joins them before calling this).
export async function sendWelcomeLetterEmail(to: string, model: WelcomeLetterModel, pdf: Buffer): Promise<void> {
  const el = React.createElement(WelcomeLetterEmail, {
    greetingName: model.greetingName,
    churchName: model.church.name,
  })
  const html = await render(el)
  const text = await render(el, { plainText: true })
  const safe = model.addresseeName.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "welcome-letter"
  await sendEmail(to, `Welcome to ${model.church.name}`, html, text, [
    { filename: `welcome-letter-${safe}.pdf`, content: pdf, contentType: "application/pdf" },
  ])
}

export async function sendRegistrationConfirmationEmail(
  to: string,
  data: RegistrationConfirmationData & { ics?: { content: string; filename: string } }
): Promise<void> {
  const { transporter, user } = makeTransporter()
  const el = React.createElement(RegistrationConfirmationEmail, data)
  await sendMailWithRetry(transporter, {
    from: `"${data.churchName}" <${user}>`,
    to,
    // Event title is organiser-authored (created via the authenticated CRM),
    // not attacker input — safe in the subject. No PII in the subject.
    subject: `Registration confirmed — ${data.eventTitle}`,
    html: await render(el),
    text: await render(el, { plainText: true }),
    ...(data.ics
      ? {
          attachments: [
            { filename: data.ics.filename, content: data.ics.content, contentType: "text/calendar" },
          ],
        }
      : {}),
  })
}

export async function sendEventReminderEmail(
  to: string,
  data: EventReminderData
): Promise<void> {
  const { transporter, user } = makeTransporter()
  const el = React.createElement(EventReminderEmail, data)
  await sendMailWithRetry(transporter, {
    from: `"${data.churchName}" <${user}>`,
    to,
    // Event title is organiser-authored via the authenticated CRM, not attacker
    // input — safe in the subject. No PII in the subject.
    subject: `Reminder — ${data.eventTitle}`,
    html: await render(el),
    text: await render(el, { plainText: true }),
  })
}

export async function sendPaymentReminderEmail(
  to: string,
  data: PaymentReminderData
): Promise<void> {
  const { transporter, user } = makeTransporter()
  const el = React.createElement(PaymentReminderEmail, data)
  await sendMailWithRetry(transporter, {
    from: `"${data.churchName}" <${user}>`,
    to,
    // Event title is organiser-authored via the authenticated CRM, not attacker
    // input — safe in the subject. No PII, no amount in the subject.
    subject: `Payment pending — ${data.eventTitle}`,
    html: await render(el),
    text: await render(el, { plainText: true }),
  })
}

export async function sendReceiptEmail(to: string, data: ReceiptData): Promise<void> {
  const { transporter, user } = makeTransporter()
  const tpl = await getEmailTemplate("receipt")
  // No description in the subject — it is encrypted-at-rest PII and mail
  // servers/logs store subjects in plaintext. The default subject uses
  // only {transactionId}/{date}; an admin edit cannot add the description.
  const vars = { churchName: data.churchName, transactionId: String(data.transactionId), date: data.date }
  const el = React.createElement(ReceiptEmail, {
    data,
    intro: applyVars(tpl.intro, vars),
    signoff: applyVars(tpl.signoff, vars),
  })
  await sendMailWithRetry(transporter, {
    from: `"${data.churchName}" <${user}>`,
    to,
    subject: applyVars(tpl.subject, vars),
    html: await render(el),
    text: await render(el, { plainText: true }),
  })
}

export async function sendDgrReceiptEmail(
  to: string,
  pdf: Buffer,
  meta: {
    receiptNo: string
    fyLabel: string
    churchName: string
    donorName: string
    churchAbn: string
    churchAddress: string
    churchEmail: string
    issueDate: string
    documentTitle: string
    totalLabel: string
    totalDonationsLabel: string
    coveredPeriod: string
  }
): Promise<void> {
  const { transporter, user } = makeTransporter()
  const tpl = await getEmailTemplate("dgrReceipt")
  const vars = {
    donorName: meta.donorName,
    receiptNo: meta.receiptNo,
    fyLabel: meta.fyLabel,
    churchName: meta.churchName,
  }
  const el = React.createElement(DgrReceiptEmail, {
    churchName: meta.churchName,
    churchAbn: meta.churchAbn,
    churchAddress: meta.churchAddress,
    churchEmail: meta.churchEmail,
    receiptNo: meta.receiptNo,
    fyLabel: meta.fyLabel,
    issueDate: meta.issueDate,
    documentTitle: meta.documentTitle,
    totalLabel: meta.totalLabel,
    totalDonationsLabel: meta.totalDonationsLabel,
    coveredPeriod: meta.coveredPeriod,
    intro: applyVars(tpl.intro, vars),
    body: applyVars(tpl.body, vars),
    signoff: applyVars(tpl.signoff, vars),
  })
  await sendMailWithRetry(transporter, {
    from: `"${meta.churchName}" <${user}>`,
    to,
    subject: applyVars(tpl.subject, vars),
    html: await render(el),
    text: await render(el, { plainText: true }),
    attachments: [{ filename: `${meta.receiptNo}.pdf`, content: pdf, contentType: "application/pdf" }],
  })
}
