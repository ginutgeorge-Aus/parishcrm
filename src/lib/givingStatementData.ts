import "server-only"
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { fyDateRange } from "@/lib/fiscalYear"
import { isValidEmail } from "@/lib/validation"
import { buildStatements, type FamilyStatement } from "@/lib/givingStatement"

// Bound the per-FY scan so a runaway ledger can't load unbounded rows. A parish
// records well under this many gifts a year. Hitting the cap throws rather than
// returning understated totals.
const GIFT_SCAN_CAP = 50_000

const ROLE_ORDER: Record<string, number> = { HEAD: 0, SPOUSE: 1, CHILD: 2, OTHER: 3 }

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
  const { start, end } = fyDateRange(fyStartYear)
  const rows = await prisma.transaction.findMany({
    where: {
      isGiving: true,
      type: "INCOME",
      date: { gte: start, lt: end },
      familyId: familyIds ? { in: familyIds } : { not: null },
    },
    orderBy: { date: "asc" },
    take: GIFT_SCAN_CAP + 1,
    select: {
      date: true,
      description: true,
      amount: true,
      familyId: true,
      fund: { select: { name: true } },
    },
  })
  if (rows.length > GIFT_SCAN_CAP) throw new Error("Too many gifts in this financial year to build statements safely.")
  const gifts = rows.flatMap((r) =>
    r.familyId == null
      ? []
      : [{ date: r.date, description: safeDecrypt(r.description), amount: r.amount, fundName: r.fund?.name ?? null, familyId: r.familyId }]
  )
  return buildStatements(gifts)
}

export type StatementFamily = {
  id: number
  name: string
  /** Decrypted, valid, consenting member emails; head of family first. */
  emails: string[]
}

/**
 * Load display name and consenting recipient emails for non-archived families.
 * Members who opted out of email (emailConsent=false) are never included.
 * @param ids family ids
 */
export async function loadStatementFamilies(ids: number[]): Promise<Map<number, StatementFamily>> {
  const families = await prisma.family.findMany({
    where: { id: { in: ids }, archivedAt: null },
    select: { id: true, name: true, people: { where: { archivedAt: null }, select: { email: true, emailConsent: true, role: true } } },
  })
  return new Map(
    families.map((f) => {
      const emails = f.people
        .filter((p) => p.email && p.emailConsent)
        .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9))
        .map((p) => safeDecrypt(p.email as string).trim())
        .filter((e) => isValidEmail(e))
      return [f.id, { id: f.id, name: f.name, emails: Array.from(new Set(emails)) }]
    })
  )
}
