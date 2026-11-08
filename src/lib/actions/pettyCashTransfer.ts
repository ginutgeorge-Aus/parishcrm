"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { redirect } from "next/navigation"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/lib/generated/prisma/client"
import { canAccessAccounting, isAdmin } from "@/lib/roleGuard"
import { calcRunningBalance } from "@/lib/pettyCashLedger"
import { toCents } from "@/lib/formatting"
import { encrypt, decrypt } from "@/lib/crypto"
import { logAudit, logAuditTx } from "@/lib/audit"
import { assertUnlocked, getAccountingLockDate, isDateLocked } from "@/lib/accountingLock"
import { retentionFloor, retentionError } from "@/lib/retention"
import { ADOPTION_ERRORS, adoptionProblem, legsByDepositRef } from "@/lib/pettyCashAdoption"
import { xferOutRef, XFER_OUT_PREFIX, XFER_WINDOW_MS, WINDOW_GUARD_TAG } from "@/lib/xferRefs"
import { MONEY_DECIMAL_RE, isP2002, isP2034, parseRouteId } from "@/lib/validation"
import { getXferAccountId } from "@/lib/xferAccount"
import { getCashAccount } from "@/lib/paymentAccounts"
import type { ActionResult } from "./types"
import { revalidatePettyCashPaths, RECONCILED_DELETE_ERROR, assertSessionOpenTx, SessionClosedError } from "./pettyCashEntry"
import { featureGuard } from "@/lib/featureFlags"
import { utcDayRange, utcYmd } from "@/lib/dates"

/** Rejection for a manual transfer that would double-count an imported cash-out already adopted by another transfer (#492). */
const DUPLICATE_ADOPTED_LEG_ERROR =
  "An imported deposit for this amount and date is already recorded as a petty cash transfer. Check the session's transfers before adding another. If this is a separate deposit, use a different date."

/**
 * Rejection for adopting a legacy (null funding source) imported cash-out when a manual transfer already mirrors the same amount and day.
 * @param transferId the existing transfer whose `PC_T_` mirror matched (null if its link is missing)
 * @returns the user-facing message naming that transfer
 */
function legacyMirrorError(transferId: number | null): string {
  const which = transferId === null ? "A petty cash transfer" : `Petty cash transfer #${transferId}`
  return `${which} for this amount and date is already recorded. Adopting this imported deposit as well would count the cash-out twice. Delete that transfer first if it is the same deposit, or use a different date.`
}

/** Rejection for a manual transfer that would double-count an unlinked imported cash-out. */
const DUPLICATE_LEG_ERROR =
  "An imported cash-out for this amount and date already exists. If it is already reconciled, un-reconcile it first, then pick the imported deposit in the form instead of entering it manually. If the deposit is not in the list (it shows only the newest deposits), use the \"Look up deposits for the date and amount entered\" link under the picker."

/**
 * Rejection for a manual transfer when an unlinked imported cash-out matches but its deposit was re-dated to a
 * different day than the cash-out (#562). The picker and adoption both require deposit day = cash-out day = transfer
 * day, so the deposit cannot be picked and setting the date would not help; the carrying tag lets an ADMIN override.
 * @param legDay the cash-out's UTC day (YYYY-MM-DD)
 * @param depositDay the re-dated deposit's UTC day (YYYY-MM-DD)
 * @returns the user-facing message naming both days
 */
function redatedDepositError(legDay: string, depositDay: string): string {
  return `An imported cash-out for this amount on ${legDay} ${WINDOW_GUARD_TAG} already booked its petty cash cash-out, but its deposit was re-dated to ${depositDay}, so it cannot be picked in the form. If this transfer is that deposit, restore the deposit's date to ${legDay} and pick it; otherwise ask an admin to record this transfer anyway.`
}

/**
 * Rejection for a manual transfer within the bank import's mirror window of an unlinked imported
 * cash-out on a different day (#487 item 1).
 * @param depositDay the imported deposit's UTC day (YYYY-MM-DD)
 * @returns the user-facing message naming that day
 */
