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
import { sendGivingStatementEmail, isAmbiguousDeliveryError } from "@/lib/email"
import { centsToNumber } from "@/lib/formatting"
import { isValidPgId, isP2002 } from "@/lib/validation"
import {
  buildStatementModel,
  parseStatementYear,
  type FamilyStatement,
  STATEMENT_SENT,
  STATEMENT_FAILED,
  STATEMENT_SKIPPED,
} from "@/lib/givingStatement"
import { loadStatements, loadStatementSummaries, loadStatementFamilies, type StatementFamily } from "@/lib/givingStatementData"

const LIST_PATH = "/accounting/giving-statements"
const MAX_BATCH = 200
// Cap on send-log rows read per FY (one row per attempt, so this is generous).
const LOG_CAP = 5000
const CLAIM_PREFIX = "giving-statement-claim:"
// A PENDING claim older than this is treated as a crashed run and may be taken over by a forced resend.
const CLAIM_STALE_MS = 15 * 60 * 1000
// Wall-clock cap for one bulk run, so a server action stays inside typical proxy timeouts (~60s). A send
// starts only when it can finish (reload + render + email, capped by SEND_TIMEOUT_MS) inside this budget.
const TIME_BUDGET_MS = 45_000
// One family's reload + render + email may not take longer than this; it is then reported as delivery unknown.
const SEND_TIMEOUT_MS = 20_000
const TIMEOUT_ERROR = "Timed out; delivery status unknown, check before resending"

type ClaimOutcome =
  | { status: "acquired"; pending: string; previous: string | null }
  | { status: "sent" }
  | { status: "in_progress" }

/**
 * Take the per-family+FY send claim. The claim row value tracks its state:
 * `PENDING:<ms>` while sending, `SENT:<ms>` once delivered, `UNKNOWN:<ms>` when
 * delivery is ambiguous. Without `force` only a fresh create wins. With `force` an
 * existing SENT/UNKNOWN/stale-PENDING claim is replaced by an atomic compare-and-swap,
 * so two forced runs (or a forced run and a live sender) can never both win.
 * @param key claim row key
 * @param force true for an explicit resend
 * @returns acquired (with the value to restore if the send fails definitively), or why it was not
 */
async function acquireClaim(key: string, force: boolean): Promise<ClaimOutcome> {
  const pending = `PENDING:${Date.now()}`
  try {
    await prisma.appSetting.create({ data: { key, value: pending } })
    return { status: "acquired", pending, previous: null }
  } catch (e) {
    if (!isP2002(e)) throw e
  }
  const existing = await prisma.appSetting.findUnique({ where: { key } })
  if (!existing) return { status: "in_progress" }
  const [state, at] = existing.value.split(":")
  if (!force) return { status: state === "SENT" ? "sent" : "in_progress" }
  if (state === "PENDING" && Date.now() - Number(at) < CLAIM_STALE_MS) return { status: "in_progress" }
  const res = await prisma.appSetting.updateMany({ where: { key, value: existing.value }, data: { value: pending } })
  return res.count === 1 ? { status: "acquired", pending, previous: existing.value } : { status: "in_progress" }
}

/**
 * Record the outcome on a claim we own (compare-and-swap on our PENDING value, so a stalled
 * worker cannot overwrite a claim a later forced resend has taken over).
 * @param key claim row key
 * @param pending the PENDING value we wrote when acquiring
 * @param state SENT or UNKNOWN
 */
async function settleClaim(key: string, pending: string, state: "SENT" | "UNKNOWN"): Promise<void> {
  await prisma.appSetting.updateMany({ where: { key, value: pending }, data: { value: `${state}:${Date.now()}` } })
}

/**
 * Undo a claim after a definite failure. A fresh claim is deleted; a claim taken over from an
 * earlier SENT/UNKNOWN/stale value is put back (compare-and-swap on our PENDING value) so the
 * duplicate-send guard survives a failed resend.
 * @param key claim row key
 * @param claim the acquired claim
 */
async function releaseClaim(key: string, claim: { pending: string; previous: string | null }): Promise<void> {
  if (claim.previous === null) await prisma.appSetting.deleteMany({ where: { key, value: claim.pending } })
  else await prisma.appSetting.updateMany({ where: { key, value: claim.pending }, data: { value: claim.previous } })
}

