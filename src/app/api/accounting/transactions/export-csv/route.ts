import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canViewAccounting } from "@/lib/roleGuard"
import { safeDecrypt } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { auditIpFromRequest } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"
import { generateTransactionCsv } from "@/lib/transactionExport"
import { parseISODate } from "@/lib/formatting"
import { endOfDayUTC, sydneyTodayYMD } from "@/lib/dates"
import { currentFYYear, fyDateRange } from "@/lib/fiscalYear"
import { TransactionType } from "@/lib/generated/prisma/enums"
import { featureNotFound } from "@/lib/featureFlags"

const ID = /^\d+$/

/** Most rows the export reads from the database (newest first). With a search term this is the scan window, not the match count. */
const EXPORT_ROW_CAP = 10000
/** Rows per page when a search scans the whole range (descriptions are encrypted, so SQL cannot filter). */
const SEARCH_PAGE_SIZE = 2000
/** Max rows a search decrypts in one request (5x the export cap); bounds CPU per call. */
const SEARCH_SCAN_CAP = EXPORT_ROW_CAP * 5

// Tri-state: the parsed id, `null` when the param is present but malformed
// (caller 400s), or `undefined` when absent (filter omitted). Rejecting a
// malformed id instead of silently omitting it stops the export broadening to
// ALL records, and `/^\d+$/` stops "12abc" truncating to id 12.
function parseId(s: string | null): number | null | undefined {
  if (s === null) return undefined
  if (!ID.test(s)) return null
  const n = Number.parseInt(s, 10)
  return n <= 0 || n > 2147483647 ? null : n
}

type TransactionWhereInput = {
  from: Date
  to: Date | null
  accountId: number | undefined
  type: string | null
  familyId: number | undefined
  paymentAccountId: number | undefined
  reconciled: string | null
  fundParam: string | null
  fundId: number | undefined
}

// Builds the Prisma `where` filter from the request's validated query params.
function buildTransactionWhere(f: TransactionWhereInput) {
  return {
    date: {
      gte: f.from,
      // No end date: stop at the end of the current financial year, as the list page does.
      // A `from` already past that end keeps the range open, so a later-FY export is not silently empty.
      ...(f.to
        ? { lte: endOfDayUTC(f.to) }
        : f.from && f.from >= fyDateRange(currentFYYear()).end
          ? {}
          : { lt: fyDateRange(currentFYYear()).end }),
    },
    ...(f.accountId !== undefined && { accountId: f.accountId }),
    ...(f.type && { type: f.type as TransactionType }),
    ...(f.familyId !== undefined && { familyId: f.familyId }),
    ...(f.paymentAccountId !== undefined && { paymentAccountId: f.paymentAccountId }),
    ...(f.reconciled === "true" && { reconciled: true }),
    ...(f.reconciled === "false" && { reconciled: false }),
    ...(f.fundParam === "none" ? { fundId: null } : f.fundId !== undefined && { fundId: f.fundId }),
  }
}

type TransactionWhere = ReturnType<typeof buildTransactionWhere>

// Discriminated union (not an `{error}`/`{data}` object-literal union) so the
// `ok` check below narrows cleanly — a plain `error?` field would not.
type ExportParamsResult =
  | { ok: false; error: string }
  | { ok: true; where: TransactionWhere; q: string }

// Parses and validates every export query param, in the same order/messages
// as before. Returns a 400 error message on the first malformed param, else
// the Prisma `where` filter and free-text search term.
function parseExportParams(sp: URLSearchParams): ExportParamsResult {
  const parseDate = parseISODate

  // Default to FY start (July–June), matching report pages.
  const defaultFrom = fyDateRange(currentFYYear()).start

  // Validate enum params: an arbitrary string cast to a Prisma enum
  // throws uncaught at query time and leaks a 500.
  const type = sp.get("type")
  if (type && !Object.values(TransactionType).includes(type as TransactionType)) {
    return { ok: false, error: "Invalid type" }
  }
  // paymentAccount is now a numeric PaymentAccount.id (FK, not an enum) —
  // reuse the same malformed-id 400 as account/family/fund below.
  const paymentAccountId = parseId(sp.get("paymentAccount"))
  if (paymentAccountId === null) return { ok: false, error: "Invalid paymentAccount" }

  const accountId = parseId(sp.get("account"))
  if (accountId === null) return { ok: false, error: "Invalid account" }
  const familyId = parseId(sp.get("family"))
  if (familyId === null) return { ok: false, error: "Invalid family" }

  // Fund filter mirrors the list page: "none" = untagged rows, else a
  // specific fund id (malformed → 400). Absent → all funds.
  const fundParam = sp.get("fund")
  const fundId = fundParam === "none" ? undefined : parseId(fundParam)
  if (fundId === null) return { ok: false, error: "Invalid fund" }

  // A malformed ?from=/?to= used to silently fall back to FY start / drop the
  // upper bound, broadening the export outside the caller's requested period
  // without signalling the filter was ignored. Reject it explicitly.
  const fromParam = sp.get("from")
  const from = fromParam === null ? defaultFrom : parseDate(fromParam)
  if (from === null) return { ok: false, error: "Invalid date" }
  const toParam = sp.get("to")
  const to = toParam === null ? null : parseDate(toParam)
  if (toParam !== null && to === null) return { ok: false, error: "Invalid date" }

  const where = buildTransactionWhere({
    from,
    to,
    accountId,
    type,
    familyId,
    paymentAccountId,
    reconciled: sp.get("reconciled"),
    fundParam,
    fundId,
  })

  return { ok: true, where, q: sp.get("q") ?? "" }
}

