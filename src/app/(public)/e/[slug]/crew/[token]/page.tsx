import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { fillRates } from "@/lib/reports/eventAnalytics"
import { toFloat } from "@/lib/utils"
import { VolunteerView } from "@/components/events/VolunteerView"

// Always current; never cached or indexed. The token is the only secret, so the
// page must not be crawled/archived.
export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Event bookings",
  robots: { index: false, follow: false },
}

type Props = { params: Promise<{ slug: string; token: string }> }

export default async function CrewPage({ params }: Props) {
  const { slug, token } = await params

  // Resolve by token (the secret). Fetch ONLY non-PII fields — names + ticket
  // types + paid status. No email/phone/customAnswers/attendee names.
  const event = await prisma.event.findUnique({
    where: { volunteerToken: token },
    select: {
      title: true,
      date: true,
      slug: true,
      ticketTypes: {
        select: {
          name: true,
          capacity: true,
          // CANCELLED releases seats — exclude from fill counts (matches capacity).
          registrationItems: {
            where: { registration: { paymentStatus: { not: "CANCELLED" } } },
            select: { quantity: true },
          },
        },
      },
      registrations: {
        where: { paymentStatus: { not: "CANCELLED" } },
        select: {
          firstName: true,
          lastName: true,
          paymentStatus: true,
          totalAmount: true,
          items: { select: { quantity: true, ticketType: { select: { name: true } } } },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      },
    },
  })

  // Slug is validated to match so a token can't be surfaced under an arbitrary
  // path; the token remains the actual gate.
  if (!event || event.slug !== slug) notFound()

  return (
    <VolunteerView
      title={event.title}
      date={event.date}
      fills={fillRates(event.ticketTypes)}
      registrations={event.registrations.map((r) => ({
        firstName: r.firstName,
        lastName: r.lastName,
        paymentStatus: r.paymentStatus,
        totalAmount: toFloat(r.totalAmount),
        items: r.items,
      }))}
    />
  )
}
