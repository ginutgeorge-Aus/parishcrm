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
import { isValidPgId, isP2002 } from "@/lib/validation"
import { isResendAmbiguous } from "@/lib/resendTransport"
import {
  buildStatementModel,
  parseStatementYear,
  type FamilyStatement,
  STATEMENT_SENT,
  STATEMENT_FAILED,
} from "@/lib/givingStatement"
import { loadStatements, loadStatementFamilies, type StatementFamily } from "@/lib/givingStatementData"

const LIST_PATH = "/accounting/giving-statements"
const MAX_BATCH = 200
// Cap on send-log rows read per FY (one row per attempt, so this is generous).
const LOG_CAP = 5000
const CLAIM_PREFIX = "giving-statement-claim:"
// A PENDING claim older than this is treated as a crashed run and may be taken over by a forced resend.
const CLAIM_STALE_MS = 15 * 60 * 1000

/**
 * Take the per-family+FY send claim. The claim row value tracks its state:
 * `PENDING:<ms>` while sending, `SENT:<ms>` once delivered, `UNKNOWN:<ms>` when
 * delivery is ambiguous. Without `force` only a fresh create wins. With `force` an
 * existing SENT/UNKNOWN/stale-PENDING claim is replaced by an atomic compare-and-swap,
 * so two forced runs (or a forced run and a live sender) can never both win.
 * @param key claim row key
 * @param force true for an explicit resend
 * @returns true when this caller now owns the claim
 */
async function acquireClaim(key: string, force: boolean): Promise<boolean> {
  const pending = `PENDING:${Date.now()}`
  try {
    await prisma.appSetting.create({ data: { key, value: pending } })
    return true
  } catch (e) {
    if (!isP2002(e)) throw e
  }
  if (!force) return false
  const existing = await prisma.appSetting.findUnique({ where: { key } })
  if (!existing) return false
  const [state, at] = existing.value.split(":")
  if (state === "PENDING" && Date.now() - Number(at) < CLAIM_STALE_MS) return false
  const res = await prisma.appSetting.updateMany({ where: { key, value: existing.value }, data: { value: pending } })
  return res.count === 1
}

/**
 * Record the outcome on a claim we own.
 * @param key claim row key
 * @param state SENT or UNKNOWN
 */
async function settleClaim(key: string, state: "SENT" | "UNKNOWN"): Promise<void> {
  await prisma.appSetting.update({ where: { key }, data: { value: `${state}:${Date.now()}` } })
}

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
    // One row per family (the newest), so the result is never truncated by other families' attempts.
    distinct: ["resourceId"],
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

  let statements
  try {
    statements = await loadStatements(fy)
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not load giving." }
  }
  const ids = Array.from(statements.keys())
  const [families, sent] = await Promise.all([loadStatementFamilies(ids, false), latestSendByFamily(fy)])
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
        canEmail: f.canEmail,
        lastStatus: last?.status ?? null,
        lastAt: last?.at ?? null,
      }]
    })
    .sort((a, b) => a.familyName.localeCompare(b.familyName))
}

type SendOneArgs = {
  id: number
  fy: number
  uid: ReturnType<typeof actorId>
  church: Parameters<typeof buildStatementModel>[3]
  /** True for an explicit resend (takes over an old claim). */
  force: boolean
  statement: FamilyStatement | undefined
  family: StatementFamily | undefined
}

type SendOneResult = { status: "sent" } | { status: "skipped" } | { status: "failed"; error: string }

/**
 * Claim, render, email and log one family's statement. Never logs the address.
 * @param a family, statement, church letterhead and send options
 */
async function sendOne(a: SendOneArgs): Promise<SendOneResult> {
  const { id, fy, uid, church, statement, family } = a
  if (!statement || !family) return { status: "failed", error: "No giving recorded for this family in the financial year." }
  const to = family.emails[0]
  if (!to) return { status: "failed", error: "No email address on file (or no member has consented to email)." }
  // Claim before sending so concurrent runs can't both email the family. A
  // resend takes over an old claim atomically; it never steals a live one.
  const claimKey = `${CLAIM_PREFIX}${fy}:${id}`
  if (!(await acquireClaim(claimKey, a.force))) return { status: "skipped" }
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
  } catch (e) {
    // Never log the raw error — SMTP messages embed the recipient address.
    logger.error("sendGivingStatements delivery failed", { familyId: id })
    const unknown = isResendAmbiguous(e)
    if (unknown) {
      // The provider may have accepted the mail: keep the claim so a plain retry can't double-send.
      await settleClaim(claimKey, "UNKNOWN")
    } else {
      // Definite failure: release the claim so the family can be retried.
      await prisma.appSetting.deleteMany({ where: { key: claimKey } })
    }
    await logAudit(uid, STATEMENT_FAILED, "Family", id, { fyStartYear: fy, ...(unknown ? { outcome: "unknown" } : {}) })
    return { status: "failed", error: unknown ? "Delivery status unknown; check before resending" : "Email delivery failed" }
  }
  await settleClaim(claimKey, "SENT")
  // Delivered. Audit metadata holds ids and totals only — never the address.
  await logAudit(uid, STATEMENT_SENT, "Family", id, { fyStartYear: fy, totalCents: statement.totalCents })
  return { status: "sent" }
}

/**
 * Email giving statements (PDF) to the chosen families, logging each attempt.
 * One recipient per family: the head of family's address first. Members who
 * opted out of email are never used. ADMIN/PASTOR only.
 * @param year FY start year
 * @param familyIds families to send to (max 200 per batch)
 * Concurrency: each family+FY is claimed with a unique `AppSetting` row
 * (`giving-statement-claim:<fy>:<id>`) before sending; a lost claim counts as skipped.
 * The claim is released on a definite failure and kept on success or ambiguous
 * delivery. A crash mid-send leaves a PENDING claim; once it is stale (15 min) a
 * resend (skipAlreadySent=false) can take it over, atomically.
 * @param skipAlreadySent skip families already claimed/sent for this FY; false forces a resend
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

  let statements
  try {
    statements = await loadStatements(fy, ids)
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not load giving." }
  }
  const families = await loadStatementFamilies(ids)

  let sent = 0
  let failed = 0
  let skipped = 0
  const errors: { familyId: number; error: string }[] = []
  for (const id of ids) {
    // Sequential on purpose: each send claims a row first and the mail provider is rate limited.
    const r = await sendOne({ // NOSONAR
      id, fy, uid, church, force: !skipAlreadySent, statement: statements.get(id), family: families.get(id),
    })
    if (r.status === "sent") sent++
    else if (r.status === "skipped") skipped++
    else {
      failed++
      errors.push({ familyId: id, error: r.error })
    }
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
