import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { prisma } from "@/lib/prisma"
import { canViewAccounting } from "@/lib/roleGuard"
import { safeDecrypt } from "@/lib/crypto"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { rateLimit } from "@/lib/rateLimit"
import { generateGeneralLedgerCsv, withRunningBalance } from "@/lib/generalLedgerExport"
import { currentFYYear, fyDateRange } from "@/lib/fiscalYear"
import { sydneyTodayYMD } from "@/lib/dates"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canViewAccounting(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
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

  const accountId = Number.parseInt(sp.get("account") ?? "", 10)
  if (Number.isNaN(accountId) || accountId <= 0 || accountId > 2147483647) {
    return NextResponse.json({ error: "Invalid account" }, { status: 400 })
  }

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { code: true, name: true },
  })
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 })

  const txs = await prisma.transaction.findMany({
    where: { accountId, date: { gte: fyStart, lt: fyEnd } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    take: 10000, // hard cap — bounds memory; descriptions decrypted in-process
    select: { date: true, description: true, reference: true, type: true, amount: true },
  })

  const rows = withRunningBalance(
    txs.map((t) => ({
      date: t.date,
      // safeDecrypt so one corrupt/legacy ciphertext degrades to a placeholder
      // instead of 500-ing the whole export.
      description: safeDecrypt(t.description),
      reference: t.reference,
      type: t.type as "INCOME" | "EXPENSE",
      amount: t.amount,
    })),
  )

  const csv = generateGeneralLedgerCsv(rows)

  const ip = getClientIp(req)
  await logAudit(actorId(session), "EXPORT_FINANCIAL_REPORT", "GeneralLedger", undefined, { report: "general-ledger", accountId, year, rowCount: rows.length }, ip)

  const today = sydneyTodayYMD()
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="general-ledger-${account.code}-${today}.csv"`,
      "cache-control": "no-store",
    },
  })
}