/**
 * Run a best-effort bookkeeping step after the email outcome is known. A DB failure here is logged
 * (ids only) and swallowed so it cannot abort the batch or change the reported send result.
 * @param label log label
 * @param familyId family id for the log
 * @param fn the step; resolving to `false` (as `logAudit` does on a swallowed DB error) counts as failed
 * @returns true when the step succeeded, false when it threw or reported failure
 */
async function bestEffort(label: string, familyId: number, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    if ((await fn()) === false) {
      logger.error(`sendGivingStatements ${label} failed`, { familyId })
      return false
    }
    return true
  } catch {
    logger.error(`sendGivingStatements ${label} failed`, { familyId })
    return false
  }
}

/**
 * Run a promise-returning step with a deadline. The step keeps running after a timeout (it cannot be
 * cancelled), so its late outcome is ignored and a late rejection is swallowed.
 * @param work the step
 * @param ms deadline in milliseconds
 * @returns the step's result, or `"timeout"` when the deadline passed first
 */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms)
  })
  work.catch(() => undefined)
  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}

export type StatementListRow = {
  familyId: number
  familyName: string
  giftCount: number
  total: number
  /** True when at least one consenting member has a valid email (and the family is not archived). Addresses never leave the server. */
  canEmail: boolean
  /** Archived family: listed and previewable, never emailed. */
  archived: boolean
  /** Send-claim state: PENDING (in progress or crashed), SENT, UNKNOWN (delivery unconfirmed) or null (none). */
  claim: "PENDING" | "SENT" | "UNKNOWN" | null
  lastStatus: "SENT" | "FAILED" | null
  lastAt: Date | null
}

export type StatementSendResult =
  | {
      sent: number
      failed: number
      skipped: number
      inProgress: number
      errors: { familyId: number; error: string }[]
      /** Families whose send-log row could not be written (the email outcome itself is still counted above). */
      auditFailed: number[]
      /** Families not attempted because the time budget ran out; send them in a follow-up call. */
      remaining: number[]
    }
  | { error: string }

/**
 * Latest send outcome per family for a FY, newest attempt wins. The send log is
 * the audit trail: one row per attempt, resourceId = familyId, metadata.fyStartYear.
 * Grouped in the database (newest per family and action), so at most two rows per
 * family come back however many attempts exist.
 */
async function latestSendByFamily(year: number): Promise<Map<number, { status: "SENT" | "FAILED"; at: Date }>> {
  const rows = await prisma.auditLog.groupBy({
    by: ["resourceId", "action"],
    where: { action: { in: [STATEMENT_SENT, STATEMENT_FAILED] }, metadata: { path: ["fyStartYear"], equals: year } },
    _max: { createdAt: true },
  })
  const out = new Map<number, { status: "SENT" | "FAILED"; at: Date }>()
  for (const r of rows) {
    const at = r._max.createdAt
    if (r.resourceId == null || !at) continue
    const prev = out.get(r.resourceId)
    if (!prev || at > prev.at) out.set(r.resourceId, { status: r.action === STATEMENT_SENT ? "SENT" : "FAILED", at })
  }
  return out
}

/**
 * Send-claim state per family for a FY (one AppSetting row per family; value `STATE:<ms>`).
 * @param year FY start year
 */
async function claimStateByFamily(year: number): Promise<Map<number, "PENDING" | "SENT" | "UNKNOWN">> {
  const prefix = `${CLAIM_PREFIX}${year}:`
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: prefix } }, select: { key: true, value: true } })
  const out = new Map<number, "PENDING" | "SENT" | "UNKNOWN">()
  for (const r of rows) {
    const id = Number(r.key.slice(prefix.length))
    const state = r.value.split(":")[0]
    if (Number.isInteger(id) && (state === "PENDING" || state === "SENT" || state === "UNKNOWN")) out.set(id, state)
  }
  return out
}

/**
 * List every family with giving in the FY, with its total and last send status.
 * Accounting viewers only.
 * @param year FY start year
 */
/**
 * Client-safe message for a failed giving load: only the known gift-cap message
 * passes through; anything else (e.g. Prisma/DB errors) is replaced.
 * @param e - the thrown value
 * @returns message safe to return to the browser
 */
function loadErrorMessage(e: unknown): string {
  return e instanceof Error && e.message.startsWith("Too many gifts") ? e.message : "Could not load giving."
}

