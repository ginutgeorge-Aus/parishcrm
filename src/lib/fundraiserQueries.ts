import "server-only"
import { prisma } from "@/lib/prisma"
import { canManageFundraiser, canViewFundraiserTotals } from "@/lib/roleGuard"
import { entryTotals, fundraiserTotals, type EntryTotals } from "@/lib/fundraiserMath"
import type { UserRole } from "@/lib/generated/prisma/enums"

/**
 * One fundraiser entry as shown to the client. Never carries outside email/phone.
 * All money values (`owedCents`, `paidCents`, `remainingCents`) are integer cents.
 * `hasEmail` is true when the entry has a reachable, consenting email.
 */
export type FundraiserRow = EntryTotals & {
  id: number
  familyId: number | null
  name: string
  quantity: number
  /** Unit price snapshotted on the entry at creation (2-dp string). */
  unitPrice: string
  bankRef: string
  hasEmail: boolean
}

/** Fundraiser settings, per-entry rows and rolled-up totals for one event. */
export type FundraiserView = {
  fundraiser: { id: number; eventId: number; name: string; unitLabel: string; unitPrice: string; refPrefix: string | null }
  rows: FundraiserRow[]
  totals: { expectedCents: number; collectedCents: number; outstandingCents: number }
}

/**
 * Load an event's fundraiser with entry rows and totals. Managers get rows;
 * AUDITOR gets totals only (`rows: []`); other roles get null. Encrypted outside
 * contact fields are reduced to `hasEmail` and never returned. Rows are chaseable
 * when `remainingCents > 0` (not by status).
 *
 * @param eventId - Event id.
 * @param role - Caller's role.
 * @returns The view, or null when the role may not view or no fundraiser exists.
 */
export async function getFundraiserView(eventId: number, role: UserRole | undefined): Promise<FundraiserView | null> {
  if (!canViewFundraiserTotals(role)) return null
  const f = await prisma.fundraiser.findUnique({
    where: { eventId },
    include: {
      entries: {
        orderBy: { id: "asc" },
        include: { family: { select: { name: true, people: { select: { email: true, emailConsent: true } } } }, payments: { select: { amount: true } } },
      },
    },
  })
  if (!f) return null

  const computed = f.entries.map((e) => ({ e, t: entryTotals(e, e.payments) }))
  const rows: FundraiserRow[] = canManageFundraiser(role)
    ? computed.map(({ e, t }) => ({
        ...t,
        id: e.id,
        familyId: e.familyId,
        name: e.family?.name ?? e.outsideName ?? "Unknown",
        quantity: e.quantity,
        unitPrice: e.unitPrice.toString(),
        bankRef: e.bankRef,
        hasEmail: e.familyId != null
          ? (e.family?.people ?? []).some((p) => p.email != null && p.emailConsent)
          : !!e.outsideEmail,
      }))
    : []
  return {
    fundraiser: {
      id: f.id, eventId: f.eventId, name: f.name, unitLabel: f.unitLabel,
      unitPrice: f.unitPrice.toString(), refPrefix: f.refPrefix,
    },
    rows,
    totals: fundraiserTotals(computed.map((c) => c.t)),
  }
}
