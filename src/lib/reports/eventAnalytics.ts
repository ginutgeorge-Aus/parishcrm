import { sydneyTodayYMD } from "@/lib/dates"
import { type Money, toCents, centsToNumber } from "@/lib/formatting"

type TicketTypeInput = { name: string; capacity: number | null; registrationItems: { quantity: number }[] }
type RegItemInput = { quantity: number; unitPrice: Money; ticketType: { name: string } }
type RegistrationInput = { createdAt: Date; paymentStatus: string; items: RegItemInput[] }

export function fillRates(ticketTypes: TicketTypeInput[]) {
  return ticketTypes.map(tt => {
    const sold = tt.registrationItems.reduce((s, i) => s + i.quantity, 0)
    const hasCap = tt.capacity != null && tt.capacity > 0
    return {
      name: tt.name,
      sold,
      capacity: tt.capacity,
      pct: hasCap ? Math.round((sold / (tt.capacity as number)) * 100) : null,
    }
  })
}

export function revenueByType(registrations: RegistrationInput[]) {
  // cents per ticket-type name, PAID only, to avoid float drift
  const cents = new Map<string, number>()
  const order: string[] = []
  for (const r of registrations) {
    if (r.paymentStatus !== "PAID") continue
    for (const item of r.items) {
      const name = item.ticketType.name
      if (!cents.has(name)) { cents.set(name, 0); order.push(name) }
      // unitPrice (dollars) times quantity, in integer cents — no need to
      // allocate a quantity-length array just to sum it.
      const lineCents = toCents(item.unitPrice) * item.quantity
      cents.set(name, cents.get(name)! + lineCents)
    }
  }
  return order.map(name => ({ name, revenue: centsToNumber(cents.get(name)!) }))
}

export function regsOverTime(registrations: RegistrationInput[]) {
  const byDate = new Map<string, number>()
  for (const r of registrations) {
    const d = sydneyTodayYMD(r.createdAt)
    byDate.set(d, (byDate.get(d) ?? 0) + 1)
  }
  const dates = Array.from(byDate.keys()).sort()
  let running = 0
  return dates.map(date => {
    running += byDate.get(date)!
    return { date, cumulative: running }
  })
}
