"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting, isAdmin } from "@/lib/roleGuard"
import { calcRunningBalance } from "@/lib/pettyCashLedger"
import { toCents, centsToNumber, pettyCashTitle, sessionDateFromTitle } from "@/lib/formatting"
import { AuditWriteError, auditWriteFailedResult, logAuditGuardedTx } from "@/lib/auditGuard"
import { MONEY_DECIMAL_RE, isP2002, isP2034, isValidPgId, isRealCalendarDate } from "@/lib/validation"
import type { ActionResult, ActionResultWithSuccess } from "./types"
import { mostRecentSundayYMD } from "@/lib/dates"
import { getPettyCashDefaultCustodianId } from "./settings"
import { assertFeature, featureGuard } from "@/lib/featureFlags"
import { encrypt } from "@/lib/crypto"
import { serializableWrite } from "@/lib/serializableWrite"
import type { Prisma } from "@/lib/generated/prisma/client"

// --- Session ---

const CreateSessionSchema = z.object({
  sessionDate: z
    .string()
    .max(10, "Invalid date")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date")
    // The title is built from these digits, so 2025-02-31 would become an
    // impossible "31-FEB-2025" session.
    .refine(isRealCalendarDate, "Invalid date"),
  custodianId: z.string().min(1, "Custodian is required").transform(Number),
  openingBalance: z
    .string()
    .optional()
    // Validate format before parse — the column is Decimal(10,2); 3+ decimals
    // would otherwise reach Postgres and throw at runtime.
    .refine((v) => !v || MONEY_DECIMAL_RE.test(v), "Opening balance: max 2 decimal places")
    // Keep the validated string — Prisma writes it to Decimal exactly; a
    // parseFloat round-trip through binary float is avoidable drift.
    .transform((v) => v || "0")
    .refine((v) => Number.parseFloat(v) >= 0, "Opening balance must be non-negative"),
})

/** Open a petty cash session. ADMIN/PASTOR only. */
export async function createSession(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("pettyCash")
  if (off) return off
  const parsed = CreateSessionSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const title = pettyCashTitle(parsed.data.sessionDate)

  // An archived person must not be assignable as custodian.
  const custodian = await prisma.person.findFirst({
    where: { id: parsed.data.custodianId, archivedAt: null },
    select: { id: true },
  })
  if (!custodian) return { error: "Custodian not found" }

  let created: { id: number }
  try {
    // Audit in the same transaction: opening a session fixes the custodian and
    // opening float, so a session must never exist without its audit row.
    created = await prisma.$transaction(async (tx) => {
      const row = await tx.pettyCashSession.create({
        data: {
          title,
          custodianId: parsed.data.custodianId,
          openingBalance: parsed.data.openingBalance,
        },
      })
      await logAuditGuardedTx(tx, actorId(session), "PETTY_CASH_SESSION_CREATED", "PettyCashSession", row.id, {
        title,
        custodianId: parsed.data.custodianId,
        openingBalance: parsed.data.openingBalance,
      })
      return row
    })
  } catch (e) {
    if (e instanceof AuditWriteError) return auditWriteFailedResult(e, "createSession")
    if (isP2002(e))
      return { error: `A session for ${title} already exists` }
    // Plain (non-retrying) tx: a serialization conflict is a "try again", not a 500.
    if (isP2034(e)) return { error: "Conflict while creating the session — please try again." }
    throw e
  }
  revalidatePath("/accounting/petty-cash")
  redirect(`/accounting/petty-cash/sessions/${created.id}`)
}

const UpdateCustodianSchema = z.object({
  custodianId: z.string().min(1, "Custodian is required").transform(Number),
})

/**
 * Correct the custodian on an existing session (open or closed) — the custodian is metadata, not a
 * dated ledger entry, so no accounting-lock check applies.
 */
