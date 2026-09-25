import { formatSydneyDate } from "@/lib/dates"

export type BookingStatus = "paid" | "unpaid" | "registered"
export type VolunteerReg = {
  firstName: string
  lastName: string
  paymentStatus: string
  totalAmount: number
  items: { quantity: number; ticketType: { name: string } }[]
}
export type VolunteerFill = { name: string; sold: number; capacity: number | null; pct: number | null }

// Mirrors eventRegistration.ts:522 — a PENDING row with nothing owed is a free
// registration, not an unpaid one.
export function bookingStatus(paymentStatus: string, totalAmount: number): BookingStatus {
  if (paymentStatus === "PAID") return "paid"
  if (totalAmount > 0) return "unpaid"
  return "registered"
}

export function ticketChips(items: VolunteerReg["items"]): string {
  return items.map((i) => `${i.quantity} ${i.ticketType.name}`).join(" · ")
}

const BADGE: Record<BookingStatus, { label: string; cls: string }> = {
  paid: { label: "Paid", cls: "bg-income/10 text-income" },
  unpaid: { label: "Unpaid", cls: "bg-destructive/10 text-destructive" },
  registered: { label: "Registered", cls: "bg-muted text-muted-foreground" },
}

export function VolunteerView({
  title,
  date,
  fills,
  registrations,
}: {
  title: string
  date: Date | null
  fills: VolunteerFill[]
  registrations: VolunteerReg[]
}) {
  const totalSold = fills.reduce((s, f) => s + f.sold, 0)
  // Any uncapped ticket type makes the overall capacity meaningless — summing it
  // as 0 inflates the fill %. Treat the whole event as uncapped instead.
  const totalCap = fills.some((f) => f.capacity == null)
    ? null
    : fills.reduce((s, f) => s + (f.capacity ?? 0), 0)
  const overallPct = totalCap && totalCap > 0 ? Math.round((totalSold / totalCap) * 100) : null

  return (
    <div className="max-w-md mx-auto px-4 py-6">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
        {date && <p className="text-sm text-muted-foreground">{formatSydneyDate(date)}</p>}
      </header>

      <section className="rounded-lg border border-border bg-card p-4 mb-6">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Booked</span>
          <span className="text-2xl font-bold text-foreground">
            {totalSold}
            {totalCap != null && totalCap > 0 && (
              <span className="text-base text-muted-foreground"> / {totalCap}</span>
            )}
          </span>
        </div>
        {overallPct != null && <p className="text-sm text-muted-foreground mt-1">{overallPct}% full</p>}
        <ul className="mt-3 space-y-1">
          {fills.map((f, i) => (
            <li key={i} className="flex justify-between text-sm">
              <span className="text-muted-foreground">{f.name}</span>
              <span className="text-foreground">
                {f.sold}
                {f.capacity != null ? ` / ${f.capacity}` : ""}
                {f.pct != null ? ` (${f.pct}%)` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <h2 className="text-sm font-semibold text-muted-foreground mb-2">
        Bookings ({registrations.length})
      </h2>
      <ul className="space-y-2">
        {registrations.map((r, i) => {
          const badge = BADGE[bookingStatus(r.paymentStatus, r.totalAmount)]
          return (
            <li
              key={i}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">
                  {r.firstName} {r.lastName}
                </p>
                <p className="text-xs text-muted-foreground truncate">{ticketChips(r.items)}</p>
              </div>
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                {badge.label}
              </span>
            </li>
          )
        })}
      </ul>

      {registrations.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No bookings yet.</p>
      )}
    </div>
  )
}
