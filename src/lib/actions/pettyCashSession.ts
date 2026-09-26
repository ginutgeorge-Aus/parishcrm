"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { canAccessAccounting, isAdmin } from "@/lib/roleGuard"
import { calcRunningBalance } from "@/lib/pettyCashLedger"
import { toCents } from "@/lib/formatting"
import { logAudit } from "@/lib/audit"
import { pettyCashTitle, sessionDateFromTitle } from "@/lib/formatting"
import { MONEY_DECIMAL_RE, isValidPgId } from "@/lib/validation"
import type { ActionResult, ActionResultWithSuccess } from "./types"
import { mostRecentSundayYMD } from "@/lib/dates"
import { getPettyCashDefaultCustodianId } from "./settings"

// --- Session ---

const CreateSessionSchema = z.object({
  sessionDate: z
    .string()
    .max(10, "Invalid date")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  custodianId: z.string().min(1, "Custodian is required").transform((v) => Number(v)),
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

export async function createSession(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const parsed = CreateSessionSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const title = pettyCashTitle(parsed.data.sessionDate)

  // An archived person must not be assignable as custodian.
  const custodian = await prisma.person.findFirst({
    where: { id: parsed.data.custodianId, archivedAt: null },
    select: { id: true },
  })
  if (!custodian) return { error: "Custodian not found" }

  let created
  try {
    created = await prisma.pettyCashSession.create({
      data: {
        title,
        custodianId: parsed.data.custodianId,
        openingBalance: parsed.data.openingBalance,
      },
    })
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2002")
      return { error: `A session for ${title} already exists` }
    throw e
  }
  revalidatePath("/accounting/petty-cash")
  redirect(`/accounting/petty-cash/sessions/${created.id}`)
}

const UpdateCustodianSchema = z.object({
  custodianId: z.string().min(1, "Custodian is required").transform((v) => Number(v)),
})

// Correct the custodian on an existing session (open or closed) — the custodian
// is metadata, not a dated ledger entry, so no accounting-lock check applies.
export async function updateSessionCustodian(
  id: number,
  _prev: ActionResultWithSuccess,
  formData: FormData
): Promise<ActionResultWithSuccess> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }

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

  await prisma.pettyCashSession.update({
    where: { id },
    data: { custodianId: parsed.data.custodianId },
  })
  await logAudit(actorId(session), "PETTY_CASH_SESSION_CUSTODIAN_UPDATED", "PettyCashSession", id, {
    custodianId: parsed.data.custodianId,
  })

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
  return !!(e && typeof e === "object" && "code" in e && e.code === "P2002")
}

export type EnsureWeeklyResult = {
  status: "created" | "exists" | "skipped-no-custodian" | "skipped-missing-custodian" | "not-editor"
}

