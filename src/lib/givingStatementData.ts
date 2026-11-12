import "server-only"
import { prisma } from "@/lib/prisma"
import { safeDecrypt } from "@/lib/crypto"
import { fyDateRange } from "@/lib/fiscalYear"
import { isValidEmail } from "@/lib/validation"
import { buildStatements, type FamilyStatement } from "@/lib/givingStatement"

// Bound the per-FY scan so a runaway ledger can't load unbounded rows. A parish
// records well under this many gifts a year; the cap is a safety net, not a design limit.
const GIFT_SCAN_CAP = 50_000

const ROLE_ORDER: Record<string, number> = { HEAD: 0, SPOUSE: 1, CHILD: 2, OTHER: 3 }

/**
 * Load grouped giving statements for one financial year. A gift belongs to the
 * family on the transaction, or else to the giving person's family. Gifts with
 * neither are unattributed and left out.
 * @param fyStartYear FY start year
 * @param familyIds restrict to these families (omit for all)
 */
export async function loadStatements(fyStartYear: number, familyIds?: number[]): Promise<Map<number, FamilyStatement>> {
  const { start, end } = fyDateRange(fyStartYear)
  const rows = await prisma.transaction.findMany({
    where: {
      isGiving: true,
      date: { gte: start, lt: end },
      ...(familyIds
        ? { OR: [{ familyId: { in: familyIds } }, { familyId: null, person: { familyId: { in: familyIds } } }] }
        : { OR: [{ familyId: { not: null } }, { personId: { not: null } }] }),
    },
    orderBy: { date: "asc" },
    take: GIFT_SCAN_CAP,
    select: {
      date: true,
      description: true,
      amount: true,
      familyId: true,
      person: { select: { familyId: true } },
      fund: { select: { name: true } },
    },
  })
  const gifts = rows.flatMap((r) => {
    const familyId = r.familyId ?? r.person?.familyId
    if (familyId == null) return []
    return [{ date: r.date, description: safeDecrypt(r.description), amount: r.amount, fundName: r.fund?.name ?? null, familyId }]
  })
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
    select: { id: true, name: true, people: { select: { email: true, emailConsent: true, role: true } } },
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