/** GET /api/accounting/transactions/export-csv. Accounting viewers only. */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canViewAccounting(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const off = await featureNotFound("accounting")
  if (off) return off
  // Each call decrypts up to 10k descriptions; cap per-user volume.
  if (!rateLimit(`export:transactions:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const sp = req.nextUrl.searchParams

  const parsed = parseExportParams(sp)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { where, q } = parsed

  const include = {
    account: { select: { code: true, name: true } },
    family: { select: { name: true } },
    person: { select: { firstName: true, lastName: true } },
    paymentAccountRel: { select: { name: true } },
  } as const
  const decryptRow = (tx: Awaited<ReturnType<typeof fetchPage>>[number]) => ({
    ...tx,
    // safeDecrypt so one corrupt/legacy ciphertext degrades to a placeholder
    // instead of 500-ing the whole export.
    description: safeDecrypt(tx.description),
    // notes is unencrypted for manually-keyed rows but encrypted for
    // bank-import rows — safeDecrypt is a no-op on plaintext.
    notes: tx.notes ? safeDecrypt(tx.notes) : tx.notes,
    reference: tx.reference ? safeDecrypt(tx.reference) : tx.reference,
    paymentAccountName: tx.paymentAccountRel?.name ?? null,
  })
  function fetchPage(take: number, cursorId?: number) {
    return prisma.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take,
      ...(cursorId !== undefined && { cursor: { id: cursorId }, skip: 1 }),
      include,
    })
  }

  let rows: ReturnType<typeof decryptRow>[] = []
  let truncated = false
  if (q) {
    // description is AES-encrypted at rest, so substring search cannot run in the DB. Scan the whole
    // range in pages, decrypt app-side, and keep only matches (bounded by EXPORT_ROW_CAP + 1).
    const needle = q.toLowerCase()
    let cursorId: number | undefined
    let scanned = 0
    scan: for (;;) {
      const page = await fetchPage(SEARCH_PAGE_SIZE, cursorId)
      for (const tx of page) {
        const row = decryptRow(tx)
        if (!row.description.toLowerCase().includes(needle)) continue
        if (rows.length === EXPORT_ROW_CAP) {
          truncated = true
          break scan
        }
        rows.push(row)
      }
      scanned += page.length
      if (page.length < SEARCH_PAGE_SIZE) break
      if (scanned >= SEARCH_SCAN_CAP) {
        truncated = true
        break
      }
      cursorId = page[page.length - 1].id
    }
  } else {
    // One extra row tells us whether the cap cut the result short.
    const fetched = await fetchPage(EXPORT_ROW_CAP + 1)
    truncated = fetched.length > EXPORT_ROW_CAP
    rows = fetched.slice(0, EXPORT_ROW_CAP).map(decryptRow)
  }

  // A browser download hides response headers, so a truncated file also ends with a visible note
  // (the x-export-truncated header is for scripts).
  let csv = generateTransactionCsv(rows)
  if (truncated) {
    csv += `\nExport truncated at ${EXPORT_ROW_CAP} rows (newest first). Narrow the date range or search to export the rest.\n`
  }

  const userId = actorId(session)
  const ip = auditIpFromRequest(req)
  await logAudit(userId, "EXPORT_TRANSACTION_CSV", "Transaction", undefined, { rowCount: rows.length, truncated }, ip)

  const today = sydneyTodayYMD()

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="transactions-${today}.csv"`,
      "cache-control": "no-store",
      ...(truncated && { "x-export-truncated": "true" }),
    },
  })
}
