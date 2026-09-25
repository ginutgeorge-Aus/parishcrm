import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { fyDateRange } from "@/lib/fiscalYear"
import { toCents, centsToNumber, formatDMY } from "@/lib/formatting"
import { escapeCsv } from "@/lib/csvUtils"

export type GivingSummaryRow = {
  familyId: number
  familyName: string
  memberNo: string | null
  email: string // primary contact email, decrypted; "" if none
  totalCents: number // integer cents — convert to dollars only at render
  txCount: number
  lastGiving: Date | null
}

/**
 * Cross-family giving summary for a financial year.
 * One row per family with at least one giving transaction in the FY,
 * sorted by total giving descending. Primary contact email = first
 * member (by role then name) with an email on file.
 *
 * `includeEmail` gates the decrypted primary-email field — callers must
 * pass `canViewPeople(role)` so AUDITOR (accounting-only) never has
 * member PII decrypted into memory, matching the CSV/page render gate
 *. Defaults `true` for back-compat call sites that already
 * enforce their own gate.
 */
export async function getGivingSummary(
  year: number,
  includeEmail = true
): Promise<GivingSummaryRow[]> {
  const { start, end } = fyDateRange(year)

  const grouped = await prisma.transaction.groupBy({
    by: ["familyId"],
    // `isGiving` is always `!!familyId` regardless of type, so a family-linked
    // EXPENSE (e.g. a benevolence payment) would otherwise be summed INTO the
    // family's giving total. Giving is income-only — filter on type.
    where: { type: "INCOME", isGiving: true, familyId: { not: null }, date: { gte: start, lt: end } },
    _sum: { amount: true },
    _count: { _all: true },
    _max: { date: true },
  })

  const familyIds = grouped
    .map((g) => g.familyId)
    .filter((id): id is number => id !== null)
  if (familyIds.length === 0) return []

  const families = await prisma.family.findMany({
    where: { id: { in: familyIds } },
    select: {
      id: true,
      name: true,
      memberNo: true,
      // role asc orders HEAD→SPOUSE→CHILD→OTHER; first with an email = primary contact.
      people: {
        where: { archivedAt: null },
        orderBy: [{ role: "asc" }, { firstName: "asc" }],
        select: { email: true },
      },
    },
  })
  const familyById = new Map(families.map((f) => [f.id, f]))

  const rows: GivingSummaryRow[] = grouped.map((g) => {
    const fam = familyById.get(g.familyId as number)
    const emailCipher = includeEmail
      ? (fam?.people.find((p) => p.email)?.email ?? null)
      : null
    return {
      familyId: g.familyId as number,
      familyName: fam?.name ?? "(deleted family)",
      memberNo: fam?.memberNo ?? null,
      email: emailCipher ? safeDecrypt(emailCipher) : "",
      totalCents: toCents(g._sum.amount ?? 0),
      txCount: g._count._all,
      lastGiving: g._max.date ?? null,
    }
  })

  rows.sort((a, b) => b.totalCents - a.totalCents)
  return rows
}

const CSV_HEADERS_WITH_EMAIL = [
  "Family",
  "Member No",
  "Primary Email",
  "Total Giving",
  "Transactions",
  "Last Giving Date",
]
const CSV_HEADERS_NO_EMAIL = CSV_HEADERS_WITH_EMAIL.filter((h) => h !== "Primary Email")

// `includeEmail` must match the `canViewPeople(role)` gate used on the
// report page — AUDITOR (accounting-only) gets the column omitted
// entirely rather than blanked.
export function generateGivingSummaryCsv(
  rows: GivingSummaryRow[],
  includeEmail = true
): string {
  const csvRows = rows.map((r) =>
    [
      r.familyName,
      r.memberNo ?? "",
      ...(includeEmail ? [r.email] : []),
      centsToNumber(r.totalCents).toFixed(2),
      r.txCount,
      r.lastGiving ? formatDMY(r.lastGiving) : "",
    ]
      .map(escapeCsv)
      .join(",")
  )
  const headers = includeEmail ? CSV_HEADERS_WITH_EMAIL : CSV_HEADERS_NO_EMAIL
  return [headers.map(escapeCsv).join(","), ...csvRows].join("\n")
}