export async function listGivingStatements(year: number): Promise<StatementListRow[] | { error: string }> {
  const session = await auth()
  if (!canViewAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("receipts")
  if (off) return off
  const fy = parseStatementYear(year)
  if (fy === null) return { error: "Invalid financial year." }

  let summaries
  try {
    summaries = await loadStatementSummaries(fy)
  } catch (e) {
    return { error: loadErrorMessage(e) }
  }
  const ids = Array.from(summaries.keys())
  const [families, sent, claims] = await Promise.all([loadStatementFamilies(ids, false), latestSendByFamily(fy), claimStateByFamily(fy)])
  return ids
    .flatMap((id) => {
      const f = families.get(id)
      const s = summaries.get(id)
      if (!f || !s) return [] // family row no longer exists
      const last = sent.get(id)
      return [{
        familyId: id,
        familyName: f.name,
        giftCount: s.giftCount,
        total: centsToNumber(s.totalCents),
        canEmail: f.canEmail,
        archived: f.archived,
        claim: claims.get(id) ?? null,
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

type SendOneResult =
  | { status: "sent"; auditFailed: boolean }
  | { status: "skipped"; reason: "sent" | "in_progress" }
  | { status: "failed"; error: string; auditFailed: boolean }

/**
 * Claim, render, email and log one family's statement. Never logs the address.
 * @param a family, statement, church letterhead and send options
 */
async function sendOne(a: SendOneArgs): Promise<SendOneResult> {
  const { id, fy, uid, church, statement, family } = a
  /** Refused before any send: audit it as SKIPPED with a reason code (no address, no PII) and report it. */
  const refuse = async (reason: string, error: string): Promise<SendOneResult> => {
    const logged = await bestEffort("audit", id, () => logAudit(uid, STATEMENT_SKIPPED, "Family", id, { fyStartYear: fy, reason }))
    return { status: "failed", error, auditFailed: !logged }
  }
  if (!family) return refuse("family_not_found", "Family not found.")
  if (!statement) return refuse("no_giving", "No giving recorded for this family in the financial year.")
  if (family.archived) return refuse("archived", "Family is archived; statements are not emailed.")
  const to = family.emails[0]
  if (!to) return refuse("no_email_or_consent", "No email address on file (or no member has consented to email).")
  // Claim before sending so concurrent runs can't both email the family. A
  // resend takes over an old claim atomically; it never steals a live one.
  const claimKey = `${CLAIM_PREFIX}${fy}:${id}`
  const claim = await acquireClaim(claimKey, a.force)
  if (claim.status !== "acquired") return { status: "skipped", reason: claim.status }
  try {
    // Built inside the try so a failure here releases the claim instead of leaving it PENDING.
    const model = buildStatementModel(statement, family.name, fy, church)
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
    const unknown = isAmbiguousDeliveryError(e)
    if (unknown) {
      // The provider may have accepted the mail: keep the claim so a plain retry can't double-send.
      await bestEffort("claim settle", id, () => settleClaim(claimKey, claim.pending, "UNKNOWN"))
    } else {
      // Definite failure: release a fresh claim, or restore the one a resend took over.
      await bestEffort("claim release", id, () => releaseClaim(claimKey, claim))
    }
    const logged = await bestEffort("audit", id, () => logAudit(uid, STATEMENT_FAILED, "Family", id, { fyStartYear: fy, ...(unknown ? { outcome: "unknown" } : {}) }))
    return { status: "failed", error: unknown ? "Delivery status unknown; check before resending" : "Email delivery failed", auditFailed: !logged }
  }
  // Delivered: a bookkeeping failure must not abort the batch or report the family as failed.
  // A claim left PENDING here goes stale and blocks a plain re-run in the meantime.
  await bestEffort("claim settle", id, () => settleClaim(claimKey, claim.pending, "SENT"))
  // Audit metadata holds ids and totals only — never the address.
  const logged = await bestEffort("audit", id, () => logAudit(uid, STATEMENT_SENT, "Family", id, { fyStartYear: fy, totalCents: statement.totalCents }))
  return { status: "sent", auditFailed: !logged }
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
 * `skipped` counts families already sent; `inProgress` those whose claim is PENDING or UNKNOWN (check, then resend)
 * or whose send exceeded the per-send timeout (delivery unknown; the claim stays PENDING).
 * The run stops starting sends after a time budget; unattempted ids come back in `remaining` for a follow-up call.
 * Every refusal (no consent/email, no giving, archived, missing) is audited as SKIPPED (reason code) and every delivery failure as FAILED; families whose
 * audit write failed are listed in `auditFailed` (a send is never reported as logged when its row was not written).
 * A forced resend that fails definitively restores the previous claim rather than deleting it.
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
  // Started before the setup queries so they count toward the time budget.
  const startedAt = Date.now()

  const churchRes = await getChurchSettingsForReceipt()
  if ("error" in churchRes) return { error: churchRes.error }
  const church = churchRes.church

  let statements
  try {
    statements = await loadStatements(fy, ids)
  } catch (e) {
    return { error: loadErrorMessage(e) }
  }

  let sent = 0
  let failed = 0
  let skipped = 0
  let inProgress = 0
  const errors: { familyId: number; error: string }[] = []
  const auditFailed: number[] = []
  const remaining: number[] = []
  for (const id of ids) {
    // Only start a send that can finish inside the budget, so the whole run is bounded (the first id always starts).
    if (Date.now() - startedAt + SEND_TIMEOUT_MS > TIME_BUDGET_MS) {
      remaining.push(id)
      continue
    }
    // Sequential on purpose: each send claims a row first and the mail provider is rate limited.
    // Reload the family right before its send so a consent revoke or archive made mid-batch is honoured.
    // The reload is inside the deadline too, so a hung query cannot stall the run.
    let timed: SendOneResult | "timeout"
    // Set once the deadline passes: a reload that finishes late must not start a send nobody is waiting for.
    let expired = false
    try {
      timed = await withTimeout( // NOSONAR
        (async () => {
          const family = (await loadStatementFamilies([id])).get(id)
          if (expired) return { status: "skipped", reason: "in_progress" } as const
          return sendOne({ id, fy, uid, church, force: !skipAlreadySent, statement: statements.get(id), family })
        })(),
        SEND_TIMEOUT_MS
      )
    } catch {
      // The reload or a claim query threw before any email went out: report this family, keep the batch going.
      logger.error("sendGivingStatements send setup failed", { familyId: id })
      failed++
      errors.push({ familyId: id, error: "Could not prepare the send; try again" })
      continue
    }
    if (timed === "timeout") {
      expired = true
      // The claim (if taken) stays PENDING, so neither a plain nor a forced re-run can send again until it goes stale.
      logger.error("sendGivingStatements send timed out", { familyId: id })
      inProgress++
      errors.push({ familyId: id, error: TIMEOUT_ERROR })
      continue
    }
    const r = timed
    if ("auditFailed" in r && r.auditFailed) auditFailed.push(id)
    if (r.status === "sent") sent++
    else if (r.status === "skipped") {
      if (r.reason === "sent") skipped++
      else inProgress++
    }
    else {
      failed++
      errors.push({ familyId: id, error: r.error })
    }
  }
  revalidatePath(LIST_PATH)
  return { sent, failed, skipped, inProgress, errors, auditFailed, remaining }
}

export type StatementLogRow = {
  id: number
  familyId: number
  familyName: string
  /** SKIPPED = refused before sending (see `reason`); it never counts as a family's last send status. */
  status: "SENT" | "FAILED" | "SKIPPED"
  /** Reason code for a SKIPPED row (family_not_found, no_giving, archived, no_email_or_consent). */
  reason?: string
  at: Date
  sentBy: string
}

/**
 * Pull the reason code off a SKIPPED audit row.
 * @param action audit action
 * @param metadata audit metadata JSON
 * @returns `{ reason }` for a SKIPPED row with a string reason, else `{}`
 */
function skipReason(action: string, metadata: unknown): { reason?: string } {
  if (action !== STATEMENT_SKIPPED || typeof metadata !== "object" || metadata === null) return {}
  const reason = (metadata as { reason?: unknown }).reason
  return typeof reason === "string" ? { reason } : {}
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
    where: { action: { in: [STATEMENT_SENT, STATEMENT_FAILED, STATEMENT_SKIPPED] }, metadata: { path: ["fyStartYear"], equals: fy } },
    orderBy: { createdAt: "desc" },
    take: LOG_CAP,
    select: { id: true, action: true, resourceId: true, metadata: true, createdAt: true, user: { select: { name: true } } },
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
          status: r.action === STATEMENT_SENT ? ("SENT" as const) : r.action === STATEMENT_SKIPPED ? ("SKIPPED" as const) : ("FAILED" as const),
          ...skipReason(r.action, r.metadata),
          at: r.createdAt,
          sentBy: r.user?.name ?? "System",
        }]
  )
}
