"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { actorId } from "@/lib/actor"
import { logger } from "@/lib/logger"
import { logAudit } from "@/lib/audit"
import { canAccessAccounting, canViewAccounting } from "@/lib/roleGuard"
import { featureGuard } from "@/lib/featureFlags"
import { getChurchSettingsForReceipt } from "@/lib/churchSettings"
import { renderGivingStatementPdf } from "@/lib/pdf/GivingStatementPdf"
import { sendGivingStatementEmail } from "@/lib/email"
import { centsToNumber } from "@/lib/formatting"
import { isValidPgId } from "@/lib/validation"
import {
  buildStatementModel,
  parseStatementYear,
  STATEMENT_SENT,
  STATEMENT_FAILED,
} from "@/lib/givingStatement"
import { loadStatements, loadStatementFamilies } from "@/lib/givingStatementData"

const LIST_PATH = "/accounting/giving-statements"
const MAX_BATCH = 200
// Cap on send-log rows read per FY (one row per attempt, so this is generous).
const LOG_CAP = 5000

export type StatementListRow = {
  familyId: number
  familyName: string
  giftCount: number
  total: number
  /** True when at least one consenting member has a valid email. Addresses never leave the server. */
  canEmail: boolean
  lastStatus: "SENT" | "FAILED" | null
  lastAt: Date | null
}

export type StatementSendResult =
  | { sent: number; failed: number; skipped: number; errors: { familyId: number; error: string }[] }
  | { error: string }

/**
 * Latest send outcome per family for a FY, newest attempt wins. The send log is
 * the audit trail: one row per attempt, resourceId = familyId, metadata.fyStartYear.
 */
async function latestSendByFamily(year: number): Promise<Map<number, { status: "SENT" | "FAILED"; at: Date }>> {
  const rows = await prisma.auditLog.findMany({
    where: { action: { in: [STATEMENT_SENT, STATEMENT_FAILED] }, metadata: { path: ["fyStartYear"], equals: year } },
    orderBy: { createdAt: "desc" },
    take: LOG_CAP,
    select: { action: true, resourceId: true, createdAt: true },
  })
  const out = new Map<number, { status: "SENT" | "FAILED"; at: Date }>()
  for (const r of rows) {
    if (r.resourceId != null && !out.has(r.resourceId)) {
      out.set(r.resourceId, { status: r.action === STATEMENT_SENT ? "SENT" : "FAILED", at: r.createdAt })
    }
  }
  return out
}

/**
 * List every family with giving in the FY, with its total and last send status.
 * Accounting viewers only.
 * @param year FY start year
 */
export async function listGivingStatements(year: number): Promise<StatementListRow[] | { error: string }> {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("receipts")
  if (off) return off
  const fy = parseStatementYear(year)
  if (fy === null) return { error: "Invalid financial year." }

  const statements = await loadStatements(fy)
  const ids = Array.from(statements.keys())
  const [families, sent] = await Promise.all([loadStatementFamilies(ids), latestSendByFamily(fy)])
  return ids
    .flatMap((id) => {
      const f = families.get(id)
      const s = statements.get(id)
      if (!f || !s) return [] // archived or deleted family
      const last = sent.get(id)
      return [{
        familyId: id,
        familyName: f.name,
        giftCount: s.lines.length,
        total: centsToNumber(s.totalCents),
        canEmail: f.emails.length > 0,
        lastStatus: last?.status ?? null,
        lastAt: last?.at ?? null,
      }]
    })
    .sort((a, b) => a.familyName.localeCompare(b.familyName))
}

/**
 * Email giving statements (PDF) to the chosen families, logging each attempt.
 * One recipient per family: the head of family's address first. Members who
 * opted out of email are never used. ADMIN/PASTOR only.
 * @param year FY start year
 * @param familyIds families to send to (max 200 per batch)
 * @param skipAlreadySent leave out families whose latest attempt for this FY succeeded
 */
