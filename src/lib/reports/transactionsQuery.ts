import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { getAccountingLockDate } from "@/lib/accountingLock"
import { endOfDayUTC } from "@/lib/dates"
import { currentFYYear, fyDateRange } from "@/lib/fiscalYear"
import { TransactionType } from "@/lib/generated/prisma/enums"
import { toCents, centsToNumber, sumCents } from "@/lib/formatting"
import { getPaymentAccounts } from "@/lib/paymentAccounts"

export type TransactionsSearchParams = {
  from?: string
  to?: string
  account?: string
  type?: string
  family?: string
  paymentAccount?: string
  reconciled?: string
  q?: string
  page?: string
  fund?: string
}

// Page size (DB take/skip when not searching).
export const TX_CAP = 50
// Search decrypts in memory (encrypted descriptions can't be LIKE-filtered in
// the DB), so the q path can't page at the DB. Bound the in-memory scan to the
// most-recent SEARCH_SCAN_CAP rows so a search can't load the whole table.
export const SEARCH_SCAN_CAP = 5000

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
function parseDate(s: string): Date | null {
  const m = ISO_DATE.exec(s)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const d = new Date(Date.UTC(year, month - 1, day))
  // `new Date("2024-02-31")` silently rolls day-of-month overflow
  // forward (to 2024-03-02) instead of rejecting it. Round-trip the parsed
  // components against the constructed date's UTC fields so an
  // out-of-range day/month is treated as invalid, not normalized.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null
  }
  return d
}
const ID = /^\d+$/
function parseId(s: string): number | undefined {
  // reject any non-numeric-only string outright — `parseInt` alone
  // would truncate "12abc" into the valid-looking id 12 and widen the query
  // to an unintended account/family.
  if (!ID.test(s)) return undefined
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : undefined
}

function reconciledFilter(reconciled: string | undefined) {
  if (reconciled === "true") return { reconciled: true }
  if (reconciled === "false") return { reconciled: false }
  return {}
}

function fundFilter(fund: string | undefined) {
  if (fund === "none") return { fundId: null }
  const fundId = fund ? parseId(fund) : undefined
  return fundId !== undefined ? { fundId } : {}
}

/**
 * Translate the URL search params into a Prisma `where` for the transaction
 * list, returning the validated `type`/`paymentAccountId` alongside so callers
 * can forward the same sanitised values to the CSV export href.
 *
 * Pure — no DB — so the filter edge cases (enum allow-list, fund none/id,
 * default FY range, invalid ids) are unit-testable without mocking Prisma.
 * `paymentAccount` is now a numeric PaymentAccount.id (FK, not an enum) — this
 * function only validates its shape (positive int); confirming the id actually
 * exists is the caller's job (it has the DB-fetched account list already).
 */
export function buildTransactionWhere(sp: TransactionsSearchParams) {
  const fyYear = currentFYYear()
  const { start: defaultFrom, end: fyEnd } = fyDateRange(fyYear)
  const explicitTo = sp.to ? parseDate(sp.to) : null

  // Validate the type enum (/AUDIT-049): an arbitrary string cast to a
  // Prisma enum throws PrismaClientValidationError at query time and 500s the
  // page. Mirror the allow-list the CSV export route already applies; drop an
  // invalid value rather than crash — the filter is simply ignored.
  const type =
    sp.type && Object.values(TransactionType).includes(sp.type as TransactionType)
      ? (sp.type as TransactionType)
      : undefined
  const paymentAccountId = sp.paymentAccount ? parseId(sp.paymentAccount) : undefined

  const where = {
    date: {
      gte: sp.from ? (parseDate(sp.from) ?? defaultFrom) : defaultFrom,
      // Cap the upper bound at the end of the current FY by default —
      // without it, transactions dated in a future/next FY silently fold into
      // the current income/expense/net tiles. An explicit, valid `to` always
      // wins; mirrors the half-open `{ gte, lt }` range plQuery/budgetVsActualQuery
      // use.
      ...(explicitTo ? { lte: endOfDayUTC(explicitTo) } : { lt: fyEnd }),
    },
    ...(sp.account && { accountId: parseId(sp.account) }),
    ...(type && { type }),
    ...(sp.family && { familyId: parseId(sp.family) }),
    ...(paymentAccountId !== undefined && { paymentAccountId }),
    ...reconciledFilter(sp.reconciled),
    ...fundFilter(sp.fund),
  }

  return { where, type, paymentAccountId }
}

/**
 * Fetch + shape everything the transactions list page renders: the current
 * page of decrypted transactions, filter-dropdown lookups, pagination window
 * inputs, and the income/expense/net summary. Keeps the Server Component thin.
 */