function windowLegError(depositDay: string): string {
  return `An imported deposit for this amount on ${depositDay} ${WINDOW_GUARD_TAG} already booked its petty cash cash-out, so entering it manually would count it twice. If this transfer is that deposit, set the date to ${depositDay} and pick the imported deposit in the form (un-reconcile its cash-out first if needed). If it is a separate deposit, record the imported one first by picking it, then enter this one.`
}

// Thrown inside the createTransfer Serializable transaction to surface a
// validation failure as a clean ActionResult error (caught just outside).
class TransferError extends Error {}

// Thrown inside the createTransfer transaction when the submission token already
// belongs to a committed transfer (#491): the earlier attempt succeeded, so the
// retry just lands on the session page instead of booking a second transfer.
class AlreadySubmitted extends Error {}

/** Shown when a reused token carries a different transfer (e.g. Back restored the old form). */
const TOKEN_REUSED_ERROR = "This form was already submitted — reload the page to enter a new transfer"

/** Outcome of a token lookup: unused, a true replay of the same transfer, or reused for a different one. */
type TokenState = "unused" | "replay" | "reused"

/** The submitted transfer fields compared against a stored transfer to decide replay vs reuse. */
type TokenSubmission = {
  sessionId: number
  amount: string
  date: Date
  retainedFloat: string
  depositSlipRef?: string
  depositedByName: string
  notes?: string
  importedTransactionId?: number
}

/**
 * Looks up the transfer already carrying this form submission token (#491).
 * "replay" only when every persisted field of the submission matches the stored
 * transfer (session, amount, date, retained float, slip ref, depositor, notes and
 * the adopted imported deposit): Back/forward can restore a cached form with its
 * old token, and an edited transfer entered there must not be silently dropped —
 * that is "reused". Used inside the createTransfer transaction (pre-check) and
 * after a P2002/P2034 (two concurrent submits of one token — the loser checks
 * whether the winner committed).
 */
async function tokenState(
  db: Pick<Prisma.TransactionClient, "pettyCashTransfer" | "transaction">,
  token: string,
  sub: TokenSubmission,
): Promise<TokenState> {
  const prior = await db.pettyCashTransfer.findUnique({
    where: { submissionToken: token },
    select: {
      id: true, sessionId: true, amount: true, date: true, retainedFloat: true,
      depositSlipRef: true, depositedByName: true, notes: true,
    },
  })
  if (!prior) return "unused"
  const same =
    prior.sessionId === sub.sessionId &&
    toCents(String(prior.amount)) === toCents(sub.amount) &&
    new Date(prior.date).getTime() === sub.date.getTime() &&
    toCents(String(prior.retainedFloat ?? "0")) === toCents(sub.retainedFloat) &&
    (prior.depositSlipRef ?? undefined) === sub.depositSlipRef &&
    decrypt(prior.depositedByName) === sub.depositedByName &&
    (prior.notes ? decrypt(prior.notes) : undefined) === sub.notes
  if (!same) return "reused"
  // The picked imported deposit is not stored on the transfer; its adopted XFER_OUT
  // leg is linked to it instead. A manual submit must find no adopted leg.
  const adopted = await db.transaction.findFirst({
    where: { pettyCashTransferId: prior.id, bankRef: { startsWith: XFER_OUT_PREFIX } },
    select: { bankRef: true },
  })
  if (sub.importedTransactionId === undefined) return adopted ? "reused" : "replay"
  const deposit = await db.transaction.findUnique({
    where: { id: sub.importedTransactionId },
    select: { bankRef: true },
  })
  return deposit?.bankRef && adopted?.bankRef === xferOutRef(deposit.bankRef) ? "replay" : "reused"
}

// --- Transfers ---

