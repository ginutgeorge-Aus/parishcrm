// src/lib/actions/petty-cash-import.ts
"use server"

import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/roleGuard"
import { isValidPgId } from "@/lib/validation"
import {
  parseRows,
  resolveRows,
  sessionTitle,
  dedupeKey,
  type ResolvedRow,
} from "@/lib/pettyCashImport"
import { receiptCreateData, expenseCreateData, receiptMirrorData, expenseMirrorData } from "./pettyCashEntry"
import { getCashAccount } from "@/lib/paymentAccounts"
import type { Prisma } from "@/lib/generated/prisma/client"
import { getAccountingLockDate, isDateLocked } from "@/lib/accountingLock"
import { safeDecrypt } from "@/lib/crypto"
import { sumCents, centsToNumber } from "@/lib/formatting"
import { revalidatePath } from "next/cache"
import { logAudit } from "@/lib/audit"

export interface ImportPreview {
  rows: ResolvedRow[]
  sessions: string[] // distinct session titles to be created/appended
  receiptTotal: number
  expenseTotal: number
  hardErrorCount: number
}

export type PreviewResult = { error: string } | { preview: ImportPreview }

export async function previewImport(formData: FormData): Promise<PreviewResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const csv = String(formData.get("csv") ?? "")
  if (csv.length > 2 * 1024 * 1024) return { error: "File too large (max 2MB)" }

  let parsed: ReturnType<typeof parseRows>
  try {
    parsed = parseRows(csv)
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Parse error" }
  }
  if (parsed.length === 0) return { error: "No data rows" }

  // No `as AccountInfo[]`/`as PersonInfo[]` cast — let the select shape flow to the
  // helpers structurally, so a diverging select is a compile error not a silent
  // wrong-shape pass (AUDIT-069).
  const accounts = await prisma.account.findMany({
    select: { id: true, name: true, type: true, isActive: true },
  })
  const people = await prisma.person.findMany({
    where: { archivedAt: null },
    select: { id: true, firstName: true, middleName: true, lastName: true, bankingName: true },
  })

  const rows = resolveRows(parsed, accounts, people)

  const sessions = [...new Set(rows.filter((r) => r.date).map((r) => sessionTitle(r.date!)))]
  // Sum preview totals in integer cents to avoid float drift on a large CSV
  // — matches the integer-cents totals shown elsewhere in accounting.
  const receiptTotal = centsToNumber(
    sumCents(rows.filter((r) => r.type === "receipt" && !r.errors.length).map((r) => r.amount ?? 0)),
  )
  const expenseTotal = centsToNumber(
    sumCents(rows.filter((r) => r.type === "expense" && !r.errors.length).map((r) => r.amount ?? 0)),
  )
  const hardErrorCount = rows.filter((r) => r.errors.length > 0).length

  return { preview: { rows, sessions, receiptTotal, expenseTotal, hardErrorCount } }
}

export type CommitResult = { error: string } | { success: string }

// Shared csv-size/parse/empty guard for commitImport (previewImport keeps its
// own inline copy — not touched here to keep this change scoped).
function parseImportRows(csv: string): { error: string } | { rows: ReturnType<typeof parseRows> } {
  if (csv.length > 2 * 1024 * 1024) return { error: "File too large (max 2MB)" }
  let parsed: ReturnType<typeof parseRows>
  try {
    parsed = parseRows(csv)
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Parse error" }
  }
  if (parsed.length === 0) return { error: "No data rows" }
  return { rows: parsed }
}

// Period lock: the whole import is rejected if any row is dated on/before the
// lock date — same gate as the single-entry and bank-import write paths. Row
// dates are Date at UTC midnight (resolveRows), matching the lock's anchor.
async function findLockedRowsMessage(rows: ResolvedRow[]): Promise<string | null> {
  const lockDate = await getAccountingLockDate()
  if (lockDate && rows.some((r) => isDateLocked(r.date!, lockDate)))
    return `One or more rows fall in a locked accounting period (on or before ${lockDate.toISOString().slice(0, 10)}). Adjust the lock date or exclude those rows.`
  return null
}

// Validates client-supplied donor overrides against ACTIVE people — the
// single-entry createReceipt rejects unknown/archived donors, so the import
// path must too (else a bogus or archived personId would be linked).
async function findInvalidDonorOverrideMessage(overrides: Record<string, number | null>): Promise<string | null> {
  const overrideIds = [...new Set(Object.values(overrides).filter((v): v is number => typeof v === "number" && v > 0))]
  if (!overrideIds.length) return null
  const valid = await prisma.person.findMany({ where: { id: { in: overrideIds }, archivedAt: null }, select: { id: true } })
  const validSet = new Set(valid.map((p) => p.id))
  const bad = overrideIds.filter((id) => !validSet.has(id))
  return bad.length ? `Invalid donor selection: ${bad.join(", ")}` : null
}

