import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { contentKeyFromBankRef } from "@/lib/anzParser"
import { encrypt } from "@/lib/crypto"
import { getXferAccountId } from "@/lib/xferAccount"
import { getCashAccount } from "@/lib/paymentAccounts"
import { toCents } from "@/lib/formatting"
import { getAccountingLockDate, isDateLocked } from "@/lib/accountingLock"
import { MONEY_DECIMAL_RE } from "@/lib/validation"
import type { Prisma } from "@/lib/generated/prisma/client"

// Discriminated result the confirm route maps to a NextResponse. Transport
// concerns (auth/role, per-user rate limit, body-size cap, audit log) stay in the
// route; this module owns the parse → FK/consistency validation → insert
// pipeline so it is unit-testable without a Next request.
export type BankImportResult =
  | { ok: true; imported: number; skipped: number; duplicates: number }
  // A mid-batch DB fault can leave earlier rows already committed (the plain-row
  // createMany and per-row $transactions are not rolled back). `imported`/
  // `duplicates` carry the partial counts so the route can record the real write
  // in the audit log instead of a false "total failure".
  | { ok: false; status: number; error: string; imported?: number; duplicates?: number }

// A YYYY-MM-DD string can be shape-valid yet not a real calendar date
// ("2026-02-31"). new Date() would roll it into the next month and post the
// transaction under the wrong accounting period, so verify it round-trips.
function isRealCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

const RowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  description: z.string().min(1).max(500),
  details: z.string().max(1000).optional(),
  amount: z.string().regex(MONEY_DECIMAL_RE, "Invalid amount"),
  type: z.enum(["INCOME", "EXPENSE"]),
  bankRef: z.string().min(1).max(200),
  accountId: z.number().int().positive().nullable(),
  skip: z.boolean(),
  paymentAccountId: z.number().int().positive().optional(),
  familyId: z.number().int().positive().optional().nullable(),
  personId: z.number().int().positive().optional().nullable(),
  fromPettyCash: z.boolean().optional(),
  splits: z
    .array(
      z.object({
        accountId: z.number().int().positive(),
        amount: z.string().regex(MONEY_DECIMAL_RE, "Invalid amount"),
        familyId: z.number().int().positive().optional().nullable(),
        personId: z.number().int().positive().optional().nullable(),
      })
    )
    .max(20)
    .optional(),
})
  // Reject impossible calendar dates so they can't be reposted under another
  // period. Shape is already checked by the field regex above.
  .refine((r) => isRealCalendarDate(r.date), { message: "Invalid date", path: ["date"] })
  // A petty-cash row is a bank DEPOSIT that moves cash out of petty cash, so its
  // bank-side leg must be INCOME. Accepting EXPENSE here booked an ANZ expense
  // plus a petty-cash expense instead of the intended income + cash-out pair.
  .refine((r) => !r.fromPettyCash || r.type === "INCOME", {
    message: "Petty-cash deposit rows must be INCOME",
    path: ["type"],
  })

const BodySchema = z.array(RowSchema).max(1000, "Too many rows (max 1000)")

