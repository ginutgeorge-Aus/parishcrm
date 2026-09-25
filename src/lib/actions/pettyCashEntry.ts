// src/lib/actions/pettyCashEntry.ts
import type { Prisma } from "@/lib/generated/prisma/client"
import { encrypt } from "@/lib/crypto"
import { revalidatePath } from "next/cache"

// No "use server" here (plain module, not a Server Action file) — lets it
// export the sync revalidator/consts below alongside the pure builders.
// A "use server" file may only export async functions (build error otherwise,
// ); pettyCashReceipt/Expense/Transfer.ts all import these from here.

// Revalidate every path affected by a petty-cash receipt/expense/transfer
// mutation: the session page, the petty-cash index, and — because those
// entries mirror into the Transaction ledger — the accounting dashboard
// and transactions list. Shared so the set stays complete across all eight
// create/update/delete paths.
export function revalidatePettyCashPaths(sessionId: number) {
  revalidatePath(`/accounting/petty-cash/sessions/${sessionId}`)
  revalidatePath("/accounting/petty-cash")
  revalidatePath("/accounting")
  revalidatePath("/accounting/transactions")
  revalidatePath("/accounting/reports/pl")
  revalidatePath("/accounting/reports/balance-sheet")
  revalidatePath("/accounting/reports/budget-vs-actual")
  revalidatePath("/accounting/reports/funds")
}

// A petty-cash entry mirrors into a Transaction ledger row. If that mirror
// is reconciled, editing/deleting the entry would silently un-balance the
// reconciled period — the exact bug closed for the direct route.
// Mirror its wording; the fix (un-reconcile on the Reconciliation page) is the
// same.
export const RECONCILED_EDIT_ERROR =
  "This entry's ledger transaction is reconciled. Un-reconcile it on the Reconciliation page before editing."
export const RECONCILED_DELETE_ERROR =
  "This entry's ledger transaction is reconciled. Un-reconcile it on the Reconciliation page before deleting."

// Thrown by assertSessionOpenTx inside a create/update write transaction and
// caught just outside it, so a rolled-back write surfaces as a clean
// ActionResult error (mirrors TransferError in pettyCashTransfer.ts).
export class SessionClosedError extends Error {}

// Re-assert the session is OPEN *inside* the write transaction. The
// create/update actions gate on status outside the tx, but a concurrent
// closeSession between that check and the write (default Read Committed) would
// otherwise let an entry post into a now-CLOSED session — silently drifting the
// stored closingVariance snapshot. Message defaults to the create-path wording;
// callers pass the edit-path wording where it differs.
//
// a plain SELECT here (the pre-fix behavior) takes no lock, so it only
// closes half the race — closeSession's own conditional updateMany
// could still commit its OPEN→CLOSED transition in the gap between this read
// and the caller's write committing, landing the write in a session that is
// CLOSED by the time both transactions have committed. Reasserting via a
// conditional `updateMany({ where: { status: "OPEN" } })` instead takes a real
// row-level write lock on the SAME session row closeSession updates: whichever
// transaction's UPDATE statement reaches Postgres first wins the row; the
// other blocks until the winner commits, then re-evaluates its own WHERE
// clause against the now-committed row. That is genuine mutual exclusion
// (ordinary MVCC write-write contention), not reliant on Serializable
// snapshot-conflict detection — the two transactions never touch a common row
// otherwise, so Serializable alone would not create a dependency between them.
export async function assertSessionOpenTx(
  tx: Prisma.TransactionClient,
  sessionId: number,
  closedMessage = "Session is closed"
): Promise<void> {
  const { count } = await tx.pettyCashSession.updateMany({
    where: { id: sessionId, status: "OPEN" },
    data: { status: "OPEN" }, // no-op value write — only the lock/recheck matters
  })
  if (count > 0) return
  // No row matched: either the session doesn't exist, or it's CLOSED. Only used
  // to pick the right error message — never trust the fetched status for
  // anything else, since it's already stale by the time this returns.
  const s = await tx.pettyCashSession.findUnique({ where: { id: sessionId }, select: { id: true } })
  if (!s) throw new SessionClosedError("Session not found")
  throw new SessionClosedError(closedMessage)
}

// Pure builders: shape the create payloads (with at-rest encryption) without
// touching the DB, so both the single-entry writes below and the batched
// petty-cash import share one source of truth for the row shape.

export function receiptCreateData(args: {
  sessionId: number; date: Date; accountId: number;
  amount: number | string; personId?: number | null; serviceTypeId?: number | null;
  notes?: string | null; importKey?: string | null; fundId?: number | null;
}): Prisma.PettyCashReceiptCreateManyInput {
  return {
    sessionId: args.sessionId, date: args.date, accountId: args.accountId,
    amount: args.amount,
    personId: args.personId ?? null, serviceTypeId: args.serviceTypeId ?? null,
    // notes can carry a donor name — encrypt at rest, decrypt on read.
    notes: args.notes ? encrypt(args.notes) : null,
    importKey: args.importKey ?? null,
    fundId: args.fundId ?? null,
  }
}