type ImportSession = { id: number; title: string; status: string }

// session per date (reuse existing by title). Read/write through `tx`, not
// the outer `prisma` client, so the lookup and any new-session insert stay
// inside the transaction's isolation snapshot.
async function ensureImportSessions(
  tx: Prisma.TransactionClient,
  dates: string[],
  custodianId: number
): Promise<Map<string, ImportSession>> {
  const existingSessions = await tx.pettyCashSession.findMany({ where: { title: { in: dates.map((d) => sessionTitle(new Date(d + "T00:00:00Z"))) } }, select: { id: true, title: true, status: true } })
  const sessionByTitle = new Map(existingSessions.map((s) => [s.title, s as ImportSession]))

  for (const d of dates) {
    const title = sessionTitle(new Date(d + "T00:00:00Z"))
    if (!sessionByTitle.has(title)) {
      // upsert (INSERT … ON CONFLICT) instead of create-then-catch-P2002: a
      // concurrent import that wins the unique-title race resolves to
      // the winner row. Catching P2002 inside this interactive tx and
      // re-querying would fail — Postgres aborts the transaction on the
      // violation (25P02), so any later command in the same tx errors.
      const sess = await tx.pettyCashSession.upsert({
        where: { title },
        update: {},
        create: { title, custodianId, openingBalance: 0 },
        select: { id: true, title: true, status: true },
      })
      sessionByTitle.set(title, { id: sess.id, title: sess.title, status: sess.status as string })
    }
  }
  return sessionByTitle
}

type ImportInputs = {
  receiptInputs: Prisma.PettyCashReceiptCreateManyInput[]
  expenseInputs: Prisma.PettyCashExpenseCreateManyInput[]
  receipts: number
  expenses: number
  skipped: number
}

type RowInputResult =
  | { kind: "skip" }
  | { kind: "receipt"; input: Prisma.PettyCashReceiptCreateManyInput }
  | { kind: "expense"; input: Prisma.PettyCashExpenseCreateManyInput }

// Builds one row's insert payload, or reports it as a dedupe skip. `seen` is
// mutated in place — every emitted row's key is added, exactly as the inline
// version did, so a later duplicate row within the same CSV is still caught.
function buildRowInput(
  r: ResolvedRow,
  sessionByTitle: Map<string, ImportSession>,
  overrides: Record<string, number | null>,
  seen: Set<string>
): RowInputResult {
  const title = sessionTitle(r.date!)
  const sess = sessionByTitle.get(title)!
  if (sess.status === "CLOSED") throw new Error(`Session ${title} is closed`)
  // Dedupe text must mirror what is stored, or re-import won't detect dupes:
  // receipts store notes = payeeOrDonor || notes; expenses store payee = payeeOrDonor.
  const text = r.type === "expense" ? r.payeeOrDonor : (r.payeeOrDonor || r.notes || "")
  const key = dedupeKey({ date: r.date!, type: r.type!, accountId: r.accountId!, amount: r.amountRaw, text })
  if (seen.has(key)) return { kind: "skip" }
  seen.add(key)

  if (r.type === "receipt") {
    const override = overrides[String(r.rowNumber)]
    const personId = override !== undefined ? override : (r.donor.status === "matched" ? r.donor.personId : null)
    // Pass the validated raw amount string (not the parseFloat) so Prisma
    // Decimal never round-trips through an IEEE-754 float.
    return {
      kind: "receipt",
      input: receiptCreateData({
        sessionId: sess.id, date: r.date!, accountId: r.accountId!,
        amount: r.amountRaw, personId, notes: r.payeeOrDonor || r.notes || null, importKey: key,
      }),
    }
  }
  return {
    kind: "expense",
    input: expenseCreateData({
      sessionId: sess.id, date: r.date!, accountId: r.accountId!,
      amount: r.amountRaw, payee: r.payeeOrDonor, description: r.notes, importKey: key,
    }),
  }
}

// Accumulate row payloads, then flush as batched writes: one
// createManyAndReturn per kind returns the generated ids that anchor each
// mirror-ledger row, so 2N sequential round trips collapse to ~4.
function buildImportInputs(
  rows: ResolvedRow[],
  sessionByTitle: Map<string, ImportSession>,
  overrides: Record<string, number | null>,
  seen: Set<string>
): ImportInputs {
  const receiptInputs: Prisma.PettyCashReceiptCreateManyInput[] = []
  const expenseInputs: Prisma.PettyCashExpenseCreateManyInput[] = []
  let receipts = 0, expenses = 0, skipped = 0
  for (const r of rows) {
    const result = buildRowInput(r, sessionByTitle, overrides, seen)
    if (result.kind === "skip") { skipped++; continue }
    if (result.kind === "receipt") { receiptInputs.push(result.input); receipts++ }
    else { expenseInputs.push(result.input); expenses++ }
  }
  return { receiptInputs, expenseInputs, receipts, expenses, skipped }
}