export async function updateSessionCustodian(
  id: number,
  _prev: ActionResultWithSuccess,
  formData: FormData
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("pettyCash")
  if (off) return off

  const parsed = UpdateCustodianSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const existing = await prisma.pettyCashSession.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return { error: "Session not found" }

  // An archived person must not be assignable as custodian.
  const custodian = await prisma.person.findFirst({
    where: { id: parsed.data.custodianId, archivedAt: null },
    select: { id: true },
  })
  if (!custodian) return { error: "Custodian not found" }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.pettyCashSession.update({
        where: { id },
        data: { custodianId: parsed.data.custodianId },
      })
      await logAuditGuardedTx(tx, actorId(session), "PETTY_CASH_SESSION_CUSTODIAN_UPDATED", "PettyCashSession", id, {
        custodianId: parsed.data.custodianId,
      })
    })
  } catch (e) {
    if (e instanceof AuditWriteError) return auditWriteFailedResult(e, "updateSessionCustodian")
    if (isP2034(e)) return { error: "Conflict while updating the custodian — please try again." }
    throw e
  }

  revalidatePath(`/accounting/petty-cash/sessions/${id}`)
  revalidatePath("/accounting/petty-cash")
  return { success: "Custodian updated" }
}

// Picks the source session for opening-balance carry-forward: the session
// dated latest but strictly before `thisDate`. openedAt is a deterministic
// tiebreak (titles are unique so dates never actually collide, but keeps the
// choice stable). Returns null if no eligible prior session exists.
function findPriorSessionId(
  candidates: { id: number; title: string; openedAt: Date }[],
  thisDate: number
): number | null {
  let priorId: number | null = null
  let bestDate = -Infinity
  let bestOpenedAt = -Infinity
  for (const c of candidates) {
    const d = sessionDateFromTitle(c.title)
    if (!d) continue
    const t = d.getTime()
    if (t >= thisDate) continue // only sessions dated before this Sunday
    const o = c.openedAt.getTime()
    // Latest date wins; openedAt is a deterministic tiebreak.
    if (t > bestDate || (t === bestDate && o > bestOpenedAt)) {
      bestDate = t
      bestOpenedAt = o
      priorId = c.id
    }
  }
  return priorId
}

// Prisma's unique-violation code — used where a check-then-create/upsert race
// is resolved by treating a concurrent winner's P2002 as "already exists".
function isUniqueViolation(e: unknown): boolean {
  return isP2002(e)
}

export type EnsureWeeklyResult = {
  status: "created" | "exists" | "skipped-no-custodian" | "skipped-missing-custodian" | "not-editor"
  /**
   * True when this Sunday's opening was carried from a prior session that is
   * still OPEN, so the figure can still change. Closing that prior session
   * rolls its final figure into this one (see closeSession).
   */
  provisional?: true
}

/**
 * Lazy weekly auto-open. Called on every petty-cash page load; only editors (ADMIN/PASTOR) mutate.
 * Ensures a session for the most-recent Sunday (Sydney) exists, creating one under the configured
 * default custodian if not — seeded with the prior session's closing cash-in-hand as its opening
 * balance. Idempotent: dedups on the canonical title. This also satisfies the "FY always has at
 * least one session" guarantee — every editor visit ensures the current Sunday's session. See the
 * design spec.
 */
