import { NextRequest, NextResponse } from "next/server"
import { guardAccountingExport } from "@/lib/reports/exportGuard"
import { prisma } from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/clientIp"
import { generateBalanceSheetCsv, type BalanceSheetRow } from "@/lib/reports/balanceSheetExport"
import { toCents, type Money } from "@/lib/formatting"
import { TransactionType } from "@/lib/generated/prisma/enums"
import { sydneyToday, sydneyTodayYMD, endOfDayUTC } from "@/lib/dates"
import { getPaymentAccounts } from "@/lib/paymentAccounts"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Kept local, mirroring the Balance Sheet page's own parseDate (kept local there too).
function parseDate(s: string | null): Date | null {
  if (!s || !ISO_DATE.test(s)) return null
  const [y, m, day] = s.split("-").map(Number)
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  if (d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== m || d.getUTCDate() !== day) return null
  return d
}

function toYMD(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

export async function GET(req: NextRequest) {
  const guard = await guardAccountingExport("balance-sheet")
  if (guard instanceof NextResponse) return guard

  // A malformed ?date= used to silently fall back to today — the
  // caller has no way to tell their filter was ignored and is looking at the
  // wrong figures. Reject it explicitly, mirroring general-ledger's ?account=
  // 400. Absent param still defaults to today.
  const dateParam = req.nextUrl.searchParams.get("date")
  const asAtDate = dateParam === null ? sydneyToday() : parseDate(dateParam)
  if (asAtDate === null) return NextResponse.json({ error: "Invalid date" }, { status: 400 })
  const endOfDay = endOfDayUTC(asAtDate)

  // Mirrors the Balance Sheet page query exactly so the export never drifts from screen totals.
  // Reports show all accounts (incl. deactivated-with-history), not just active ones.
  const accounts = await getPaymentAccounts({ activeOnly: false })
  const openingBalances = await prisma.accountOpeningBalance.findMany({
    where: { paymentAccountId: { in: accounts.map((a) => a.id) } },
  })
  const obByAccountId = new Map(openingBalances.map((ob) => [ob.paymentAccountId, ob]))

  function agg(accountId: number, ob: { asOfDate: Date } | null, type: TransactionType) {
    if (!ob || endOfDay < ob.asOfDate) return Promise.resolve({ _sum: { amount: null } })
    return prisma.transaction.aggregate({
      where: { paymentAccountId: accountId, type, date: { gte: ob.asOfDate, lte: endOfDay } },
      _sum: { amount: true },
    })
  }

  const activeAt = (ob: { asOfDate: Date } | null) => !!ob && endOfDay >= ob.asOfDate

  const build = (
    label: string,
    ob: { amount: { toString(): string }; asOfDate: Date } | null,
    inSum: { _sum: { amount: Money } },
    outSum: { _sum: { amount: Money } },
  ): BalanceSheetRow => {
    if (!activeAt(ob)) return { label, openingCents: null, openingAsOf: null, incomeCents: null, expenseCents: null, balanceCents: null }
    const incomeCents = toCents(inSum._sum.amount ?? 0)
    const expenseCents = toCents(outSum._sum.amount ?? 0)
    const openingCents = toCents(ob!.amount)
    return {
      label,
      openingCents,
      openingAsOf: ob!.asOfDate,
      incomeCents,
      expenseCents,
      balanceCents: openingCents + incomeCents - expenseCents,
    }
  }

  const rows: BalanceSheetRow[] = await Promise.all(
    accounts.map(async (acct) => {
      const ob = obByAccountId.get(acct.id) ?? null
      const [incomeAgg, expenseAgg] = await Promise.all([
        agg(acct.id, ob, TransactionType.INCOME),
        agg(acct.id, ob, TransactionType.EXPENSE),
      ])
      return build(acct.name, ob, incomeAgg, expenseAgg)
    })
  )

  const definedBalances = rows.filter((r) => r.balanceCents !== null).map((r) => r.balanceCents!)
  // `balanceCents` values are ALREADY integer cents (built via toCents above), so
  // add them with plain integer addition. Feeding them back through sumCents (which
  // re-applies toCents, treating its input as dollars) inflated the footer total
  // 100× and made the CSV inconsistent with its own account rows.
  const totalBalanceCents = definedBalances.length > 0 ? definedBalances.reduce((a, b) => a + b, 0) : null

  const csv = generateBalanceSheetCsv(rows, totalBalanceCents)

  const ip = getClientIp(req)
  await logAudit(guard.actor, "EXPORT_FINANCIAL_REPORT", "BalanceSheet", undefined, { report: "balance-sheet", date: toYMD(asAtDate) }, ip)

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="balance-sheet-${toYMD(asAtDate)}-${sydneyTodayYMD()}.csv"`,
      "cache-control": "no-store",
    },
  })
}