// Core bank-statement confirm pipeline. `rawBody` is the already-parsed JSON body.
// Returns a typed result; never throws for a caller-visible error — a DB fault
// during a row insert surfaces as { status: 500 } (mirroring the route's prior
// behaviour), and only unexpected faults propagate.
export async function confirmBankImport(rawBody: unknown): Promise<BankImportResult> {
  const parsed = BodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Invalid request data" }
  }

  const rows = parsed.data
  const toImport = rows.filter((r) => !r.skip)
  const skipped = rows.length - toImport.length

  // Gate: reject the whole import if any row falls in the locked accounting period.
  const lockDate = await getAccountingLockDate()
  if (lockDate) {
    const locked = toImport.some((r) => isDateLocked(new Date(r.date), lockDate))
    if (locked) {
      return {
        ok: false,
        status: 400,
        error: `One or more transactions fall in a locked accounting period (on or before ${lockDate.toISOString().slice(0, 10)}). Adjust the lock date or exclude those rows.`,
      }
    }
  }

  // Resolve XFER account once if any row is a petty cash transfer.
  // XFER is pre-seeded; getXferAccountId self-heal-creates with a warning if the
  // seed hasn't run. Shared with session transfers so both legs use one account.
  let xferAccountId: number | null = null
  const hasPettyCash = toImport.some((r) => r.fromPettyCash)
  if (hasPettyCash) {
    xferAccountId = await getXferAccountId(prisma)
  }

  // Resolve the CASH-kind account once for the whole batch (mirrors the
  // xferAccountId pattern above) — used both to match a fromPettyCash deposit
  // against an already-recorded session-transfer mirror, and to write the
  // XFER_OUT cash-out leg for a deposit with no matching mirror.
  const cashAccount = hasPettyCash ? await getCashAccount() : null

  // Client-supplied FK (#security checklist): every referenced paymentAccountId
  // must exist and be a BANK-kind account — CASH is reserved for petty-cash
  // ledger mirrors and must never be posted here directly by a bank-statement row.
  const paymentAccountIds = Array.from(
    new Set(toImport.map((r) => r.paymentAccountId).filter((id): id is number => id != null))
  )
  const paymentAccountNameById = new Map<number, string>()
  if (paymentAccountIds.length > 0) {
    const foundAccounts = await prisma.paymentAccount.findMany({
      where: { id: { in: paymentAccountIds } },
      select: { id: true, name: true, kind: true, isActive: true },
    })
    const byId = new Map(foundAccounts.map((a) => [a.id, a]))
    for (const id of paymentAccountIds) {
      const a = byId.get(id)
      // Must exist, be BANK-kind, AND active — posting a statement row to a
      // deactivated account would create new activity on a retired account that
      // both manual create and the import picker refuse, defeating deactivation
      // (mirrors the category isActive guard below).
      if (!a || a.kind !== "BANK" || !a.isActive) {
        return { ok: false, status: 400, error: "Invalid payment account" }
      }
      paymentAccountNameById.set(id, a.name)
    }
  }

  // Validate familyId and personId FK references exist before any inserts.
  // Split rows carry their member link per allocation, so collect from both.
  const familyIds = Array.from(
    new Set(
      toImport.flatMap((r) => [r.familyId, ...(r.splits?.map((s) => s.familyId) ?? [])]).filter(Boolean) as number[]
    )
  )
  const personIds = Array.from(
    new Set(
      toImport.flatMap((r) => [r.personId, ...(r.splits?.map((s) => s.personId) ?? [])]).filter(Boolean) as number[]
    )
  )
  if (familyIds.length > 0) {
    const valid = await prisma.family.findMany({ where: { id: { in: familyIds } }, select: { id: true } })
    const validSet = new Set(valid.map((f) => f.id))
    if (familyIds.some((id) => !validSet.has(id))) {
      return { ok: false, status: 400, error: "Invalid family reference" }
    }
  }
  // Map each person to its owning family so we can reject a row that pairs a
  // person with a family they don't belong to. A forged confirm payload could
  // otherwise attribute one member's giving under a different family.
  const personFamily = new Map<number, number>()
  if (personIds.length > 0) {
    const valid = await prisma.person.findMany({
      where: { id: { in: personIds } },
      select: { id: true, familyId: true },
    })
    const validSet = new Set(valid.map((p) => p.id))
    if (personIds.some((id) => !validSet.has(id))) {
      return { ok: false, status: 400, error: "Invalid person reference" }
    }
    for (const p of valid) personFamily.set(p.id, p.familyId)
  }

  // Backfill a row/split familyId from the person's own family when a member was
  // picked with no explicit family. Without this the insert writes a
  // personId under familyId=null with isGiving=!!familyId=false — an unlinked
  // giving row that never surfaces in the family's giving history. Only fills
  // when familyId is absent, so the consistency check below still rejects a
  // person paired with the WRONG family rather than silently rewriting it.
  for (const r of toImport) {
    if (r.personId != null && r.familyId == null) {
      r.familyId = personFamily.get(r.personId) ?? null
    }
    for (const s of r.splits ?? []) {
      if (s.personId != null && s.familyId == null) {
        s.familyId = personFamily.get(s.personId) ?? null
      }
    }
  }

  // Each (familyId, personId) pairing — at row level and per split allocation —
  // must be internally consistent: the person must belong to the named family.
  const memberPairs = toImport.flatMap((r) => [
    { familyId: r.familyId, personId: r.personId },
    ...(r.splits?.map((s) => ({ familyId: s.familyId, personId: s.personId })) ?? []),
  ])
  for (const { familyId, personId } of memberPairs) {
    if (personId == null) continue
    if (familyId != null && personFamily.get(personId) !== familyId) {
      return { ok: false, status: 400, error: "Person does not belong to the selected family" }
    }
  }

  // Split rows: every allocation must be positive and sum exactly to the row
  // total (server must not trust the client total) — reject before any insert.
  for (const r of toImport) {
    if (r.fromPettyCash || !r.splits?.length) continue
    if (r.splits.some((s) => toCents(s.amount) <= 0)) {
      return {
        ok: false,
        status: 400,
        error: `Split amounts for "${r.description}" (${r.date}) must each be greater than 0`,
      }
    }
    const sum = r.splits.reduce((t, s) => t + toCents(s.amount), 0)
    if (sum !== toCents(r.amount)) {
      return {
        ok: false,
        status: 400,
        error: `Split amounts for "${r.description}" (${r.date}) must total ${r.amount}`,
      }
    }
    // The same member must not appear in two allocations of one line — that
    // would post two giving rows for one donor and inflate their record.
    // Allocations with no member (general fund) may repeat freely.
    const donorKeys = new Set<string>()
    for (const s of r.splits) {
      if (s.familyId == null && s.personId == null) continue
      const key = `${s.familyId ?? ""}-${s.personId ?? ""}`
      if (donorKeys.has(key)) {
        return {
          ok: false,
          status: 400,
          error: `"${r.description}" (${r.date}) assigns the same member to more than one allocation — combine them into a single split`,
        }
      }
      donorKeys.add(key)
    }
  }

  // A plain (non-split, non-petty-cash) row must carry a category. Without one it
  // is excluded from both the plain-row batch and the linked-write loop below, so
  // it would be silently dropped — never written, never counted, breaking the
  // imported+duplicates==toImport.length invariant. Reject it up front.
  for (const r of toImport) {
    if (r.fromPettyCash || r.splits?.length) continue
    if (r.accountId == null) {
      return {
        ok: false,
        status: 400,
        error: `"${r.description}" (${r.date}) needs a category before it can be imported`,
      }
    }
  }

  // Validate each category (single accountId, or every split allocation's
  // accountId) exists, is active, and matches the row type (an INCOME row must
  // point to an INCOME account). The petty-cash XFER account is resolved above.
  const acctChecks = toImport
    .filter((r) => !r.fromPettyCash)
    .flatMap((r) =>
      r.splits?.length
        ? r.splits.map((s) => ({ accountId: s.accountId!, type: r.type, label: `"${r.description}" (${r.date})` }))
        : r.accountId
          ? [{ accountId: r.accountId, type: r.type, label: `"${r.description}" (${r.date})` }]
          : []
    )
  const acctIds = Array.from(new Set(acctChecks.map((c) => c.accountId)))
  if (acctIds.length > 0) {
    const accounts = await prisma.account.findMany({
      where: { id: { in: acctIds } },
      select: { id: true, type: true, isActive: true },
    })
    const acctMap = new Map(accounts.map((a) => [a.id, a]))
    for (const c of acctChecks) {
      const a = acctMap.get(c.accountId)
      if (!a) {
        return { ok: false, status: 400, error: `Invalid category for ${c.label}: the selected category no longer exists` }
      }
      if (!a.isActive) {
        return { ok: false, status: 400, error: `Invalid category for ${c.label}: the selected category is inactive` }
      }
      if (a.type !== c.type) {
        return {
          ok: false,
          status: 400,
          error: `Invalid category for ${c.label}: this is an ${c.type} transaction but the selected category is ${a.type}`,
        }
      }
    }
  }

  const bankRefs = toImport.map((r) => r.bankRef)
  const pairRefs = toImport
    .filter((r) => r.fromPettyCash)
    .map((r) => `XFER_OUT_${r.bankRef}`)
  const existing = await prisma.transaction.findMany({
    where: { bankRef: { in: [...bankRefs, ...pairRefs] } },
    select: { bankRef: true },
  })
  const existingRefs = new Set(existing.map((t) => t.bankRef))

  // Cross-format duplicate guard: a transaction imported once as a
  // Statement (ANZ_ bankRef, running-balance suffix) and again as a Transaction
  // Report (ANZTR_ bankRef, per-key seq suffix) has two different exact bankRefs,
  // so the exact-ref dedup above never catches it and the amount double-posts.
  // Both formats embed the same account/date/amount/description content key; match
  // on that against rows ALREADY in the DB (a snapshot over the import's date
  // window). We compare only against pre-existing rows — never against other rows
  // in THIS batch — so two genuinely-identical transactions in one file (distinct
  // balance/seq suffixes) are still both imported.
  const importTimes = toImport.map((r) => new Date(r.date).getTime()).filter((n) => !Number.isNaN(n))
  const existingContentKeys = new Set<string>()
  if (importTimes.length > 0) {
    const DAY_MS = 24 * 60 * 60 * 1000
    const priorTxns = await prisma.transaction.findMany({
      where: {
        date: { gte: new Date(Math.min(...importTimes) - DAY_MS), lte: new Date(Math.max(...importTimes) + DAY_MS) },
        bankRef: { not: null },
      },
      select: { bankRef: true, type: true },
    })
    for (const t of priorTxns) {
      const key = t.bankRef ? contentKeyFromBankRef(t.bankRef) : null
      // Key the content-match set by direction too: the lossy content key omits
      // INCOME/EXPENSE, so an opposite-direction transaction with the same
      // account/date/amount/description-prefix was skipped as a false duplicate,
      // silently dropping the legitimate line. Same-direction prefix
      // collisions remain an accepted trade-off of the cross-format dedup.
      if (key) existingContentKeys.add(`${key}|${t.type}`)
    }
  }
  const isDuplicate = (bankRef: string, type: "INCOME" | "EXPENSE"): boolean => {
    if (existingRefs.has(bankRef)) return true
    const key = contentKeyFromBankRef(bankRef)
    return key !== null && existingContentKeys.has(`${key}|${type}`)
  }

  // Session-transfer mirrors a fromPettyCash deposit may duplicate: a
  // custodian who logged the bank deposit as a session transfer already recorded
  // the PETTY_CASH cash-out. Match on cents + date window; each mirror is
  // consumed at most once so two deposits don't both claim one transfer. Safe
  // failure = skip the duplicate cash-out (the transfer already booked it),
  // never a silent double-reduction.
  const XFER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
  const pettyCashTimes = toImport.filter((r) => r.fromPettyCash).map((r) => new Date(r.date).getTime())
  const transferMirrors = pettyCashTimes.length
    ? await prisma.transaction.findMany({
        where: {
          pettyCashTransferId: { not: null },
          paymentAccountId: cashAccount?.id ?? null,
          date: {
            gte: new Date(Math.min(...pettyCashTimes) - XFER_WINDOW_MS),
            lte: new Date(Math.max(...pettyCashTimes) + XFER_WINDOW_MS),
          },
        },
        select: { id: true, amount: true, date: true, pettyCashTransferId: true },
      })
    : []
  const consumedMirrorIds = new Set<number>()

  let imported = 0
  let duplicates = 0

  // A DB fault after some rows have already committed (createMany / earlier
  // per-row $transactions) — report the partial counts + an actionable message so
  // the operator re-uploads (bankRef dedup skips the already-saved rows) rather
  // than manually re-keying rows already in the books (double-post risk).
  const dbFault = (): BankImportResult => ({
    ok: false,
    status: 500,
    error:
      imported > 0
        ? `A database error occurred after ${imported} transaction${imported === 1 ? "" : "s"} were already saved. Re-upload the same statement to import the remaining rows — already-saved rows are skipped automatically.`
        : "Failed to save transaction",
    imported,
    duplicates,
  })

  // Plain rows (no splits, not a petty-cash pairing) need no linked write, so
  // batch them into one createMany round trip instead of up to 1000 sequential
  // creates — the pattern pettyCashImport.ts already uses for its bulk
  // inserts. Split and petty-cash-pairing rows below still write per-row since
  // each involves more than one linked Transaction.
  const plainRows = toImport.filter((r) => !r.fromPettyCash && !r.splits?.length && r.accountId)
  const plainInputs: Prisma.TransactionCreateManyInput[] = []
  for (const row of plainRows) {
    // Dedupe against the DB fetch above and against earlier rows in this same
    // batch (two statement lines can carry the same bankRef) before the insert,
    // since createMany can't report which individual row collided.
    if (isDuplicate(row.bankRef, row.type)) {
      duplicates++
      continue
    }
    existingRefs.add(row.bankRef)
    plainInputs.push({
      date: new Date(row.date),
      description: encrypt(row.description),
      amount: row.amount,
      type: row.type,
      accountId: row.accountId!,
      paymentAccountId: row.paymentAccountId ?? null,
      isGiving: !!row.familyId,
      familyId: row.familyId ?? null,
      personId: row.personId ?? null,
      bankRef: row.bankRef,
      reconciled: false,
      // row.details is a superset of the just-encrypted description
      // (every parsed statement line, joined) — the same payee/reference PII.
      // Encrypt it too, or the description encryption is defeated by its own
      // plaintext twin sitting right next to it. Callers must safeDecrypt.
      notes: row.details ? encrypt(row.details) : null,
    })
  }
  if (plainInputs.length > 0) {
    // skipDuplicates as a safety net only for a same-instant concurrent import
    // of the same bankRef — the pre-filter above already handles duplicates
    // against the DB and within this batch. A DB fault must surface as a typed
    // 500 like the split/petty-cash loops below, not an unhandled rejection that
    // breaks this module's "never throws for a caller-visible error" contract.
    try {
      const { count } = await prisma.transaction.createMany({ data: plainInputs, skipDuplicates: true })
      imported += count
      // Any row skipped by skipDuplicates lost a same-instant concurrent-insert
      // race on its bankRef — it is a duplicate, not an import. Attribute the gap
      // to duplicates so imported+duplicates still equals toImport.length;
      // adding plainInputs.length blindly over-reported the imported count.
      duplicates += plainInputs.length - count
    } catch (e: unknown) {
      console.error("Bank import DB error", e instanceof Error ? e.message : String(e))
      return dbFault()
    }
  }

  for (const row of toImport) {
    const hasSplits = !row.fromPettyCash && !!row.splits?.length
    if (!row.fromPettyCash && !hasSplits) continue // handled in the plain-row batch above

    // Split row → one Transaction per allocation. The first keeps the canonical
    // bankRef; the rest are suffixed `#2`, `#3`… to stay unique. Re-import is
    // caught by the canonical ref existing.
    if (hasSplits) {
      if (isDuplicate(row.bankRef, row.type)) {
        duplicates++
        continue
      }
      const splits = row.splits!
      // All allocations for one bank line commit together or not at all — a
      // mid-loop failure must never leave siblings that don't sum to the line.
      const refs = splits.map((_, i) => (i === 0 ? row.bankRef : `${row.bankRef}#${i + 1}`))
      try {
        await prisma.$transaction(
          splits.map((s, i) =>
            prisma.transaction.create({
              data: {
                date: new Date(row.date),
                description: encrypt(row.description),
                amount: s.amount,
                type: row.type,
                accountId: s.accountId!,
                paymentAccountId: row.paymentAccountId ?? null,
                isGiving: !!s.familyId,
                familyId: s.familyId ?? null,
                personId: s.personId ?? null,
                bankRef: refs[i],
                reconciled: false,
                // same PII as the plain-row branch above — encrypt the
                // whole composed string (payee detail + split-index suffix).
                notes: encrypt(`${row.details ? `${row.details} ` : ""}(split ${i + 1}/${splits.length})`),
              },
            })
          )
        )
        refs.forEach((ref) => existingRefs.add(ref))
        // Count one imported bank line, not one per split allocation — a
        // single statement line that fans out into N Transaction rows must still
        // contribute 1 here so imported+duplicates==toImport.length, matching the
        // plain-row and petty-cash-pair branches (both already count per bank
        // line, not per Transaction row written).
        imported++
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes("UniqueConstraintViolation") || msg.includes("Unique constraint")) {
          duplicates++
          continue
        }
        console.error("Bank import DB error", msg)
        return dbFault()
      }
      continue
    }

    if (isDuplicate(row.bankRef, row.type)) {
      duplicates++
      continue
    }

    // Petty-cash transfer: the ANZ INCOME and its paired PETTY_CASH EXPENSE
    // commit together in one $transaction — a mid-pair failure must never
    // record the deposit without its matching cash-out (or vice versa).
    if (row.fromPettyCash) {
      const pairRef = `XFER_OUT_${row.bankRef}`
      const destLabel =
        (row.paymentAccountId != null ? paymentAccountNameById.get(row.paymentAccountId) : undefined) ??
        "the selected bank account"
      // If a session transfer already booked this deposit's cash-out, skip the
      // XFER_OUT leg so petty cash isn't reduced twice.
      // ACCEPTED RISK: matching on cents + ±7-day window can coincidentally
      // pair an unrelated session transfer of the same amount, suppressing a legit
      // cash-out leg → petty cash overstated by that amount. Tolerated at this
      // church's volume (same-cent transfers within a week are rare); the correct
      // fix is deposit-slip/reference correlation or an operator-confirm step, out
      // of scope here. Revisit if amount collisions become common.
      const rowCents = toCents(row.amount)
      const rowTime = new Date(row.date).getTime()
      const mirrorMatch = transferMirrors.find(
        (m) =>
          m.pettyCashTransferId != null &&
          m.amount != null &&
          !consumedMirrorIds.has(m.id) &&
          toCents(m.amount) === rowCents &&
          Math.abs(new Date(m.date).getTime() - rowTime) <= XFER_WINDOW_MS
      )
      if (mirrorMatch) consumedMirrorIds.add(mirrorMatch.id)
      const ops = [
        prisma.transaction.create({
          data: {
            date: new Date(row.date),
            description: encrypt(row.description),
            amount: row.amount,
            type: row.type,
            accountId: xferAccountId!,
            paymentAccountId: row.paymentAccountId ?? null,
            isGiving: !!row.familyId,
            familyId: row.familyId ?? null,
            personId: row.personId ?? null,
            bankRef: row.bankRef,
            reconciled: false,
            // same PII as the plain-row branch above.
            notes: row.details ? encrypt(row.details) : null,
          },
        }),
      ]
      if (!mirrorMatch && !existingRefs.has(pairRef)) {
        ops.push(
          prisma.transaction.create({
            data: {
              date: new Date(row.date),
              description: encrypt(`Transfer to ${destLabel}`),
              amount: row.amount,
              type: "EXPENSE",
              accountId: xferAccountId!,
              paymentAccountId: cashAccount?.id ?? null,
              isGiving: false,
              bankRef: pairRef,
              reconciled: false,
            },
          })
        )
      }
      try {
        await prisma.$transaction(ops)
        existingRefs.add(row.bankRef)
        existingRefs.add(pairRef)
        imported++
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes("UniqueConstraintViolation") || msg.includes("Unique constraint")) {
          duplicates++
          continue
        }
        console.error("Bank import DB error", msg)
        return dbFault()
      }
      continue
    }
  }

  return { ok: true, imported, skipped, duplicates }
}
