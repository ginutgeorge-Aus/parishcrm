import { fmtAUD } from "@/lib/formatting"

type Props = {
  total: number
  paid: number
  cancelled: number
  revenue: number
  ticketsSold: { name: string; count: number }[]
}

export function RegistrationStats({ total, paid, cancelled, revenue, ticketsSold }: Props) {
  // CANCELLED registrations still count toward the headline total but are neither
  // paid nor pending.
  const pending = total - paid - cancelled
  const registeredSub = `${paid} paid · ${pending} pending${cancelled ? ` · ${cancelled} cancelled` : ""}`

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {(
        [
          { label: "Registered", value: total, sub: registeredSub },
          { label: "Paid", value: paid, sub: `${pending} pending`, valueClass: "text-income" },
          { label: "Revenue", value: fmtAUD(revenue), sub: "from paid registrations" },
          {
            label: "Tickets Sold",
            value: ticketsSold.reduce((s, t) => s + t.count, 0),
            sub: ticketsSold.map(t => `${t.name} ${t.count}`).join(" · "),
          },
        ] as Array<{ label: string; value: string | number; sub: string; valueClass?: string }>
      ).map(card => (
        <div key={card.label} className="bg-card rounded-xl border border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{card.label}</p>
          <data className={`text-3xl font-bold tabular text-foreground ${card.valueClass ?? ""}`} value={String(card.value)}>
            {card.value}
          </data>
          <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
        </div>
      ))}
    </div>
  )
}
