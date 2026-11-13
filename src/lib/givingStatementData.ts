import "server-only"
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { fyDateRange } from "@/lib/fiscalYear"
import { isValidEmail } from "@/lib/validation"
import { toCents } from "@/lib/formatting"
import { buildStatements, type FamilyStatement } from "@/lib/givingStatement"

// Bound the per-FY scan so a runaway ledger can't load unbounded rows. A parish
// records well under this many gifts a year. Hitting the cap throws rather than
// returning understated totals.
const GIFT_SCAN_CAP = 50_000

const ROLE_ORDER: Record<string, number> = { HEAD: 0, SPOUSE: 1, CHILD: 2, OTHER: 3 }

/** Where-clause shared by every statement query: income gifts attributed to a family in the FY. */
function giftWhere(fyStartYear: number, familyIds?: number[]) {
  const { start, end } = fyDateRange(fyStartYear)
  return {
    isGiving: true,
    type: "INCOME" as const,
    date: { gte: start, lt: end },
    familyId: familyIds ? { in: familyIds } : { not: null },
  }
}

/**
 * Per-family gift count and total for a FY, computed in the database (same filters as
 * getGivingSummary). The list view needs nothing more, so no gift rows are loaded.
 * @param fyStartYear FY start year
 * @returns map of familyId to gift count and total in integer cents
 */
export async function loadStatementSummaries(fyStartYear: number): Promise<Map<number, { giftCount: number; totalCents: number }>> {
  const grouped = await prisma.transaction.groupBy({
    by: ["familyId"],
    where: giftWhere(fyStartYear),
    _sum: { amount: true },
    _count: { _all: true },
  })
  return new Map(
    grouped.flatMap((g) =>
      g.familyId == null ? [] : [[g.familyId, { giftCount: g._count._all, totalCents: toCents(g._sum.amount ?? 0) }] as const]
    )
  )
}

/**
 * Load grouped giving statements for one financial year. Gifts are INCOME
 * transactions flagged isGiving; isGiving is only ever set together with a
 * familyId (`isGiving = !!familyId` at every write site), so the transaction's
 * own familyId is the owner.
 * @param fyStartYear FY start year
 * @param familyIds restrict to these families (omit for all)
 * @throws when the FY has more gifts than the scan cap (totals would be understated)
 */
export async function loadStatements(fyStartYear: number, familyIds?: number[]): Promise<Map<number, FamilyStatement>> {
  const rows = await prisma.transaction.findMany({
    where: giftWhere(fyStartYear, familyIds),
    orderBy: { date: "asc" },
    take: GIFT_SCAN_CAP + 1,
    // No description: statements show date, fund and amount only, so ledger text is never read or decrypted.
    select: {
      date: true,
      amount: true,
      familyId: true,
      fund: { select: { name: true } },
    },
  })
  if (rows.length > GIFT_SCAN_CAP) throw new Error("Too many gifts in this financial year to build statements safely.")
  const gifts = rows.flatMap((r) =>
    r.familyId == null
      ? []
      : [{ date: r.date, amount: r.amount, fundName: r.fund?.name ?? null, familyId: r.familyId }]
  )
  return buildStatements(gifts)
}

export type StatementFamily = {
  id: number
  name: string
  /** True when the family is archived (still listed and previewable, never emailed). */
  archived: boolean
  /** True when the family is not archived and a consenting member has a valid email. Decided server-side; addresses never leave it. */
  canEmail: boolean
  /** Decrypted, valid, consenting member emails; head of family first. Empty unless requested. */
  emails: string[]
}

/**
 * Load display name and consenting recipient emails. Archived families are included
 * (flagged) so their gifts are not silently dropped; they are never emailed. Members who
 * opted out (emailConsent=false) or are archived are never used. Addresses are always
 * decrypted and validated here (the same isValidEmail the send path uses) so `canEmail`
 * is accurate, but they are only returned when `withEmails` is set.
 * @param ids family ids
 * @param withEmails return the decrypted addresses (only the send path needs them)
 */
export async function loadStatementFamilies(ids: number[], withEmails = true): Promise<Map<number, StatementFamily>> {
  const families = await prisma.family.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      archivedAt: true,
      // Same deterministic order as getGivingSummary: role asc (HEAD first), then first name.
      people: { where: { archivedAt: null }, orderBy: [{ role: "asc" }, { firstName: "asc" }, { lastName: "asc" }, { id: "asc" }], select: { email: true, emailConsent: true, role: true } },
    },
  })
  return new Map(
    families.map((f) => {
      const archived = f.archivedAt != null
      const emails = Array.from(
        new Set(
          f.people
            .filter((p) => p.email && p.emailConsent)
            // Stable sort keeps the firstName order within a role.
            .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9))
            .map((p) => safeDecrypt(p.email as string).trim())
            .filter((e) => isValidEmail(e))
        )
      )
      return [f.id, { id: f.id, name: f.name, archived, canEmail: !archived && emails.length > 0, emails: withEmails ? emails : [] }]
    })
  )
}