// Transfers keep a user-entered date (unlike receipts/expenses, which are forced
// to the session date) — a bank deposit can happen days after the session.
const TransferSchema = z.object({
  date: z
    .string()
    .min(1, "Date is required")
    .transform((v) => new Date(v))
    // Zod does not validate transform output — a malformed string yields an
    // Invalid Date (NaN) that Postgres rejects with an unhandled 500.
    .refine((d) => !Number.isNaN(d.getTime()), "Invalid date"),
  amount: z
    .string()
    .min(1, "Amount is required")
    // Reject >2dp before parse — the column is Decimal(10,2) and the value is
    // mirrored to the Transaction ledger; silent truncation would corrupt
    // reconciliation (matches openingBalance).
    .refine((v) => MONEY_DECIMAL_RE.test(v), "Amount: max 2 decimal places")
    // Pass the validated string straight to Prisma's Decimal column — never
    // parseFloat into a JS number, which can lose precision on large amounts
    // before storage (matches transaction.ts policy).
    .refine((v) => toCents(v) > 0, "Amount must be positive"),
  retainedFloat: z
    .string()
    .optional()
    .transform((v) => v?.trim() || "0")
    .refine((v) => MONEY_DECIMAL_RE.test(v), "Retained float must be a non-negative amount"),
  depositSlipRef: z.string().max(100).optional().transform((v) => v || undefined),
  depositedByName: z.string().min(1, "Deposited by is required").max(200),
  notes: z.string().max(1000).optional().transform((v) => v || undefined),
  // Bank-import deposit (marked "from petty cash") this transfer records.
  importedTransactionId: z
    .string()
    .optional()
    // Strict digits-only parse: Number() would accept "0x10", "1e1" or " 12 ".
    .transform((v) => (v ? (parseRouteId(v) ?? NaN) : undefined))
    .refine((v) => v === undefined || !Number.isNaN(v), "Invalid imported deposit"),
  // ADMIN-only bypass of the cross-day window guard (never the same-day duplicate guard).
  // Parsed here so it is validated like every other field; honoured only for admins in the action.
  overrideWindowGuard: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  // Per-page-load idempotency token from the form (#491). Optional so older
  // clients / direct callers still work, just without replay protection.
  submissionToken: z
    .string()
    .max(100)
    .optional()
    .transform((v) => v?.trim() || undefined),
})

/**
 * Record a petty cash transfer. ADMIN/PASTOR only. A replayed submission (same
 * form `submissionToken` as a committed transfer) redirects to the session
 * without creating a duplicate (#491). An ADMIN may set `overrideWindowGuard=true`
 * to record a separate deposit despite the cross-day window guard; the same-day
 * duplicate guard is never overridable, and the override is audit-logged.
 */