// Re-check every session this import is about to write into, right before
// the batched insert. `sessionByTitle`'s status was read (or upserted) at the
// top of this transaction; under Read Committed a concurrent closeSession
// committed after that read but before this write must still be caught — the
// per-row check in buildImportInputs only catches a session that was ALREADY
// closed as of that earlier read. Reassert via the same conditional-updateMany
// lock pattern as assertSessionOpenTx (pettyCashEntry.ts) so a concurrent
// close contends on the same row instead of racing past it.
async function assertImportSessionsStillOpen(
  tx: Prisma.TransactionClient,
  touchedSessionIds: Set<number>,
  titleBySessionId: Map<number, string>
): Promise<void> {
  for (const sid of touchedSessionIds) {
    const { count } = await tx.pettyCashSession.updateMany({
      where: { id: sid, status: "OPEN" },
      data: { status: "OPEN" },
    })
    if (count === 0) throw new Error(`Session ${titleBySessionId.get(sid)} is closed`)
  }
}

// Mirror-row `reference` is the session title; derive it from each created
// row's own sessionId so correctness never depends on createManyAndReturn
// preserving input order. accountName maps from the row's accountId.
async function insertImportReceipts(
  tx: Prisma.TransactionClient,
  receiptInputs: Prisma.PettyCashReceiptCreateManyInput[],
  accountName: Map<number, string>,
  titleBySessionId: Map<number, string>,
  cashAccountId: number | null
): Promise<void> {
  if (!receiptInputs.length) return
  const created = await tx.pettyCashReceipt.createManyAndReturn({ data: receiptInputs })
  // Resolve each matched donor's family in one query so imported cash gifts
  // mirror as giving, same as the single-entry path.
  const donorIds = [...new Set(created.map((rec) => rec.personId).filter((id): id is number => id != null))]
  const familyByPerson = new Map(
    donorIds.length
      ? (await tx.person.findMany({ where: { id: { in: donorIds } }, select: { id: true, familyId: true } }))
          .map((p) => [p.id, p.familyId])
      : [],
  )
  await tx.transaction.createMany({
    data: created.map((rec) => receiptMirrorData(
      rec, accountName.get(rec.accountId)!, titleBySessionId.get(rec.sessionId)!,
      { personId: rec.personId ?? null, familyId: rec.personId != null ? familyByPerson.get(rec.personId) ?? null : null },
      cashAccountId,
    )),
  })
}

async function insertImportExpenses(
  tx: Prisma.TransactionClient,
  expenseInputs: Prisma.PettyCashExpenseCreateManyInput[],
  accountName: Map<number, string>,
  titleBySessionId: Map<number, string>,
  cashAccountId: number | null
): Promise<void> {
  if (!expenseInputs.length) return
  const created = await tx.pettyCashExpense.createManyAndReturn({ data: expenseInputs })
  await tx.transaction.createMany({
    data: created.map((exp) => expenseMirrorData(exp, accountName.get(exp.accountId)!, titleBySessionId.get(exp.sessionId)!, cashAccountId)),
  })
}

