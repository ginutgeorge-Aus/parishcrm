import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { canManageFundraiser, canViewFundraiserTotals } from "@/lib/roleGuard"
import { getFundraiserView } from "@/lib/fundraiserQueries"
import { parseRouteId } from "@/lib/validation"
import { centsToNumber, fmtAUD, toCents } from "@/lib/formatting"
import { EntryTable } from "@/components/events/fundraiser/EntryTable"
import { AddEntryDialog } from "@/components/events/fundraiser/AddEntryDialog"
import { FundraiserSettingsForm } from "@/components/events/fundraiser/FundraiserSettingsForm"
import type { PaymentItem } from "@/components/events/fundraiser/PaymentsPanel"

type Props = { params: Promise<{ id: string }> }

/**
 * Fundraiser tab for an event: totals strip, settings, entries and payments.
 * AUDITOR sees totals only; managers see everything and may mutate.
 * @param props - Route params (event id).
 */
export default async function FundraiserPage(props: Readonly<Props>) {
  const params = await props.params
  const session = await auth()
  if (!session) redirect("/login")
  const role = session.user.role
  if (!canViewFundraiserTotals(role)) redirect("/")
  const canManage = canManageFundraiser(role)

  const eventId = parseRouteId(params.id) ?? notFound()
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, title: true } })
  if (!event) notFound()

  const view = await getFundraiserView(eventId, role)

  const payments: Record<number, PaymentItem[]> = {}
  let families: { id: number; name: string }[] = []
  if (view && canManage) {
    const [rows, fams] = await Promise.all([
      prisma.fundraiserPayment.findMany({
        where: { entry: { fundraiserId: view.fundraiser.id } },
        orderBy: { paidAt: "desc" },
        select: { id: true, entryId: true, amount: true, method: true, paidAt: true, note: true },
      }),
      prisma.family.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ])
    for (const p of rows) {
      ;(payments[p.entryId] ??= []).push({
        id: p.id,
        amountCents: toCents(p.amount),
        method: p.method,
        paidAt: p.paidAt.toISOString().slice(0, 10),
        note: p.note,
      })
    }
    families = fams
  }

  const money = (c: number) => fmtAUD(centsToNumber(c))

  return (
    <div className="p-6">
      <Link href="/events" className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground">← Events</Link>
      <h1 className="text-2xl font-bold text-foreground">{event.title}: Fundraiser</h1>

      {!view ? (
        canManage ? (
          <div className="mt-6 max-w-3xl">
            <p className="mb-3 text-sm text-muted-foreground">No fundraiser set up for this event yet.</p>
            <FundraiserSettingsForm eventId={eventId} />
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">No fundraiser set up for this event.</p>
        )
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center sm:text-left">
            {[
              ["Expected", view.totals.expectedCents],
              ["Collected", view.totals.collectedCents],
              ["Outstanding", view.totals.outstandingCents],
            ].map(([label, cents]) => (
              <div key={label as string} className="rounded-lg border bg-card p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="tabular text-lg font-semibold text-foreground">{money(cents as number)}</div>
              </div>
            ))}
          </div>

          {canManage && (
            <>
              <section className="mt-6">
                <h2 className="mb-2 text-sm font-semibold text-foreground">Settings</h2>
                <FundraiserSettingsForm eventId={eventId} initial={view.fundraiser} />
              </section>
              <section className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">Entries</h2>
                  <AddEntryDialog fundraiserId={view.fundraiser.id} families={families} />
                </div>
                <EntryTable rows={view.rows} unitPrice={view.fundraiser.unitPrice} canManage payments={payments} />
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
