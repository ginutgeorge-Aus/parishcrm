import "server-only"
import { prisma } from "@/lib/prisma"
import { canManageFundraiser, canViewFundraiserTotals } from "@/lib/roleGuard"
import { entryTotals, fundraiserTotals, type EntryTotals } from "@/lib/fundraiserMath"
import type { UserRole } from "@/lib/generated/prisma/enums"

/**
 * One fundraiser entry as shown to the client. Never carries outside email/phone.
 * All money values (`owedCents`, `paidCents`, `remainingCents`) are integer cents.
 */
export type FundraiserRow = EntryTotals & {
  id: number
  familyId: number | null
  name: string
  quantity: number
  /** Unit price snapshotted on the entry at creation (2-dp string). */
  unitPrice: string
  /** True when the entry is a delivery (priced at the delivery price). */
  delivery: boolean
  bankRef: string
}

/** Fundraiser settings, per-entry rows and rolled-up totals for one event. */
export type FundraiserView = {
  fundraiser: { id: number; eventId: number; name: string; unitLabel: string; unitPrice: string; deliveryPrice: string | null; refPrefix: string | null }
  rows: FundraiserRow[]
  totals: { expectedCents: number; collectedCents: number; outstandingCents: number }
}

/**
 * Load an event's fundraiser with entry rows and totals. Managers get rows;
 * AUDITOR gets totals only (`rows: []`); other roles get null. Encrypted outside
 * contact fields are never selected or returned. Rows are chaseable
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
    select: {
      id: true, eventId: true, name: true, unitLabel: true, unitPrice: true, deliveryPrice: true, refPrefix: true,
      entries: {
        orderBy: { id: "asc" },
        select: {
          id: true, familyId: true, outsideName: true, quantity: true, unitPrice: true, delivery: true, bankRef: true,
          family: { select: { name: true } },
          payments: { select: { amount: true } },
        },
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
        delivery: e.delivery,
        bankRef: e.bankRef,
      }))
    : []
  return {
    fundraiser: {
      id: f.id, eventId: f.eventId, name: f.name, unitLabel: f.unitLabel,
      unitPrice: f.unitPrice.toString(), deliveryPrice: f.deliveryPrice?.toString() ?? null, refPrefix: f.refPrefix,
    },
    rows,
    totals: fundraiserTotals(computed.map((c) => c.t)),
  }
}