export async function commitImport(formData: FormData): Promise<CommitResult> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Unauthorized" }

  const custodianId = Number(formData.get("custodianId"))
  // isValidPgId bounds to int4 — an above-int4 value would otherwise reach
  // person.findFirst and throw a raw numeric-overflow 500 (security.md).
  if (!isValidPgId(custodianId)) return { error: "Select a custodian" }

  const csv = String(formData.get("csv") ?? "")
  const parsedRows = parseImportRows(csv)
  if ("error" in parsedRows) return { error: parsedRows.error }
  const parsed = parsedRows.rows

  // Single accounts/people fetch shared by row resolution and the ledger
  // account-name map below — previewImport used to re-run both.
  const accounts = await prisma.account.findMany({
    select: { id: true, name: true, type: true, isActive: true },
  })
  const people = await prisma.person.findMany({
    where: { archivedAt: null },
    select: { id: true, firstName: true, middleName: true, lastName: true, bankingName: true },
  })
  const rows = resolveRows(parsed, accounts, people)
  const hardErrorCount = rows.filter((r) => r.errors.length > 0).length
  if (hardErrorCount > 0)
    return { error: `${hardErrorCount} row(s) have errors — fix the CSV and retry` }

  const lockedMessage = await findLockedRowsMessage(rows)
  if (lockedMessage) return { error: lockedMessage }

  let overrides: Record<string, number | null> = {}
  try { overrides = JSON.parse(String(formData.get("donorOverrides") ?? "{}")) } catch { /* ignore */ }

  // Scope to active people — an archived person must not be assignable as
  // custodian, matching the donor validation below and the single-entry path.
  const custodian = await prisma.person.findFirst({ where: { id: custodianId, archivedAt: null }, select: { id: true } })
  if (!custodian) return { error: "Custodian not found" }

  const donorOverrideError = await findInvalidDonorOverrideMessage(overrides)
  if (donorOverrideError) return { error: donorOverrideError }

  // Account names for the encrypted ledger description (reuses the fetch above).
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))

  const dates = [...new Set(rows.map((r) => r.date!.toISOString().slice(0, 10)))]

  // Existing entries for dedupe (across the imported date span). Fold with
  // reduce rather than Math.min(...spread) — a large CSV (up to 2MB) can hold
  // enough rows to blow V8's argument-count limit on the spread.
  const times = rows.map((r) => r.date!.getTime())
  const minDate = new Date(times.reduce((a, b) => Math.min(a, b), Infinity))
  const maxDate = new Date(times.reduce((a, b) => Math.max(a, b), -Infinity))
  const [existingR, existingE] = await Promise.all([
    prisma.pettyCashReceipt.findMany({ where: { date: { gte: minDate, lte: maxDate } }, select: { date: true, accountId: true, amount: true, notes: true, importKey: true } }),
    prisma.pettyCashExpense.findMany({ where: { date: { gte: minDate, lte: maxDate } }, select: { date: true, accountId: true, amount: true, payee: true, importKey: true } }),
  ])
  // Dedupe on the immutable importKey stamped at import; legacy rows
  // (null importKey) fall back to the computed-from-mutable-fields key.
  const seen = new Set<string>([
    // notes/payee are encrypted at rest; decrypt before keying so the
    // fallback dedupe key matches the plaintext-derived key used at import time.
    // safeDecrypt (not raw decrypt) so one rotated-out-key/corrupt row degrades
    // gracefully instead of aborting the whole import.
    ...existingR.map((r) => r.importKey ?? dedupeKey({ date: r.date, type: "receipt", accountId: r.accountId, amount: r.amount, text: r.notes ? safeDecrypt(r.notes) : "" })),
    ...existingE.map((e) => e.importKey ?? dedupeKey({ date: e.date, type: "expense", accountId: e.accountId, amount: e.amount, text: safeDecrypt(e.payee) })),
  ])

  let receipts = 0, expenses = 0, skipped = 0
  // Resolved once for the whole batch, not per row — mirrors the
  // xferAccountId/cashAccount pattern in the single-entry actions.
  const cashAccount = await getCashAccount()
  // A 2MB CSV can yield thousands of rows; the batched writes still exceed the
  // 5s Prisma interactive-tx default on large imports and would abort after real
  // work. Size the window to the row cap.
  try {
    await prisma.$transaction(async (tx) => {
      const sessionByTitle = await ensureImportSessions(tx, dates, custodianId)

      const built = buildImportInputs(rows, sessionByTitle, overrides, seen)
      receipts = built.receipts
      expenses = built.expenses
      skipped = built.skipped

      const titleBySessionId = new Map([...sessionByTitle.values()].map((s) => [s.id, s.title]))
      const touchedSessionIds = new Set<number>([
        ...built.receiptInputs.map((r) => r.sessionId as number),
        ...built.expenseInputs.map((e) => e.sessionId as number),
      ])
      await assertImportSessionsStillOpen(tx, touchedSessionIds, titleBySessionId)

      const cashAccountId = cashAccount?.id ?? null
      await insertImportReceipts(tx, built.receiptInputs, accountName, titleBySessionId, cashAccountId)
      await insertImportExpenses(tx, built.expenseInputs, accountName, titleBySessionId, cashAccountId)
    }, { maxWait: 10_000, timeout: 60_000 })
  } catch (e) {
    // A closed session mid-import or a DB constraint failure throws inside the
    // transaction — surface the message instead of an unhandled 500.
    return { error: e instanceof Error ? e.message : "Import failed" }
  }

  const sortedDates = [...dates].sort((a, b) => a.localeCompare(b))
  await logAudit(actorId(session), "PETTY_CASH_IMPORTED", "PettyCashSession", undefined, {
    receipts, expenses, skipped, custodianId, dateRange: `${sortedDates[0]}..${sortedDates[sortedDates.length - 1]}`,
  })
  revalidatePath("/accounting/petty-cash")
  revalidatePath("/accounting")
  revalidatePath("/accounting/transactions")
  revalidatePath("/accounting/reports/pl")
  revalidatePath("/accounting/reports/balance-sheet")
  revalidatePath("/accounting/reports/budget-vs-actual")
  return { success: `Imported ${receipts} receipt(s) and ${expenses} expense(s)${skipped ? `, skipped ${skipped} duplicate(s)` : ""}` }
}