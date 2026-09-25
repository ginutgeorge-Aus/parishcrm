"use server"

import { z } from "zod"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { createIssue, getIssue } from "@/lib/github"
import { issueStateToStatus } from "@/lib/reportStatus"
import { logAudit } from "@/lib/audit"
import { rateLimit } from "@/lib/rateLimit"
import { escapeMarkdown, buildIssueTitle, buildIssueBody } from "@/lib/feedbackIssue"
import type { ReportType } from "@/lib/generated/prisma/enums"
import type { ActionResultWithSuccess } from "./types"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"
import { zoneLabel } from "@/lib/dates"

export type FeedbackResult = ActionResultWithSuccess

const guidedField = (label: string) =>
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

// Client sends an app-relative pathname; restrict to safe path characters so
// arbitrary markdown can't be injected into the **Page:** line.
const pageUrl = z.string().regex(/^\/[\w\-./?=&%]*$/, "Invalid page URL").max(300).optional()

const BugSchema = z.object({
  type: z.literal("BUG"),
  whatDoing: guidedField("What you were doing"),
  whatExpected: guidedField("What you expected"),
  whatHappened: guidedField("What happened"),
  pageUrl,
  client: clientSchema,
})

const IdeaSchema = z.object({
  type: z.enum(["FEATURE", "SUGGESTION"]),
  what: guidedField("Your request"),
  why: z.string().trim().max(500, "Too long").optional(),
  pageUrl,
  client: clientSchema,
})

const Schema = z.union([BugSchema, IdeaSchema])

export type FeedbackInput = z.input<typeof Schema>

// Per-user in-memory rate limit: 5 reports / 10 min via the shared limiter.
// Per-replica only — accepted ("lightweight in-memory"); do NOT add Redis.
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 600_000

const LABELS: Record<ReportType, string[]> = {
  BUG: ["bug"],
  FEATURE: ["enhancement"],
  SUGGESTION: ["suggestion"],
}

const TITLE_PREFIX: Record<ReportType, string> = {
  BUG: "Bug",
  FEATURE: "Feature",
  SUGGESTION: "Suggestion",
}

export async function submitFeedback(input: FeedbackInput): Promise<FeedbackResult> {
  const session = await auth()
  if (!session?.user) return { error: "Unauthorized" }

  const parsed = Schema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const userId = actorId(session)
  if (!rateLimit(`feedback:${userId}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return { error: "Too many reports. Try again later." }
  }

  const data = parsed.data
  const { type, pageUrl, client } = data

  // Reporter email is NOT embedded in the issue: GitHub issues are visible
  // to all repo collaborators, so a staff/volunteer email there is a PII leak.
  const reporter = `${escapeMarkdown(session.user.name ?? "Unknown")} (${session.user.role}, user #${userId})`
  const submittedAt = new Date()
  const timestamp = new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(submittedAt) + ` (${zoneLabel(submittedAt)})`

  // The list-facing summary + the lead lines of the issue body differ by type.
  let summary: string
  let lead: string[]
  if (data.type === "BUG") {
    summary = data.whatHappened
    lead = [
      `**What they were doing:** ${escapeMarkdown(data.whatDoing)}`,
      `**What they expected:** ${escapeMarkdown(data.whatExpected)}`,
      `**What happened:** ${escapeMarkdown(data.whatHappened)}`,
    ]
  } else {
    summary = data.what
    lead = [`**Request:** ${escapeMarkdown(data.what)}`]
    if (data.why) lead.push(`**Why it helps:** ${escapeMarkdown(data.why)}`)
  }

  const title = buildIssueTitle(TITLE_PREFIX[type], summary)
  const body = buildIssueBody({
    lead,
    reporter,
    type,
    pageUrl: pageUrl ?? null,
    client,
    timestamp,
  })

  let issue: { number: number }
  try {
    issue = await createIssue({ title, body, labels: LABELS[type] })
  } catch {
    // Never surface the caught error text — it can include API/token detail.
    return { error: "Could not file report. Try again later." }
  }

  await prisma.report.create({
    data: { userId, type, title, summary, issueNumber: issue.number, pageUrl: pageUrl ?? null },
  })

  await logAudit(userId, "FEEDBACK_SUBMITTED", "Report", issue.number, { type, pageUrl })

  return { success: `Reported as issue #${issue.number}` }
}

// Lazily refresh open reports' status from GitHub. Called on the /reports page
// load (the app scales to zero — no scheduler). Only OPEN rows whose status was
// last synced more than STALE_MS ago are polled; RESOLVED/DECLINED are terminal.
// Any GitHub failure is swallowed so the list still renders from the mirror.
const STALE_MS = 60_000

export async function syncMyReports(): Promise<void> {
  // Derive the reporter from the session — never trust a caller-supplied id, or
  // this exposed server action becomes an IDOR / GitHub-rate-limit lever.
  const session = await auth()
  if (!session?.user) return
  const userId = actorId(session)

  const cutoff = new Date(Date.now() - STALE_MS)
  const stale = await prisma.report.findMany({
    where: {
      userId,
      status: "OPEN",
      OR: [{ syncedAt: null }, { syncedAt: { lt: cutoff } }],
    },
    select: { id: true, issueNumber: true },
    // Cap per-load GitHub calls — one sequential API call per row, shared
    // GITHUB_TOKEN rate limit; oldest-synced first so every row is refreshed
    // across loads.
    orderBy: { syncedAt: { sort: "asc", nulls: "first" } },
    take: 20,
  })

  for (const report of stale) {
    try {
      const { state, stateReason } = await getIssue(report.issueNumber)
      await prisma.report.update({
        where: { id: report.id },
        data: { status: issueStateToStatus(state, stateReason), syncedAt: new Date() },
      })
    } catch {
      // Stale-tolerant: leave the row as-is and move on.
    }
  }
}
