"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { findCheckpoint } from "@/lib/testCheckpoints"
import { createIssue } from "@/lib/github"
import { logAudit } from "@/lib/audit"
import type { ActionResultWithSuccess } from "./types"
import { APP_LOCALE, APP_TIMEZONE } from "@/lib/appConfig"
import { zoneLabel } from "@/lib/dates"

// Neutralise markdown control characters before embedding user-controlled text
// into the issue body (same approach as feedback.ts).
function escapeMarkdown(value: string): string {
  return value.replace(/[\\`|[\]*_~>#]/g, (c) => `\\${c}`)
}

const noteSchema = z.string().trim().min(1, "A note is required").max(500, "Note is too long")

export async function markWorking(checkpointId: string): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const checkpoint = findCheckpoint(checkpointId)
  if (!checkpoint) return { error: "Unknown checkpoint" }

  const userId = parseInt(session!.user!.id, 10)
  if (Number.isNaN(userId)) return { error: "Unauthorized" }
  const now = new Date()
  await prisma.checkpointResult.upsert({
    where: { checkpointId },
    create: { checkpointId, status: "WORKING", testedById: userId, testedAt: now },
    update: { status: "WORKING", testedById: userId, testedAt: now },
  })

  await logAudit(userId, "CHECKPOINT_VERIFIED", "CheckpointResult", undefined, { checkpointId })
  revalidatePath("/verify")
  return { success: "Marked working" }
}

export async function markBroken(
  checkpointId: string,
  note: string,
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const checkpoint = findCheckpoint(checkpointId)
  if (!checkpoint) return { error: "Unknown checkpoint" }

  const parsedNote = noteSchema.safeParse(note)
  if (!parsedNote.success) return { error: parsedNote.error.issues[0].message }
  const cleanNote = parsedNote.data

  const userId = parseInt(session!.user!.id, 10)
  if (Number.isNaN(userId)) return { error: "Unauthorized" }
  const reporter = `${escapeMarkdown(session!.user!.name ?? "Unknown")} (${session!.user!.role}, user #${userId})`
  const submittedAt = new Date()
  const timestamp = new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: APP_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(submittedAt) + ` (${zoneLabel(submittedAt)})`

  const title = `Bug: [${escapeMarkdown(checkpoint.area)}] ${[...checkpoint.title].slice(0, 60).join("")}`
  const body = [
    `**Checkpoint failed:** ${escapeMarkdown(checkpoint.title)}`,
    `**What's broken:** ${escapeMarkdown(cleanNote)}`,
    "",
    "<details><summary>Technical details</summary>",
    "",
    `- Checkpoint: ${escapeMarkdown(checkpoint.id)} (${escapeMarkdown(checkpoint.version)})`,
    `- Steps to verify: ${escapeMarkdown(checkpoint.steps)}`,
    `- Reported by: ${reporter}`,
    `- Page: /verify`,
    `- Submitted: ${timestamp}`,
    "</details>",
  ].join("\n")

  let issue: { number: number }
  try {
    issue = await createIssue({ title, body, labels: ["bug"] })
  } catch {
    // Never surface the caught text — it can include API/token detail.
    return { error: "Could not file the bug. Try again later." }
  }

  const now = new Date()
  await prisma.report.create({
    data: {
      userId,
      type: "BUG",
      title,
      summary: cleanNote,
      issueNumber: issue.number,
      pageUrl: "/verify",
    },
  })
  await prisma.checkpointResult.upsert({
    where: { checkpointId },
    create: {
      checkpointId,
      status: "BROKEN",
      testedById: userId,
      testedAt: now,
      issueNumber: issue.number,
      note: cleanNote,
    },
    update: {
      status: "BROKEN",
      testedById: userId,
      testedAt: now,
      issueNumber: issue.number,
      note: cleanNote,
    },
  })

  await logAudit(userId, "CHECKPOINT_FAILED", "Report", issue.number, { checkpointId })
  revalidatePath("/verify")
  return { success: `Filed as issue #${issue.number}` }
}