export async function ensureWeeklySession(): Promise<EnsureWeeklyResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { status: "not-editor" }
  await assertFeature("pettyCash")

  const custodianId = await getPettyCashDefaultCustodianId()
  if (custodianId === null) return { status: "skipped-no-custodian" }

  // An archived person must not be assignable as custodian — if the
  // stored setting already holds an archived person's id (e.g. archived after
  // being set), the auto-open must fail closed exactly as if the custodian
  // row were gone, not silently open a session under them.
  const custodian = await prisma.person.findFirst({ where: { id: custodianId, archivedAt: null }, select: { id: true } })
  if (!custodian) return { status: "skipped-missing-custodian" }

  const title = pettyCashTitle(mostRecentSundayYMD())
  const thisDate = sessionDateFromTitle(title)!.getTime()

  // Dedup by title (any status) — a manually-created or already-auto-created
  // session for that Sunday means we do nothing.
  const existing = await prisma.pettyCashSession.findFirst({ where: { title }, select: { id: true, status: true } })
  if (existing) {
    // Keep the "provisional" notice up on every load until last week is closed — but only
    // for an OPEN session auto-opened from that prior one. A manual, closed or legacy
    // (no provenance) session never gets rolled forward, so the notice would be a false promise.
    if (existing.status !== "OPEN") return { status: "exists" }
    // Read the source from THIS session's own AUTO_OPENED row, not the date-nearest session:
    // a later-backfilled manual session between the dates must not hide the real source.
    const autoOpened = await prisma.auditLog.findFirst({
      where: { action: "PETTY_CASH_SESSION_AUTO_OPENED", resourceType: "PettyCashSession", resourceId: existing.id },
      orderBy: { id: "desc" },
      select: { metadata: true },
    })
    const meta = autoOpened?.metadata as { carriedFromSessionId?: unknown } | null | undefined
    const sourceId = meta?.carriedFromSessionId
    if (typeof sourceId !== "number") return { status: "exists" }
    const source = await prisma.pettyCashSession.findUnique({ where: { id: sourceId }, select: { status: true } })
    return source?.status === "OPEN" ? { status: "exists", provisional: true } : { status: "exists" }
  }

  // Carry the prior session's closing cash-in-hand forward as this session's
  // opening balance. Auto-opened sessions used to start at zero, so any
  // un-transferred float was silently dropped — systematically understating
  // calcRunningBalance (negative-float/overdraw guards, close-time variance) and
  // producing spurious close variances that reflect a missing carry-forward, not
  // a real discrepancy.
  //
  // Pick the source by SESSION (accounting) date, not openedAt:
  // backfilling an older-dated session after a newer one gives it a newer
  // openedAt, so an openedAt sort would wrongly make that late historical
  // session the float source. The date is derived from the unique title
  // (DD-MMM-YYYY) — titles are 1:1 with dates — and we take the session dated
  // latest but strictly before this Sunday. Session count is weekly-bounded, so
  // scanning titles in memory is cheap.
  // The prior read and the create share ONE Serializable transaction: closeSession
  // writes the prior's status and reads the AUTO_OPENED row this writes, so a close
  // racing this auto-open forms a cycle and one side retries against committed
  // state — the new session never keeps a pre-close opening that no roll-forward fixes.
  // The title check + create aren't atomic; the @@unique([title]) constraint makes the
  // race safe — a concurrent double-load loses with P2002, which we treat as
  // "already exists" (the winner created it). Rethrow anything else so real
  // failures aren't hidden.
  let provisional = false
  try {
    const outcome = await serializableWrite<{ ok: true }>(async (tx) => {
      const candidates = await tx.pettyCashSession.findMany({
        select: { id: true, title: true, openedAt: true },
      })
      const priorId = findPriorSessionId(candidates, thisDate)
      const prior = priorId
        ? await tx.pettyCashSession.findUnique({
            where: { id: priorId },
            select: {
              status: true,
              countedCash: true,
              openingBalance: true,
              receipts: { select: { amount: true } },
              expenses: { select: { amount: true } },
              transfers: { select: { amount: true } },
            },
          })
        : null
      // AUD-3-04: a CLOSED prior with a physical count opens from the count — that is
      // the cash actually in the tin (pending PO confirmation, #3341). Without a count,
      // or while the prior is still OPEN, use its running balance; an OPEN prior makes
      // the figure provisional until its close rolls the final one forward.
      provisional = prior?.status === "OPEN"
      let openingBalance = 0
      if (prior) {
        openingBalance =
          prior.status === "CLOSED" && prior.countedCash !== null
            ? centsToNumber(toCents(prior.countedCash))
            : calcRunningBalance(prior.openingBalance, prior.receipts, prior.expenses, prior.transfers)
      }
      const created = await tx.pettyCashSession.create({
        data: { title, custodianId, openingBalance },
      })
      // carriedFromSessionId marks this opening as auto-derived from that session,
      // so closing it later may roll its final figure in (no manual override).
      await logAuditGuardedTx(tx, actorId(session), "PETTY_CASH_SESSION_AUTO_OPENED", "PettyCashSession", created.id, {
        title,
        custodianId,
        openingBalance,
        ...(priorId ? { carriedFromSessionId: priorId } : {}),
        ...(provisional ? { provisional: true } : {}),
      })
      return { ok: true }
    }, { error: "busy" })
    // Every attempt conflicted: the session rolled back; render without it, the next load retries.
    if ("error" in outcome) return { status: "exists" }
  } catch (e) {
    if (isUniqueViolation(e)) return { status: "exists" }
    // This runs during the page's server render: a failing audit insert (rolled the
    // session back) must not make every visit throw. Log it and render without the
    // auto-opened session; the next load retries.
    if (isP2034(e)) return { status: "exists" }
    if (e instanceof AuditWriteError) {
      auditWriteFailedResult(e, "ensureWeeklySession")
      return { status: "exists" }
    }
    throw e
  }

  // No revalidatePath: this runs during the page's server render, where Next.js
  // forbids it. The page lists sessions after this call in the same
  // dynamic render, so the new session already shows.
  return provisional ? { status: "created", provisional: true } : { status: "created" }
}

