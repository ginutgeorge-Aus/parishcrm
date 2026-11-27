import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canViewAccounting } from "@/lib/roleGuard"
import { safeDecrypt } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { auditIpFromRequest } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"
import { generateGeneralLedgerCsv, withRunningBalance } from "@/lib/generalLedgerExport"
import { currentFYYear, fyDateRange } from "@/lib/fiscalYear"
import { sydneyTodayYMD } from "@/lib/dates"
import { parseRouteId } from "@/lib/validation"
import { featureNotFound } from "@/lib/featureFlags"
import { filenameSlug } from "@/lib/filenameSlug"

/** Most ledger rows one export reads; one more is fetched to detect truncation. */
const EXPORT_ROW_CAP = 10000

/** GET /api/accounting/reports/general-ledger/export-csv. Accounting viewers only. */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canViewAccounting(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const off = await featureNotFound("accounting")
  if (off) return off
  // Each call decrypts up to 10k descriptions; cap per-user volume.
  if (!rateLimit(`export:gl:${actorId(session)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const sp = req.nextUrl.searchParams

  const fyNow = currentFYYear()
  const rawYear = sp.get("year")
  const parsedYear = rawYear == null ? fyNow : Number(rawYear)
  if (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > fyNow + 10) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 })
  }
  const year = parsedYear
  const { start: fyStart, end: fyEnd } = fyDateRange(year)

  const accountId = parseRouteId(sp.get("account") ?? "")
  if (accountId === null) {
    return NextResponse.json({ error: "Invalid account" }, { status: 400 })
  }

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { code: true, name: true },
  })
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 })

  const fetched = await prisma.transaction.findMany({
    where: { accountId, date: { gte: fyStart, lt: fyEnd } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    take: EXPORT_ROW_CAP + 1, // hard cap — bounds memory; the extra row detects truncation (AUD-2-08)
    select: { date: true, description: true, reference: true, type: true, amount: true },
  })
  const truncated = fetched.length > EXPORT_ROW_CAP
  const txs = truncated ? fetched.slice(0, EXPORT_ROW_CAP) : fetched

  const rows = withRunningBalance(
    txs.map((t) => ({
      date: t.date,
      // safeDecrypt so one corrupt/legacy ciphertext degrades to a placeholder
      // instead of 500-ing the whole export.
      description: safeDecrypt(t.description),
      reference: t.reference ? safeDecrypt(t.reference) : null,
      type: t.type as "INCOME" | "EXPENSE",
      amount: t.amount,
    })),
  )

  // A browser download hides response headers, so a truncated ledger also ends with a visible
  // note: the running balance in a cut-off file would otherwise look final.
  let csv = generateGeneralLedgerCsv(rows)
  if (truncated) {
    csv += `\nExport truncated at ${EXPORT_ROW_CAP} rows (oldest first); the running balance is incomplete and later rows are not included.\n`
  }

  const ip = auditIpFromRequest(req)
  await logAudit(actorId(session), "EXPORT_FINANCIAL_REPORT", "GeneralLedger", undefined, { report: "general-ledger", accountId, year, rowCount: rows.length, truncated }, ip)

  const today = sydneyTodayYMD()
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="general-ledger-${filenameSlug(account.code, "account")}-${today}.csv"`,
      "cache-control": "no-store",
      ...(truncated && { "x-export-truncated": "true" }),
    },
  })
}
