import { fmtAUD } from "@/lib/formatting"

type Props = {
  total: number
  paid: number
  cancelled: number
  /** PENDING registrations with nothing owing ($0); excluded from the pending (unpaid) count. */
  free?: number
  revenue: number
  /** Paid revenue split by payment method (card = Stripe, transfer = everything else). */
  cardRevenue: number
  transferRevenue: number
  ticketsSold: { name: string; count: number }[]
}

export function RegistrationStats({ total, paid, cancelled, free = 0, revenue, cardRevenue, transferRevenue, ticketsSold }: Readonly<Props>) {
  // CANCELLED registrations still count toward the headline total but are neither
  // paid nor pending. Free ($0) registrations owe nothing, so they are not pending either.
  const pending = total - paid - cancelled - free
  const registeredSub = `${paid} paid · ${pending} pending${free ? ` · ${free} free` : ""}${cancelled ? ` · ${cancelled} cancelled` : ""}`

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {(
        [
          { label: "Registered", value: total, sub: registeredSub },
          { label: "Paid", value: paid, sub: `${pending} pending`, valueClass: "text-income" },
          {
            label: "Revenue",
            value: fmtAUD(revenue),
            // The split only helps when some revenue came by card; otherwise it's "Card $0.00".
            sub: cardRevenue > 0
              ? `Card ${fmtAUD(cardRevenue)} · Bank transfer ${fmtAUD(transferRevenue)}`
              : "from paid registrations",
          },
          {
            label: "Tickets sold",
            value: ticketsSold.reduce((s, t) => s + t.count, 0),
            sub: ticketsSold.map(t => `${t.name} ${t.count}`).join(" · "),
          },
        ] as Array<{ label: string; value: string | number; sub: string; valueClass?: string }>
      ).map(card => (
        <div key={card.label} className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-semibold text-muted-foreground mb-2">{card.label}</p>
          <data className={`text-3xl font-bold tabular text-foreground ${card.valueClass ?? ""}`} value={String(card.value)}>
            {card.value}
          </data>
          <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
        </div>
      ))}
    </div>
  )
}
