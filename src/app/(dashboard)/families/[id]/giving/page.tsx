import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canViewAccounting, canAccessAccounting } from "@/lib/roleGuard"
import { safeDecrypt } from "@/lib/crypto"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { YearSelector } from "@/components/accounting/YearSelector"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { GivingTrendChartLazy } from "@/components/accounting/GivingTrendChartLazy"
import { currentFYYear } from "@/lib/fiscalYear"
import { MONTH_ABBR, toCents, centsToNumber, sumCents, fmtAUD } from "@/lib/formatting"

// FY month order: Jul–Jun (calendar month indexes). Module-level so it isn't
// rebuilt per request.
const FY_MONTH_ORDER = [6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5] as const

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ year?: string }>
}

export default async function FamilyGivingPage(props: Props) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams])

  const session = await auth()
  if (!session) redirect("/login")
  if (!canViewAccounting(session.user.role)) redirect("/")

  const id = parseInt(params.id, 10)
  if (isNaN(id) || id <= 0 || id > 2147483647) notFound()

  const family = await prisma.family.findUnique({
    where: { id },
    select: { id: true, name: true, archivedAt: true },
  })
  // Archived families live only at /families/archived (ADMIN); block direct-URL
  // access so archived giving history can't be loaded by any canViewAccounting role.
  if (!family || family.archivedAt) notFound()

  const fyNow = currentFYYear()
  const parsedYear = parseInt(searchParams.year ?? String(fyNow), 10)
  const year = parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : fyNow

  const fyStart = new Date(`${year}-07-01`)
  const fyEnd = new Date(`${year + 1}-07-01`)

  const transactions = await prisma.transaction.findMany({
    where: {
      familyId: id,
      isGiving: true,
      date: { gte: fyStart, lt: fyEnd },
    },
    orderBy: { date: "desc" },
    select: {
      id: true,
      date: true,
      description: true,
      amount: true,
      receiptSends: { select: { status: true } },
    },
    take: 1000, // bound the per-family FY giving scan
  })

  const decrypted = transactions.map((t) => ({
    ...t,
    description: safeDecrypt(t.description),
  }))

  const total = centsToNumber(sumCents(decrypted.map((t) => t.amount)))

  // Bucket in integer cents, convert to dollars only at the chart boundary.
  const monthlyCents: Record<number, number> = {}
  for (const t of decrypted) {
    const m = t.date.getUTCMonth()
    monthlyCents[m] = (monthlyCents[m] ?? 0) + toCents(t.amount)
  }
  const chartData = FY_MONTH_ORDER.map((m) => ({
    month: MONTH_ABBR[m],
    amount: centsToNumber(monthlyCents[m] ?? 0),
  }))

  // Edit link targets a route gated on canAccessAccounting.
  const userCanEdit = canAccessAccounting(session?.user?.role)

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground mb-1">
          <Link href="/families" className="hover:underline">Families</Link>
          {" / "}
          <Link href={`/families/${family.id}`} className="hover:underline">{family.name}</Link>
          {" / Giving History"}
        </p>
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-foreground">
            {family.name} — Giving History
          </h2>
          <YearSelector currentYear={year} />
        </div>
      </div>

      {decrypted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No giving recorded for FY {year}–{String(year + 1).slice(2)}. Try selecting another year.
        </p>
      ) : (
        <div>
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Monthly giving — FY {year}–{String(year + 1).slice(2)}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <GivingTrendChartLazy data={chartData} />
            </CardContent>
          </Card>
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {decrypted.map((t) => {
                const receiptSent = t.receiptSends.some((r) => r.status === "SUCCESS")
                return (
                  <TableRow key={t.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {`${String(t.date.getUTCDate()).padStart(2, "0")}/${String(t.date.getUTCMonth() + 1).padStart(2, "0")}/${t.date.getUTCFullYear()}`}
                    </TableCell>
                    <TableCell className="text-sm">
                      {userCanEdit ? (
                        <Link
                          href={`/accounting/transactions/${t.id}/edit`}
                          className="hover:underline"
                        >
                          {t.description}
                        </Link>
                      ) : (
                        t.description
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-income tabular">
                      {fmtAUD(Number(t.amount))}
                    </TableCell>
                    <TableCell>
                      {receiptSent ? (
                        <Badge className="bg-success/10 text-success hover:bg-success/10">
                          Sent
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          </div>
          <div className="flex justify-end mt-3 pt-3 border-t">
            <span className="text-sm font-medium">
              Total giving:{" "}
              <span className="text-income tabular">{fmtAUD(total)}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