// Lazy weekly auto-open. Called on every petty-cash page load; only editors
// (ADMIN/PASTOR) mutate. Ensures a session for the most-recent Sunday (Sydney)
// exists, creating one under the configured default custodian if not — seeded
// with the prior session's closing cash-in-hand as its opening balance.
// Idempotent: dedups on the canonical title. This also satisfies the
// "FY always has at least one session" guarantee — every editor visit ensures
// the current Sunday's session. See the design spec.
export async function ensureWeeklySession(): Promise<EnsureWeeklyResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { status: "not-editor" }

  const custodianId = await getPettyCashDefaultCustodianId()
  if (custodianId === null) return { status: "skipped-no-custodian" }

  // An archived person must not be assignable as custodian — if the
  // stored setting already holds an archived person's id (e.g. archived after
  // being set), the auto-open must fail closed exactly as if the custodian
  // row were gone, not silently open a session under them.
  const custodian = await prisma.person.findFirst({ where: { id: custodianId, archivedAt: null }, select: { id: true } })
  if (!custodian) return { status: "skipped-missing-custodian" }

  const title = pettyCashTitle(mostRecentSundayYMD())

  // Dedup by title (any status) — a manually-created or already-auto-created
  // session for that Sunday means we do nothing.
  const existing = await prisma.pettyCashSession.findFirst({ where: { title }, select: { id: true } })
  if (existing) return { status: "exists" }

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
  const thisDate = sessionDateFromTitle(title)!.getTime()
  const candidates = await prisma.pettyCashSession.findMany({
    select: { id: true, title: true, openedAt: true },
  })
  const priorId = findPriorSessionId(candidates, thisDate)
  const prior = priorId
    ? await prisma.pettyCashSession.findUnique({
        where: { id: priorId },
        select: {
          openingBalance: true,
          receipts: { select: { amount: true } },
          expenses: { select: { amount: true } },
          transfers: { select: { amount: true } },
        },
      })
    : null
  const openingBalance = prior
    ? calcRunningBalance(prior.openingBalance, prior.receipts, prior.expenses, prior.transfers)
    : 0

  // The check + create aren't atomic; the @@unique([title]) constraint makes the
  // race safe — a concurrent double-load loses with P2002, which we treat as
  // "already exists" (the winner created it). Rethrow anything else so real
  // failures aren't hidden.
  try {
    const created = await prisma.pettyCashSession.create({
      data: { title, custodianId, openingBalance },
    })
    await logAudit(actorId(session), "PETTY_CASH_SESSION_AUTO_OPENED", "PettyCashSession", created.id, {
      title,
      custodianId,
      openingBalance,
    })
  } catch (e) {
    if (isUniqueViolation(e)) return { status: "exists" }
    throw e
  }

  // No revalidatePath: this runs during the page's server render, where Next.js
  // forbids it. The page lists sessions after this call in the same
  // dynamic render, so the new session already shows.
  return { status: "created" }
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

export async function closeSession(
  id: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const existing = await prisma.pettyCashSession.findUnique({
    where: { id },
    include: {
      receipts: { select: { amount: true } },
      expenses: { select: { amount: true } },
      transfers: { select: { amount: true } },
    },
  })
  if (!existing) return { error: "Session not found" }
  if (existing.status === "CLOSED") return { error: "Session already closed" }
  const parsed = CloseSessionSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  // Optional physical cash count → variance vs the system balance.
  // System balance is recomputed server-side (never trust a client value); a
  // non-zero variance must be explained. Closed sessions are locked, so the
  // stored snapshot can never drift from a later recompute.
  let countedCash: string | null = null
  let closingVariance: string | null = null
  if (parsed.data.countedCash !== undefined) {
    const systemCents = toCents(
      calcRunningBalance(
        existing.openingBalance,
        existing.receipts,
        existing.expenses,
        existing.transfers
      )
    )
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
  const { count } = await prisma.pettyCashSession.updateMany({
    where: { id, status: "OPEN" },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      notes: parsed.data.notes,
      countedCash,
      closingVariance,
    },
  })
  if (count === 0) return { error: "Session already closed" }
  // Always audit the close — it is a state-locking mutation (afterwards all
  // receipts/expenses/transfers are rejected), so who closed it must be on the
  // trail whether or not a physical count was taken. `counted` records
  // which; countedCash/variance are null on a count-less close.
  await logAudit(actorId(session), "PETTY_CASH_SESSION_CLOSED", "PettyCashSession", id, {
    counted: countedCash !== null,
    countedCash,
    variance: closingVariance,
  })
  revalidatePath("/accounting/petty-cash")
  revalidatePath(`/accounting/petty-cash/sessions/${id}`)
  revalidatePath("/") // dashboard open-session count
  redirect("/accounting/petty-cash")
}

export async function deleteSession(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
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
    await prisma.pettyCashSession.delete({ where: { id } })
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2003")
      return { error: "Cannot delete — session has entries. Delete them first." }
    throw e
  }
  await logAudit(actorId(session), "PETTY_CASH_SESSION_DELETED", "PettyCashSession", id, {
    title: existing.title,
  })
  revalidatePath("/accounting/petty-cash")
  revalidatePath("/") // dashboard open-session count
}
