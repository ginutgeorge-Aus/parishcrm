"use server"

import { z } from "zod"
import { headers } from "next/headers"
import { prisma } from "@/lib/prisma"
import { createIssue } from "@/lib/github"
import { verifyTurnstile } from "@/lib/turnstile"
import { dbRateLimit } from "@/lib/dbRateLimit"
import { sendEmail } from "@/lib/email"
import { escapeMarkdown, buildIssueTitle, buildIssueBody, type IssueClientContext } from "@/lib/feedbackIssue"
import type { ActionResultWithSuccess } from "./types"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"
import { zoneLabel } from "@/lib/dates"

const RATE_LIMIT = 5
const RATE_WINDOW_MS = 60 * 60 * 1000

const guided = (label: string) =>
  z.string().trim().min(1, `${label} is required`).max(500, `${label} is too long`)

const clientSchema = z
  .object({
    userAgent: z.string().max(500).optional(),
    language: z.string().max(50).optional(),
    viewport: z.string().max(40).optional(),
    screen: z.string().max(40).optional(),
    dpr: z.number().finite().optional(),
  })
  .optional()

// App-relative pathname only — restrict to safe path chars so nothing can be
// injected into the **Page:** line.
const pageUrl = z.string().regex(/^\/[\w\-./?=&%]*$/, "Invalid page URL").max(300).optional()

// Empty string is treated as "not provided"; any non-empty value must be a
// valid email. Bounded length either way.
const reporterEmail = z.union([z.literal(""), z.string().trim().email("Please enter a valid email").max(200)]).optional()

const shared = { reporterEmail, pageUrl, turnstileToken: z.string().max(3000).optional(), website: z.string().max(200).optional(), client: clientSchema }

const BugSchema = z.object({
  type: z.literal("BUG"),
  whatDoing: guided("What you were doing"),
  whatExpected: guided("What you expected"),
  whatHappened: guided("What happened"),
  ...shared,
})
const FeedbackSchema = z.object({
  type: z.literal("FEEDBACK"),
  what: guided("Your feedback"),
  why: z.string().trim().max(500, "Too long").optional(),
  ...shared,
})
const Schema = z.discriminatedUnion("type", [BugSchema, FeedbackSchema])

export type PublicFeedbackInput = z.input<typeof Schema>

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

async function notifyChurch(opts: {
  typeLabel: string
  summary: string
  // Raw (un-escaped) label/value pairs — the email renders its own HTML, so the
  // markdown-escaped variant built for the GitHub issue must NOT be reused here
  // (parish office would see literal `**` and `\*`).
  details: { label: string; value: string }[]
  contact?: string
  issueNumber: number
  pageUrl: string | null
  timestamp: string
}): Promise<void> {
  const setting = await prisma.appSetting.findUnique({ where: { key: "ownerNotificationEmail" } })
  if (!setting?.value) return

  const kind = opts.typeLabel.toLowerCase()
  const contact = opts.contact ?? "Not provided"
  const rows = [
    `<tr><td style="color:#64748b;padding:6px 16px 6px 0">Reply to</td><td>${escHtml(contact)}</td></tr>`,
    `<tr><td style="color:#64748b;padding:6px 16px 6px 0">Page</td><td>${escHtml(opts.pageUrl ?? "unknown")}</td></tr>`,
    `<tr><td style="color:#64748b;padding:6px 16px 6px 0">Tracking</td><td>Issue #${opts.issueNumber}</td></tr>`,
    `<tr><td style="color:#64748b;padding:6px 16px 6px 0">Time</td><td>${escHtml(opts.timestamp)}</td></tr>`,
  ].join("")
  const detail = opts.details.map((d) => `<p><strong>${escHtml(d.label)}:</strong> ${escHtml(d.value)}</p>`).join("")
  const subject = `New public ${kind} — ${opts.summary.replace(/[\r\n]+/g, " ").slice(0, 60)}`
  const html = `<p>A visitor submitted ${escHtml(kind)} from a public page.</p>${detail}<table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">${rows}</table>`
  const text = `New public ${kind} from a public page.\n${opts.details.map((d) => `${d.label}: ${d.value}`).join("\n")}\nReply to: ${contact}\nPage: ${opts.pageUrl ?? "unknown"}\nIssue #${opts.issueNumber}\nTime: ${opts.timestamp}`
  await sendEmail(setting.value, subject, html, text)
}

export async function submitPublicFeedback(input: PublicFeedbackInput): Promise<ActionResultWithSuccess> {
  // Honeypot — silent bots fill the hidden field.
  const website = input.website
  if (typeof website === "string" && website.trim().length > 0) return { error: "Submission failed" }

  const parsed = Schema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const data = parsed.data

  // Real client IP from the trusted reverse proxy (rightmost x-forwarded-for) —
  // never trust caller input for throttling.
  const xff = (await headers()).get("x-forwarded-for")
  const ip = xff?.split(",").at(-1)?.trim() || undefined

  if (!(await verifyTurnstile(data.turnstileToken, ip))) return { error: "Verification failed. Please try again." }
  if (!(await dbRateLimit(`pubfeedback:ip:${ip ?? "unknown"}`, RATE_LIMIT, RATE_WINDOW_MS)))
    return { error: "Too many reports. Please try again later." }

  const submittedAt = new Date()
  const timestamp = new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(submittedAt) + ` (${zoneLabel(submittedAt)})`

  let summary: string
  let details: { label: string; value: string }[]
  let labels: string[]
  let typeLabel: string
  if (data.type === "BUG") {
    summary = data.whatHappened
    details = [
      { label: "What they were doing", value: data.whatDoing },
      { label: "What they expected", value: data.whatExpected },
      { label: "What happened", value: data.whatHappened },
    ]
    labels = ["bug", "public"]
    typeLabel = "Bug"
  } else {
    summary = data.what
    details = [{ label: "Feedback", value: data.what }]
    if (data.why) details.push({ label: "Why", value: data.why })
    labels = ["enhancement", "public"]
    typeLabel = "Feedback"
  }

  // GitHub issue body: markdown-formatted, values escaped. The email in
  // notifyChurch renders `details` raw as HTML instead.
  const lead = details.map((d) => `**${d.label}:** ${escapeMarkdown(d.value)}`)

  const title = buildIssueTitle(typeLabel, summary)
  const body = buildIssueBody({
    lead,
    reporter: "Public visitor", // never a real identity — issues are collaborator-visible
    type: data.type,
    pageUrl: data.pageUrl ?? null,
    client: data.client as IssueClientContext | undefined,
    timestamp,
  })

  let issue: { number: number }
  try {
    issue = await createIssue({ title, body, labels })
  } catch {
    // Never surface the caught error text — it can include API/token detail.
    return { error: "Could not send your report. Please try again later." }
  }

  const contact = data.reporterEmail && data.reporterEmail.length > 0 ? data.reporterEmail : undefined
  // Fire-and-forget — a mail failure must never affect the visitor's success.
  void notifyChurch({ typeLabel, summary, details, contact, issueNumber: issue.number, pageUrl: data.pageUrl ?? null, timestamp }).catch(() => {})

  return { success: "Thanks — your report has been sent to the parish office." }
}
