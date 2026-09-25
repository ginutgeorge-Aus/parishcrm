import { toFloat } from "@/lib/utils"
import { formatDMY } from "@/lib/formatting"
import { escapeCsv } from "@/lib/csvUtils"
import { formatAnswerForCsv } from "@/lib/eventQuestions"

type Item = {
  quantity: number
  ticketType: { name: string }
  /** Per-attendee model: name + attendee-scoped question answers. */
  attendees: { name: string; answers: Record<string, string | string[]> | null }[]
}
type Reg = {
  id: number
  publicToken: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  totalAmount: string | number
  paymentStatus: string
  createdAt: Date
  items: Item[]
  customAnswers: Record<string, string | string[]> | null
}

// One row per attendee. Attendee-level columns (name, ticket type) repeat on
// every row; registration-level columns (Amount, order-scoped answers) appear
// only on the first attendee row of each registration so summing Amount never
// inflates. Attendee-scoped question columns show each attendee's own answer.
// Items with no Attendee rows emit `quantity` blank-name rows.
export function generateCsv(
  registrations: Reg[],
  questionLabels: { id: string; label: string; type?: string; scope?: "order" | "attendee" }[],
): string {
  const baseHeaders = [
    "Ref",
    "Attendee Name",
    "Ticket Type",
    "Registrant First",
    "Registrant Last",
    "Email",
    "Phone",
    "Amount",
    "Status",
    "Registered At",
  ]
  const headers = [...baseHeaders, ...questionLabels.map(q => q.label)]

  const rows: string[] = []
  for (const r of registrations) {
    // Ref = the registrant-facing publicToken (shown on the success page, emailed,
    // and used as the bank-transfer payment reference), so an admin reconciling
    // bank payments against the CSV can match them. Never the internal id.
    const ref = r.publicToken
    const registered = formatDMY(new Date(r.createdAt))

    const attendees: { name: string; ticket: string; answers: Record<string, string | string[]> | null }[] = []
    for (const item of r.items) {
      if (item.attendees.length > 0) {
        // Per-attendee model: use Attendee rows with per-attendee answers.
        for (const a of item.attendees) {
          attendees.push({ name: a.name, ticket: item.ticketType.name, answers: a.answers })
        }
      } else {
        // No Attendee rows: emit blank-name rows by quantity.
        const names = Array(item.quantity).fill("")
        for (const name of names) attendees.push({ name, ticket: item.ticketType.name, answers: null })
      }
    }
    if (attendees.length === 0) continue

    attendees.forEach((a, idx) => {
      const first = idx === 0
      const base = [
        ref,
        a.name,
        a.ticket,
        r.firstName,
        r.lastName,
        r.email,
        r.phone ?? "",
        first ? toFloat(r.totalAmount).toFixed(2) : "",
        r.paymentStatus,
        registered,
      ]
      const answers = questionLabels.map(q =>
        q.scope === "attendee"
          ? formatAnswerForCsv(a.answers?.[q.id], q.type)
          : first
            ? formatAnswerForCsv(r.customAnswers?.[q.id], q.type)
            : "",
      )
      rows.push([...base, ...answers].map(escapeCsv).join(","))
    })
  }

  return [headers.map(escapeCsv).join(","), ...rows].join("\n")
}