export async function getTransactionsData(sp: TransactionsSearchParams) {
  const { where, type, paymentAccountId: rawPaymentAccountId } = buildTransactionWhere(sp)

  const q = sp.q?.trim() ?? ""
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)

  // Reports/filters show all accounts (incl. deactivated-with-history), not
  // just active ones — a deactivated account can still have transactions.
  const paymentAccounts = await getPaymentAccounts({ activeOnly: false })
  // A shape-valid id (buildTransactionWhere already checked positive-int) that
  // doesn't match any real account — a typo'd/stale id in the URL — is
  // surfaced back as undefined so the filter dropdown falls back to its
  // placeholder rather than looking like a real (but silently zero-row) selection.
  const paymentAccountId =
    rawPaymentAccountId !== undefined && paymentAccounts.some((a) => a.id === rawPaymentAccountId)
      ? rawPaymentAccountId
      : undefined

  // buildTransactionWhere baked the shape-valid id into `where` before we could
  // confirm it exists. When the existence check above rejected it, strip it from
  // `where` too — otherwise the list silently filters to zero rows against an id
  // the dropdown shows as unselected, and the CSV export href (built from the
  // returned value) disagrees with the page.
  if (paymentAccountId === undefined) {
    delete (where as { paymentAccountId?: number }).paymentAccountId
  }

  // When q is present we must fetch ALL records matching the other filters then
  // decrypt+filter in memory — descriptions are AES-encrypted so DB-level LIKE
  // is not possible. Without this, matches beyond the first TX_CAP rows are silently missed.
  const [rawTransactions, totalCount, incomeAgg, expenseAgg, accounts, families, lockDate] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { date: "desc" },
      // Page at DB level when not searching; search needs the full result set
      // (descriptions are encrypted), so it paginates in memory below — capped.
      // Flat take/skip (not a conditional spread) so the findMany args stay a
      // single object type; skip stays undefined on the search path, which
      // paginates in memory after decrypting rather than at the DB.
      take: q ? SEARCH_SCAN_CAP : TX_CAP,
      skip: q ? undefined : (page - 1) * TX_CAP,
      include: {
        account: { select: { code: true, name: true } },
        family: { select: { name: true } },
        paymentAccountRel: { select: { id: true, name: true } },
        pettyCashReceipt: { select: { sessionId: true } },
        pettyCashExpense: { select: { sessionId: true } },
        pettyCashTransfer: { select: { sessionId: true } },
      },
    }),
    prisma.transaction.count({ where }),
    // AND-combine rather than spread `type` onto `where`: a spread would OVERRIDE
    // an active type filter (e.g. list filtered to EXPENSE would still show an
    // income total). AND makes the aggregate honour both — income tile → 0 when
    // filtered to EXPENSE, and vice versa.
    prisma.transaction.aggregate({ where: { AND: [where, { type: "INCOME" }] }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { AND: [where, { type: "EXPENSE" }] }, _sum: { amount: true } }),
    prisma.account.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    prisma.family.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getAccountingLockDate(),
  ])

  // Search scanned only the most-recent SEARCH_SCAN_CAP rows; if it filled the
  // cap, older matches may exist beyond it — tell the user to narrow filters.
  const searchTruncated = q.length > 0 && rawTransactions.length === SEARCH_SCAN_CAP

  const decryptedTransactions = rawTransactions.map((tx) => ({
    ...tx,
    description: safeDecrypt(tx.description),
  }))

  const allFiltered = q
    ? decryptedTransactions.filter((tx) =>
        tx.description.toLowerCase().includes(q.toLowerCase())
      )
    : decryptedTransactions

  // total across the full filter set: DB count when not searching, in-memory match
  // count when searching (q can't be pushed to the DB — descriptions are encrypted).
  const total = q ? allFiltered.length : totalCount
  const totalPages = Math.max(1, Math.ceil(total / TX_CAP))
  // Non-search rows are already the current page (DB skip/take); search paginates here.
  const transactions = q
    ? allFiltered.slice((page - 1) * TX_CAP, page * TX_CAP)
    : decryptedTransactions

  // When searching, derive totals from ALL matches (DB aggregates don't include q filter)
  const income = q
    ? centsToNumber(sumCents(allFiltered.filter((t) => t.type === "INCOME").map((t) => t.amount)))
    : Number(incomeAgg._sum.amount ?? 0)
  const expense = q
    ? centsToNumber(sumCents(allFiltered.filter((t) => t.type === "EXPENSE").map((t) => t.amount)))
    : Number(expenseAgg._sum.amount ?? 0)
  const net = centsToNumber(toCents(income) - toCents(expense))

  const startIdx = total === 0 ? 0 : (page - 1) * TX_CAP + 1
  const endIdx = Math.min(page * TX_CAP, total)

  return {
    transactions,
    accounts,
    families,
    paymentAccounts,
    lockDate,
    total,
    totalPages,
    page,
    q,
    income,
    expense,
    net,
    startIdx,
    endIdx,
    searchTruncated,
    type,
    paymentAccountId,
  }
}

/** Full shape returned by `getTransactionsData` — for the page's child components. */
export type TransactionsData = Awaited<ReturnType<typeof getTransactionsData>>
/** One decrypted transaction row as the list/table render it. */
export type TransactionRow = TransactionsData["transactions"][number]