const CloseSessionSchema = z.object({
  notes: z.string().max(2000, "Notes too long").optional().transform((v) => v?.trim() || undefined),
  countedCash: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined))
    .refine((v) => v === undefined || MONEY_DECIMAL_RE.test(v), "Counted cash: max 2 decimal places")
    .refine((v) => v === undefined || toCents(v) >= 0, "Counted cash must be zero or more"),
})

type ClosingSession = { id: number; title: string }

/**
 * AUD-3-04: after session N closes, carry its final figure into the next session's
 * opening balance — but only when that next session is still OPEN and was
 * auto-opened from N (its AUTO_OPENED audit row names N as carriedFromSessionId).
 * A manually opened session keeps its typed-in opening; a closed one is locked.
 * Runs inside the close transaction so the close, the update and its audit row
 * commit or roll back together.
 * @param finalCents counted cash when the close took a count, else the system balance
 */
async function rollOpeningForward(
  tx: Prisma.TransactionClient,
  userId: number | null,
  closing: ClosingSession,
  finalCents: number,
  basis: "counted" | "system",
): Promise<void> {
  // Find the recipient through its recorded provenance, not by date: a manual session
  // backfilled between the two weeks must not hide the auto-opened successor.
  const carried = await tx.auditLog.findFirst({
    where: {
      action: "PETTY_CASH_SESSION_AUTO_OPENED",
      resourceType: "PettyCashSession",
      metadata: { path: ["carriedFromSessionId"], equals: closing.id },
    },
    orderBy: { id: "desc" },
    select: { resourceId: true },
  })
  const nextId = carried?.resourceId
  if (nextId == null) return
  const next = await tx.pettyCashSession.findUnique({
    where: { id: nextId },
    select: { status: true, openingBalance: true },
  })
  if (next?.status !== "OPEN") return
  const oldCents = toCents(next.openingBalance)
  if (oldCents === finalCents) return
  const newOpeningBalance = (finalCents / 100).toFixed(2)
  await tx.pettyCashSession.update({ where: { id: nextId }, data: { openingBalance: newOpeningBalance } })
  await logAuditGuardedTx(tx, userId, "PETTY_CASH_SESSION_OPENING_ROLLED_FORWARD", "PettyCashSession", nextId, {
    fromSessionId: closing.id,
    oldOpeningBalance: (oldCents / 100).toFixed(2),
    newOpeningBalance,
    basis,
  })
}

