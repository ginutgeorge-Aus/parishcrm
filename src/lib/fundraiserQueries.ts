import "server-only"
import { prisma } from "@/lib/prisma"
import { canManageFundraiser, canViewFundraiserTotals } from "@/lib/roleGuard"
import { entryTotals, fundraiserTotals, type EntryTotals } from "@/lib/fundraiserMath"
import type { UserRole } from "@/lib/generated/prisma/enums"
import { toCents } from "@/lib/formatting"
import { sydneyTodayYMD, utcYmd } from "@/lib/dates"

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

/** One payment as shown to managers. `paidAt` is a calendar date (`YYYY-MM-DD`). */
export type FundraiserPaymentItem = {
  id: number
  amountCents: number
  method: "CASH" | "BANK" | "ONLINE"
  paidAt: string
  note: string | null
}

/** Fundraiser settings, per-entry rows, payments and rolled-up totals for one event. */
export type FundraiserView = {
  fundraiser: { id: number; eventId: number; name: string; unitLabel: string; unitPrice: string; deliveryPrice: string | null; refPrefix: string | null }
  rows: FundraiserRow[]
  /** Payments keyed by entry id, newest first. Managers only (empty for AUDITOR). */
  payments: Record<number, FundraiserPaymentItem[]>
  totals: { expectedCents: number; collectedCents: number; outstandingCents: number }
}

/**
 * Load an event's fundraiser with entry rows, payments and totals in one query
 * (the page needs nothing else per entry). Managers get rows and payments;
 * AUDITOR gets totals only (`rows: []`, `payments: {}`); other roles get null. Encrypted outside
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
          id: true, familyId: true, familyNameSnapshot: true, outsideName: true, quantity: true, unitPrice: true, delivery: true, bankRef: true,
          family: { select: { name: true } },
          payments: {
            orderBy: [{ paidAt: "desc" }, { id: "desc" }],
            select: { id: true, amount: true, method: true, paidAt: true, note: true },
          },
        },
      },
    },
  })
  if (!f) return null

  const canManage = canManageFundraiser(role)
  const computed = f.entries.map((e) => ({ e, t: entryTotals(e, e.payments) }))
  const payments: Record<number, FundraiserPaymentItem[]> = {}
  if (canManage) {
    for (const e of f.entries) {
      if (e.payments.length === 0) continue
      payments[e.id] = e.payments.map((p) => ({
        id: p.id,
        amountCents: toCents(p.amount),
        method: p.method,
        // Manual rows store the calendar date at UTC midnight; ONLINE rows are a real
        // capture instant, so take its Sydney calendar day (UTC would be a day early).
        paidAt: p.method === "ONLINE" ? sydneyTodayYMD(p.paidAt) : utcYmd(p.paidAt),
        note: p.note,
      }))
    }
  }
  const rows: FundraiserRow[] = canManage
    ? computed.map(({ e, t }) => ({
        ...t,
        id: e.id,
        familyId: e.familyId,
        name: e.family?.name ?? e.familyNameSnapshot ?? e.outsideName ?? "Unknown",
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
    payments,
    totals: fundraiserTotals(computed.map((c) => c.t)),
  }
}