export function expenseCreateData(args: {
  sessionId: number; date: Date; accountId: number;
  amount: number | string; payee: string; description: string;
  receiptRef?: string | null; importKey?: string | null; fundId?: number | null;
}): Prisma.PettyCashExpenseCreateManyInput {
  return {
    sessionId: args.sessionId, date: args.date, accountId: args.accountId,
    // payee (recipient name) and description are PII-bearing free text —
    // encrypt at rest, decrypt on read.
    amount: args.amount, payee: encrypt(args.payee),
    description: encrypt(args.description), receiptRef: args.receiptRef ?? null,
    importKey: args.importKey ?? null,
    fundId: args.fundId ?? null,
  }
}

// Mirror INCOME/EXPENSE Transaction rows, built from the ALREADY-CREATED
// receipt/expense (its generated id anchors bankRef + the FK). `accountName` is
// the plaintext account name encrypted into the ledger description.
export function receiptMirrorData(
  receipt: { id: number; date: Date; amount: Prisma.Decimal | number | string; accountId: number; fundId?: number | null },
  accountName: string, sessionTitle: string,
  // A receipt's donor (personId) → their family. Mirroring these onto the ledger
  // row with isGiving = !!familyId matches createTransaction's semantics,
  // so a cash gift recorded in petty cash reaches the per-family Giving Summary
  // instead of being silently excluded. Absent/unfamilied donor → not giving.
  giving?: { personId: number | null; familyId: number | null },
  // Resolved id of the (single, active) CASH-kind PaymentAccount — fetched once
  // by the caller via getCashAccount(), not per row. Null if no cash account is
  // configured yet; the mirror still posts (paymentAccountId nullable) rather
  // than blocking the petty-cash entry on a settings gap.
  cashAccountId?: number | null,
): Prisma.TransactionCreateManyInput {
  const familyId = giving?.familyId ?? null
  return {
    date: receipt.date, amount: receipt.amount, type: "INCOME", accountId: receipt.accountId,
    isGiving: !!familyId, familyId, personId: giving?.personId ?? null,
    paymentAccountId: cashAccountId ?? null, bankRef: `PC_R_${receipt.id}`,
    description: encrypt(accountName), reference: sessionTitle, pettyCashReceiptId: receipt.id,
    fundId: receipt.fundId ?? null,
  }
}

export function expenseMirrorData(
  expense: { id: number; date: Date; amount: Prisma.Decimal | number | string; accountId: number; fundId?: number | null },
  accountName: string, sessionTitle: string,
  // See receiptMirrorData's cashAccountId param.
  cashAccountId?: number | null,
): Prisma.TransactionCreateManyInput {
  return {
    date: expense.date, amount: expense.amount, type: "EXPENSE", accountId: expense.accountId,
    isGiving: false, paymentAccountId: cashAccountId ?? null, bankRef: `PC_E_${expense.id}`,
    description: encrypt(accountName), reference: sessionTitle, pettyCashExpenseId: expense.id,
    fundId: expense.fundId ?? null,
  }
}

// Creates a petty-cash receipt and its mirror INCOME Transaction inside the
// caller's transaction. `accountName` is the (plaintext) account name encrypted
// into the ledger description. Returns the new receipt id.
export async function createReceiptEntry(
  tx: Prisma.TransactionClient,
  args: {
    sessionId: number; date: Date; accountId: number; accountName: string;
    amount: number | string; personId?: number | null; serviceTypeId?: number | null;
    notes?: string | null; sessionTitle: string; importKey?: string | null; fundId?: number | null;
    // Resolved once by the caller via getCashAccount() — see receiptMirrorData.
    cashAccountId?: number | null;
  }
): Promise<number> {
  const receipt = await tx.pettyCashReceipt.create({ data: receiptCreateData(args) })
  // Resolve the donor's family so a cash gift is mirrored as giving.
  const family = args.personId
    ? await tx.person.findUnique({ where: { id: args.personId }, select: { familyId: true } })
    : null
  // The freshly-created receipt row's selected shape may not include fundId —
  // merge args.fundId in explicitly so the mirror always matches the entry.
  await tx.transaction.create({
    data: receiptMirrorData(
      { ...receipt, fundId: args.fundId ?? null },
      args.accountName, args.sessionTitle,
      { personId: args.personId ?? null, familyId: family?.familyId ?? null },
      args.cashAccountId,
    ),
  })
  return receipt.id
}

export async function createExpenseEntry(
  tx: Prisma.TransactionClient,
  args: {
    sessionId: number; date: Date; accountId: number; accountName: string;
    amount: number | string; payee: string; description: string; receiptRef?: string | null; sessionTitle: string; importKey?: string | null; fundId?: number | null;
    // Resolved once by the caller via getCashAccount() — see receiptMirrorData.
    cashAccountId?: number | null;
  }
): Promise<number> {
  const expense = await tx.pettyCashExpense.create({ data: expenseCreateData(args) })
  await tx.transaction.create({ data: expenseMirrorData({ ...expense, fundId: args.fundId ?? null }, args.accountName, args.sessionTitle, args.cashAccountId) })
  return expense.id
}