export async function createTransfer(
  sessionId: number,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await auth()
  if (!canAccessAccounting(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("pettyCash")
  if (off) return off
  const parsed = TransferSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const transferLockError = await assertUnlocked(parsed.data.date)
  if (transferLockError) return { error: transferLockError }

  // Resolve the shared XFER account before the Serializable transaction — its
  // self-heal create would otherwise risk a serialization conflict.
  // Resolved once, not per row — same reasoning; independent lookups run in parallel.
  const [xferAccountId, cashAccount] = await Promise.all([getXferAccountId(prisma), getCashAccount()])

  // Read balance, validate and insert inside one Serializable transaction so two
  // concurrent transfers can't both pass the same balance check and together
  // overdraw the float — the second hits a serialization conflict.
  // The same Serializable level orders this against confirmBankImport's
  // petty-cash pair write (#493), which is Serializable too: a concurrent import
  // of this deposit and this manual transfer can't both commit a cash-out.
  const token = parsed.data.submissionToken
  // Server-side role check: a non-admin sending the field is silently ignored.
  const windowOverride = parsed.data.overrideWindowGuard && isAdmin(session?.user?.role)
  let windowOverridden = false
  const sub: TokenSubmission = {
    sessionId,
    amount: parsed.data.amount,
    date: parsed.data.date,
    retainedFloat: parsed.data.retainedFloat,
    depositSlipRef: parsed.data.depositSlipRef,
    depositedByName: parsed.data.depositedByName,
    notes: parsed.data.notes,
    importedTransactionId: parsed.data.importedTransactionId,
  }
  /** Revalidate and land on the session page — the replayed transfer already committed. */
  const replayDone = () => {
    revalidatePettyCashPaths(sessionId)
    return redirect(`/accounting/petty-cash/sessions/${sessionId}`)
  }
  try {
    await prisma.$transaction(async (tx) => {
      // A Serializable retry re-runs this callback: don't carry the flag over from an aborted attempt.
      windowOverridden = false
      // Replay check first: the earlier attempt already reduced the balance, so
      // the balance check below would otherwise reject the retry misleadingly.
      if (token) {
        const state = await tokenState(tx, token, sub)
        if (state === "replay") throw new AlreadySubmitted()
        if (state === "reused") throw new TransferError(TOKEN_REUSED_ERROR)
      }
      const existing = await tx.pettyCashSession.findUnique({
        where: { id: sessionId },
        include: {
          receipts: { select: { amount: true } },
          expenses: { select: { amount: true } },
          transfers: { select: { amount: true } },
        },
      })
      if (!existing) throw new TransferError("Session not found")
      if (existing.status === "CLOSED") throw new TransferError("Session is closed")
      const balance = calcRunningBalance(
        existing.openingBalance,
        existing.receipts,
        existing.expenses,
        existing.transfers
      )
      if (toCents(parsed.data.amount) > toCents(balance))
        throw new TransferError(`Transfer amount exceeds balance of ${balance.toFixed(2)}`)
      // Imported deposit picked: adopt its already-booked XFER_OUT cash-out leg
      // as this transfer's ledger mirror — creating a second one would reduce
      // petty cash twice. All validation runs before any write.
      let adoptLegId: number | null = null
      let adoptLegLegacy = false
      if (parsed.data.importedTransactionId !== undefined) {
        const deposit = await tx.transaction.findUnique({
          where: { id: parsed.data.importedTransactionId },
          select: { accountId: true, type: true, amount: true, date: true, bankRef: true },
        })
        const leg =
          deposit?.bankRef
            ? await tx.transaction.findUnique({
                where: { bankRef: xferOutRef(deposit.bankRef) },
                select: { id: true, type: true, accountId: true, amount: true, date: true, paymentAccountId: true, pettyCashTransferId: true, reconciled: true },
              })
            : null
        const problem = adoptionProblem(deposit, leg, { amount: parsed.data.amount, date: parsed.data.date }, {
          xferAccountId, cashAccountId: cashAccount?.id ?? null,
        })
        if (problem) throw new TransferError(ADOPTION_ERRORS[problem])
        adoptLegLegacy = leg!.paymentAccountId === null
        if (adoptLegLegacy) {
          // A manual transfer recorded before the cash account existed (or before the #487 guard matched null legs)
          // may already mirror this deposit's cash-out as PC_T_<id>; adopting too would reduce petty cash twice.
          // The mirror carries no link to the leg, so match on amount + UTC day and refuse rather than guess.
          const mirror = await tx.transaction.findFirst({
            where: {
              accountId: xferAccountId, type: "EXPENSE", bankRef: { startsWith: "PC_T_" },
              amount: parsed.data.amount, date: utcDayRange(parsed.data.date),
            },
            select: { pettyCashTransferId: true },
          })
          if (mirror) throw new TransferError(legacyMirrorError(mirror.pettyCashTransferId))
        }
        adoptLegId = leg!.id
      } else {
        // Manual transfer: an unlinked bank-import XFER_OUT leg for the same amount and
        // day is probably this very deposit — a second cash-out would reduce petty cash
        // twice. Reject and point the user at the imported-deposit picker — but only when
        // the leg's paired deposit (same amount + day) exists. A reconciled leg still
        // counts: it already reduced the cash balance, so the user must un-reconcile it and
        // pick the deposit. Without a paired deposit the picker can't offer the leg, so
        // manual entry stays the only path. A leg already adopted by another transfer
        // (#492) counts too, so recording the same deposit manually after adopting it
        // is rejected; that case has no picker path, so it gets its own message.
        // #487 item 1: legs are read across the bank import's ±7-day mirror window, not just the
        // transfer's day. The import suppresses its own leg when a same-amount transfer mirror lies in
        // that window; this is the converse, so an import that committed first (on a different day)
        // is caught too. It also makes the race symmetric: both Serializable transactions now read
        // the range the other writes into, so Postgres SSI aborts one (the import retries and skips).
        // Different-day legs only count while unlinked: an adopted leg's deposit is already paired with
        // a transfer, so a same-amount transfer days later is a separate deposit (#492 stays same-day).
        const transferDay = utcYmd(parsed.data.date)
        // Centre the window on the UTC-midnight day, not the raw timestamp: a date with a time component
        // would otherwise shift the window and miss a leg exactly 7 days away.
        const t = utcDayRange(parsed.data.date).gte.getTime()
        const windowRange = { gte: new Date(t - XFER_WINDOW_MS), lte: new Date(t + XFER_WINDOW_MS) }
        const legs = await tx.transaction.findMany({
          where: {
            accountId: xferAccountId,
            type: "EXPENSE",
            bankRef: { startsWith: XFER_OUT_PREFIX },
            // Null too: legacy legs written before a cash account existed (#487).
            OR: [{ paymentAccountId: null }, ...(cashAccount ? [{ paymentAccountId: cashAccount.id }] : [])],
            amount: parsed.data.amount,
            date: windowRange,
          },
          select: { bankRef: true, pettyCashTransferId: true, date: true },
        })
        // Read the lock inside this transaction so a retry or a concurrent lock change is never stale (#562).
        const lockDate = await getAccountingLockDate(tx)
        // Legs in a locked period can't be un-reconciled or re-dated, so neither remedy in windowLegError
        // would work: skip them rather than dead-end the user (the transfer date itself is unlocked).
        // Deferred (#562): this skip leaves no audit trace / admin override flag.
        const legByDepositRef = legsByDepositRef(legs.filter((l) => !isDateLocked(l.date, lockDate)), transferDay)
        const dups = legByDepositRef.size
          ? await tx.transaction.findMany({
              where: {
                accountId: xferAccountId,
                type: "INCOME",
                bankRef: { in: [...legByDepositRef.keys()] },
                amount: parsed.data.amount,
              },
              select: { bankRef: true, date: true },
            })
          : []
        if (dups.length) {
          // bankRef is unique and legByDepositRef is keyed by it, so every dup has a leg. The deposit is matched
          // on bankRef + amount only (no date window): its date may have been edited after import. `adoptable`
          // mirrors the picker/adoptionProblem rule (deposit day = cash-out day); a re-dated deposit is not,
          // so telling the user to "pick the imported deposit" would dead-end them (#562).
          const kinds = dups.map((d) => {
            const leg = legByDepositRef.get(d.bankRef!)!
            const depositDay = utcYmd(d.date)
            return { ...leg, depositDay, adoptable: depositDay === leg.day }
          })
          // Same-day unlinked first: the picker resolves it with the date as entered. Then a
          // different-day unlinked leg (re-date + pick), then a same-day adopted one (#492).
          if (kinds.some((k) => k.sameDay && !k.linked && k.adoptable)) throw new TransferError(DUPLICATE_LEG_ERROR)
          const other = kinds.find((k) => !k.linked)
          // The window guard alone is admin-overridable (e.g. fixed recurring weekly deposits). A re-dated
          // deposit (not adoptable even on the same day) gets the same override instead of a dead end.
          if (other && !windowOverride)
            throw new TransferError(other.adoptable ? windowLegError(other.depositDay) : redatedDepositError(other.day, other.depositDay))
          if (other) windowOverridden = true
          if (kinds.some((k) => k.linked)) throw new TransferError(DUPLICATE_ADOPTED_LEG_ERROR)
        }
      }
      const transfer = await tx.pettyCashTransfer.create({
        data: {
          sessionId,
          date: parsed.data.date,
          amount: parsed.data.amount,
          retainedFloat: parsed.data.retainedFloat,
          depositSlipRef: parsed.data.depositSlipRef,
          // depositedByName + notes are PII-bearing free text — encrypt at rest
          depositedByName: encrypt(parsed.data.depositedByName),
          notes: parsed.data.notes ? encrypt(parsed.data.notes) : null,
          submissionToken: token ?? null,
        },
      })
      if (adoptLegId !== null) {
        await tx.transaction.update({
          where: { id: adoptLegId },
          // Link only: the leg's own reference is never touched, so unlink needs no restore.
          // A legacy null funding source is set to the cash account so the ledger cash balance agrees (#487).
          data: { pettyCashTransferId: transfer.id, ...(adoptLegLegacy && cashAccount ? { paymentAccountId: cashAccount.id } : {}) },
        })
        await logAuditTx(tx, actorId(session), "TRANSACTION_UPDATED", "Transaction", adoptLegId, {
          source: "petty-cash", pettyCashTransferId: transfer.id, action: "adopted-as-transfer-mirror",
          importedTransactionId: parsed.data.importedTransactionId,
        })
      } else {
        // Mirror the transfer into the Transaction ledger (symmetric with
        // receipt/expense mirrors) so the dashboard PETTY_CASH balance
        // reflects session transfers and agrees with the session running balance
        //. Uses the shared XFER account, like the bank-import transfer leg.
        await tx.transaction.create({
          data: {
            date: transfer.date,
            amount: transfer.amount,
            type: "EXPENSE",
            accountId: xferAccountId,
            isGiving: false,
            paymentAccountId: cashAccount?.id ?? null,
            bankRef: `PC_T_${transfer.id}`,
            description: encrypt("Transfer to bank"),
            reference: existing.title,
            pettyCashTransferId: transfer.id,
          },
        })
      }
      await logAuditTx(tx, actorId(session), "PETTY_CASH_TRANSFER_CREATED", "PettyCashTransfer", transfer.id, {
        amount: parsed.data.amount, sessionId,
        ...(windowOverridden ? { windowGuardOverridden: true } : {}),
        ...(adoptLegId !== null ? { importedTransactionId: parsed.data.importedTransactionId, adoptedLegId: adoptLegId } : {}),
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (e) {
    if (e instanceof TransferError) return { error: e.message }
    if (e instanceof AlreadySubmitted) return replayDone()
    // P2002 / P2034 with a token: a concurrent submit of the same form (double
    // click) may have won — under Serializable that usually surfaces as P2034,
    // sometimes as P2002 on the unique index. If the winner committed this very
    // transfer, treat this attempt as done; a different transfer on the token
    // gets the reload prompt.
    if (token && (isP2002(e) || isP2034(e))) {
      let state = await tokenState(prisma, token, sub)
      // P2034: the winner may not have committed yet when we looked — re-read once.
      if (state === "unused" && isP2034(e)) {
        await new Promise((r) => setTimeout(r, 50))
        state = await tokenState(prisma, token, sub)
      }
      if (state === "replay") return replayDone()
      if (state === "reused") return { error: TOKEN_REUSED_ERROR }
    }
    // P2034 = Serializable serialization failure: a concurrent transfer beat
    // this one. Surface a retry prompt rather than a 500.
    if (isP2034(e))
      return { error: "Transfer conflict — please try again." }
    throw e
  }
  revalidatePettyCashPaths(sessionId)
  redirect(`/accounting/petty-cash/sessions/${sessionId}`)
}

/** Delete a petty cash transfer. ADMIN only. */
export async function deleteTransfer(id: number): Promise<ActionResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }
  const off = await featureGuard("pettyCash")
  if (off) return off
  const transfer = await prisma.pettyCashTransfer.findUnique({
    where: { id },
    include: { session: { select: { id: true, status: true } }, transaction: { select: { id: true, reconciled: true } } },
  })
  if (!transfer) return { error: "Transfer not found" }
  if (transfer.session.status === "CLOSED") return { error: "Cannot delete from closed session" }
  if (transfer.transaction?.reconciled) return { error: RECONCILED_DELETE_ERROR }
  const transferDeleteLockError = await assertUnlocked(transfer.date)
  if (transferDeleteLockError) return { error: transferDeleteLockError }
  // ATO retention: same fixed 7-year floor as deleteTransaction —
  // independent of the admin-configurable period lock above.
  if (transfer.date >= retentionFloor()) return { error: retentionError(transfer.date) }
  // Re-assert OPEN + not-reconciled inside the delete transaction — see
  // deleteReceipt; closes the concurrent close/reconcile race left open by.
  let adopted = false
  try {
    adopted = await prisma.$transaction(async (tx) => {
      await assertSessionOpenTx(tx, transfer.session.id, "Cannot delete from closed session")
      // Concurrent delete: return a clean error instead of a P2025 from the delete below.
      if (!(await tx.pettyCashTransfer.findUnique({ where: { id }, select: { id: true } })))
        throw new TransferError("Transfer not found")
      // Derived inside the tx (not from the pre-read) so a concurrent change to the
      // mirror can't leave `adopted` stale.
      let isAdopted = false
      if (transfer.transaction) {
        const mirror = await tx.transaction.findUnique({ where: { id: transfer.transaction.id }, select: { reconciled: true, bankRef: true } })
        if (mirror?.reconciled) throw new SessionClosedError(RECONCILED_DELETE_ERROR)
        isAdopted = mirror?.bankRef?.startsWith(XFER_OUT_PREFIX) ?? false
      }
      // An adopted bank-import XFER_OUT leg is the import's own cash-out for a
      // deposit that stays in the ledger — unlink it so the cascade doesn't
      // delete it and leave the deposit without its matching cash-out.
      // Adoption only sets the link, so unlink only clears it.
      if (isAdopted) {
        await tx.transaction.update({
          where: { id: transfer.transaction!.id },
          data: { pettyCashTransferId: null },
        })
        await logAuditTx(tx, actorId(session), "TRANSACTION_UPDATED", "Transaction", transfer.transaction!.id, {
          source: "petty-cash", pettyCashTransferId: id, action: "unlinked-from-transfer",
        })
      }
      await tx.pettyCashTransfer.delete({ where: { id } })
      await logAuditTx(tx, actorId(session), "PETTY_CASH_TRANSFER_DELETED", "PettyCashTransfer", id, {
        amount: Number(transfer.amount),
        sessionId: transfer.sessionId,
      })
      return isAdopted
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (e) {
    if (e instanceof SessionClosedError || e instanceof TransferError) return { error: e.message }
    // P2034 = Serializable serialization failure: a concurrent reconcile/close beat this delete.
    if (isP2034(e)) return { error: "Transfer conflict — please try again." }
    throw e
  }
  const userId = actorId(session)
  // The mirrored XFER ledger row is removed by FK cascade (Transaction
  // .pettyCashTransferId onDelete: Cascade) — log it explicitly so the
  // Transaction audit trail doesn't show a ghost deletion (matches deleteReceipt).
  if (transfer.transaction && !adopted)
    await logAudit(userId, "TRANSACTION_DELETED", "Transaction", transfer.transaction.id, {
      source: "petty-cash", pettyCashTransferId: id,
    })
  revalidatePettyCashPaths(transfer.sessionId)
}