/** Close a petty cash session. ADMIN/PASTOR only. */
export async function closeSession(
  id: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("pettyCash")
  if (off) return off
  // Fast-path checks only; the figures are re-read inside the close transaction.
  const existing = await prisma.pettyCashSession.findUnique({ where: { id }, select: { status: true } })
  if (!existing) return { error: "Session not found" }
  if (existing.status === "CLOSED") return { error: "Session already closed" }
  const parsed = CloseSessionSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const userId = actorId(session)

  let result: { error: string } | null
  try {
    // Serializable: the system balance (variance, roll-forward) is read in the same
    // transaction as the close, so an entry posted concurrently either lands before
    // the read or the close aborts and retries — the stored variance can't be stale.
    result = await serializableWrite<{ error: string } | null>(async (tx) => {
      const current = await tx.pettyCashSession.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          status: true,
          openingBalance: true,
          receipts: { select: { amount: true } },
          expenses: { select: { amount: true } },
          transfers: { select: { amount: true } },
        },
      })
      if (!current) return { error: "Session not found" }
      if (current.status === "CLOSED") return { error: "Session already closed" }

      // Optional physical cash count → variance vs the system balance.
      // System balance is recomputed server-side (never trust a client value); a
      // non-zero variance must be explained. Closed sessions are locked, so the
      // stored snapshot can never drift from a later recompute.
      const systemCents = toCents(
        calcRunningBalance(current.openingBalance, current.receipts, current.expenses, current.transfers)
      )
      let countedCash: string | null = null
      let closingVariance: string | null = null
      if (parsed.data.countedCash !== undefined) {
        const varianceCents = toCents(parsed.data.countedCash) - systemCents
        if (varianceCents !== 0 && !parsed.data.notes)
          return { error: "Explain the variance — counted cash differs from the system balance." }
        countedCash = parsed.data.countedCash
        closingVariance = (varianceCents / 100).toFixed(2)
      }

      // Atomic close: only transition a still-OPEN row. Two admins closing the same
      // session concurrently both pass the read-check above (both read OPEN); the
      // conditional updateMany lets exactly one win — the loser matches no row and
      // is told the session is already closed, so it can't overwrite the earlier,
      // already-audited close (countedCash/variance/notes/closedAt).
      const { count } = await tx.pettyCashSession.updateMany({
        where: { id, status: "OPEN" },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          // Free text that can name people — encrypt at rest (read via safeDecrypt).
          notes: parsed.data.notes ? encrypt(parsed.data.notes) : undefined,
          countedCash,
          closingVariance,
        },
      })
      if (count === 0) return { error: "Session already closed" }
      // Always audit the close — it is a state-locking mutation (afterwards all
      // receipts/expenses/transfers are rejected), so who closed it must be on the
      // trail whether or not a physical count was taken. `counted` records
      // which; countedCash/variance are null on a count-less close.
      await logAuditGuardedTx(tx, userId, "PETTY_CASH_SESSION_CLOSED", "PettyCashSession", id, {
        counted: countedCash !== null,
        countedCash,
        variance: closingVariance,
      })
      await rollOpeningForward(
        tx,
        userId,
        current,
        countedCash !== null ? toCents(countedCash) : systemCents,
        countedCash !== null ? "counted" : "system",
      )
      return null
    }, { error: "Close conflict — please try again." })
  } catch (e) {
    if (e instanceof AuditWriteError) return auditWriteFailedResult(e, "closeSession")
    throw e
  }
  if (result) return result
  revalidatePath("/accounting/petty-cash")
  revalidatePath(`/accounting/petty-cash/sessions/${id}`)
  revalidatePath("/") // dashboard open-session count
  redirect("/accounting/petty-cash")
}

/** Delete a petty cash session. ADMIN only. */
export async function deleteSession(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("pettyCash")
  if (off) return off
  if (!isValidPgId(id)) return { error: "Invalid ID" }
  const existing = await prisma.pettyCashSession.findUnique({
    where: { id },
    include: { _count: { select: { receipts: true, expenses: true, transfers: true } } },
  })
  if (!existing) return { error: "Session not found" }
  if (existing.status === "CLOSED") return { error: "Cannot delete a closed session" }
  const entries = existing._count.receipts + existing._count.expenses + existing._count.transfers
  if (entries > 0)
    return { error: `Cannot delete — session has ${entries} entry(ies). Delete them first.` }
  // No ATO retention gate here ( review): deleteSession only ever runs on
  // a session with ZERO entries (blocked above otherwise), so an empty session
  // holds no financial record to retain. Retention stays on the dated ledger
  // rows — deleteReceipt/deleteExpense/deleteTransfer.
  // The count check and delete aren't atomic — an entry inserted in the race
  // window makes delete hit a FK violation (P2003). Catch it and return the
  // same clean error rather than a raw 500.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.pettyCashSession.delete({ where: { id } })
      await logAuditGuardedTx(tx, actorId(session), "PETTY_CASH_SESSION_DELETED", "PettyCashSession", id, {
        title: existing.title,
      })
    })
  } catch (e) {
    if (e instanceof AuditWriteError) return auditWriteFailedResult(e, "deleteSession")
    if (e && typeof e === "object" && "code" in e && e.code === "P2003")
      return { error: "Cannot delete — session has entries. Delete them first." }
    // Plain (non-retrying) tx: a P2034 passed through by logAuditGuardedTx is a "try again", not a 500.
    if (isP2034(e)) return { error: "Conflict while deleting — please try again." }
    throw e
  }
  revalidatePath("/accounting/petty-cash")
  revalidatePath("/") // dashboard open-session count
}
