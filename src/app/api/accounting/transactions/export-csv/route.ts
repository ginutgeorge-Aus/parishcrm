import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canViewAccounting } from "@/lib/roleGuard"
import { safeDecrypt } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"
import { generateTransactionCsv } from "@/lib/transactionExport"
import { parseISODate } from "@/lib/formatting"
import { endOfDayUTC } from "@/lib/dates"
import { currentFYYear, fyDateRange } from "@/lib/fiscalYear"
import { sydneyTodayYMD } from "@/lib/dates"
import { TransactionType } from "@/lib/generated/prisma/enums"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canViewAccounting(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  // Each call decrypts up to 10k descriptions; cap per-user volume.
  if (!rateLimit(`export:transactions:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const sp = req.nextUrl.searchParams

  const parseDate = parseISODate
  const ID = /^\d+$/
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

  // Default to FY start (July–June), matching report pages.
  const defaultFrom = fyDateRange(currentFYYear()).start

  // Validate enum params: an arbitrary string cast to a Prisma enum
  // throws uncaught at query time and leaks a 500.
  const type = sp.get("type")
  if (type && !Object.values(TransactionType).includes(type as TransactionType)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 })
  }
  // paymentAccount is now a numeric PaymentAccount.id (FK, not an enum) —
  // reuse the same malformed-id 400 as account/family/fund below.
  const paymentAccountId = parseId(sp.get("paymentAccount"))
  if (paymentAccountId === null) return NextResponse.json({ error: "Invalid paymentAccount" }, { status: 400 })

  const accountId = parseId(sp.get("account"))
  if (accountId === null) return NextResponse.json({ error: "Invalid account" }, { status: 400 })
  const familyId = parseId(sp.get("family"))
  if (familyId === null) return NextResponse.json({ error: "Invalid family" }, { status: 400 })

  // Fund filter mirrors the list page: "none" = untagged rows, else a
  // specific fund id (malformed → 400). Absent → all funds.
  const fundParam = sp.get("fund")
  const fundId = fundParam === "none" ? undefined : parseId(fundParam)
  if (fundId === null) return NextResponse.json({ error: "Invalid fund" }, { status: 400 })

  // A malformed ?from=/?to= used to silently fall back to FY start / drop the
  // upper bound, broadening the export outside the caller's requested period
  // without signalling the filter was ignored. Reject it explicitly.
  const fromParam = sp.get("from")
  const from = fromParam === null ? defaultFrom : parseDate(fromParam)
  if (from === null) return NextResponse.json({ error: "Invalid date" }, { status: 400 })
  const toParam = sp.get("to")
  const to = toParam === null ? null : parseDate(toParam)
  if (toParam !== null && to === null) return NextResponse.json({ error: "Invalid date" }, { status: 400 })

  const where = {
    date: {
      gte: from,
      ...(to && { lte: endOfDayUTC(to) }),
    },
    ...(accountId !== undefined && { accountId }),
    ...(type && { type: type as TransactionType }),
    ...(familyId !== undefined && { familyId }),
    ...(paymentAccountId !== undefined && { paymentAccountId }),
    ...(sp.get("reconciled") === "true" && { reconciled: true }),
    ...(sp.get("reconciled") === "false" && { reconciled: false }),
    ...(fundParam === "none" ? { fundId: null } : fundId !== undefined && { fundId }),
  }

  const q = sp.get("q") ?? ""

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { date: "desc" },
    take: q ? undefined : 10000, // cap non-search exports to bound memory; skip when q is set so all text matches are found
    include: {
      account: { select: { code: true, name: true } },
      family: { select: { name: true } },
      person: { select: { firstName: true, lastName: true } },
      paymentAccountRel: { select: { name: true } },
    },
  })

  let rows = transactions.map((tx) => ({
    ...tx,
    // safeDecrypt so one corrupt/legacy ciphertext degrades to a placeholder
    // instead of 500-ing the whole export.
    description: safeDecrypt(tx.description),
    // notes is unencrypted for manually-keyed rows but encrypted for
    // bank-import rows — safeDecrypt is a no-op on plaintext.
    notes: tx.notes ? safeDecrypt(tx.notes) : tx.notes,
    paymentAccountName: tx.paymentAccountRel?.name ?? null,
  }))

  // description is AES-encrypted at rest, so substring search cannot run in
  // the DB query — it must run app-side after decrypt.
  if (q) {
    rows = rows.filter((tx) =>
      tx.description.toLowerCase().includes(q.toLowerCase())
    )
  }

  const csv = generateTransactionCsv(rows)

  const userId = actorId(session)
  const ip = getClientIp(req)
  await logAudit(userId, "EXPORT_TRANSACTION_CSV", "Transaction", undefined, { rowCount: rows.length }, ip)

  const today = sydneyTodayYMD()

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="transactions-${today}.csv"`,
      "cache-control": "no-store",
    },
  })
}