export async function sendGivingStatements(
  year: number,
  familyIds: number[],
  skipAlreadySent = true
): Promise<StatementSendResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("receipts")
  if (off) return off
  const fy = parseStatementYear(year)
  if (fy === null) return { error: "Invalid financial year." }
  const ids = Array.from(new Set(familyIds))
  if (ids.length === 0) return { error: "Select at least one family." }
  if (ids.length > MAX_BATCH) return { error: `Max ${MAX_BATCH} per batch` }
  if (!ids.every((i) => isValidPgId(i))) return { error: "Invalid family." }
  const uid = actorId(session)

  const churchRes = await getChurchSettingsForReceipt()
  if ("error" in churchRes) return { error: churchRes.error }
  const church = churchRes.church

  const [statements, families, already] = await Promise.all([
    loadStatements(fy, ids),
    loadStatementFamilies(ids),
    skipAlreadySent ? latestSendByFamily(fy) : Promise.resolve(new Map()),
  ])

  let sent = 0
  let failed = 0
  let skipped = 0
  const errors: { familyId: number; error: string }[] = []
  for (const id of ids) {
    const statement = statements.get(id)
    const family = families.get(id)
    if (!statement || !family) {
      failed++
      errors.push({ familyId: id, error: "No giving recorded for this family in the financial year." })
      continue
    }
    if (already.get(id)?.status === "SENT") {
      skipped++
      continue
    }
    const to = family.emails[0]
    if (!to) {
      failed++
      errors.push({ familyId: id, error: "No email address on file (or no member has consented to email)." })
      continue
    }
    const model = buildStatementModel(statement, family.name, fy, church)
    try {
      const pdf = await renderGivingStatementPdf(model)
      await sendGivingStatementEmail(to, pdf, {
        churchName: model.churchName,
        churchAbn: model.churchAbn,
        churchAddress: model.churchAddress,
        churchEmail: model.churchEmail,
        familyName: family.name,
        fyLabel: model.fyLabel,
        periodLabel: model.periodLabel,
        totalLabel: model.totalLabel,
      })
    } catch {
      // Never log the raw error — SMTP messages embed the recipient address.
      logger.error("sendGivingStatements delivery failed", { familyId: id })
      await logAudit(uid, STATEMENT_FAILED, "Family", id, { fyStartYear: fy })
      failed++
      errors.push({ familyId: id, error: "Email delivery failed" })
      continue
    }
    // Delivered. Audit metadata holds ids and totals only — never the address.
    await logAudit(uid, STATEMENT_SENT, "Family", id, { fyStartYear: fy, totalCents: statement.totalCents })
    sent++
  }
  revalidatePath(LIST_PATH)
  return { sent, failed, skipped, errors }
}

export type StatementLogRow = {
  id: number
  familyId: number
  familyName: string
  status: "SENT" | "FAILED"
  at: Date
  sentBy: string
}

/**
 * Per-recipient send log for a FY, newest first. Accounting viewers only.
 * @param year FY start year
 */
export async function listStatementSendLog(year: number): Promise<StatementLogRow[] | { error: string }> {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("receipts")
  if (off) return off
  const fy = parseStatementYear(year)
  if (fy === null) return { error: "Invalid financial year." }

  const rows = await prisma.auditLog.findMany({
    where: { action: { in: [STATEMENT_SENT, STATEMENT_FAILED] }, metadata: { path: ["fyStartYear"], equals: fy } },
    orderBy: { createdAt: "desc" },
    take: LOG_CAP,
    select: { id: true, action: true, resourceId: true, createdAt: true, user: { select: { name: true } } },
  })
  const familyIds = Array.from(new Set(rows.flatMap((r) => (r.resourceId == null ? [] : [r.resourceId]))))
  const families = await prisma.family.findMany({ where: { id: { in: familyIds } }, select: { id: true, name: true } })
  const names = new Map(families.map((f) => [f.id, f.name]))
  return rows.flatMap((r) =>
    r.resourceId == null
      ? []
      : [{
          id: r.id,
          familyId: r.resourceId,
          familyName: names.get(r.resourceId) ?? `Family #${r.resourceId}`,
          status: r.action === STATEMENT_SENT ? ("SENT" as const) : ("FAILED" as const),
          at: r.createdAt,
          sentBy: r.user?.name ?? "System",
        }]
  )
}
