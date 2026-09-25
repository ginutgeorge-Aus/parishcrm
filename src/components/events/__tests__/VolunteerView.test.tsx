import { renderToStaticMarkup } from "react-dom/server"
import { VolunteerView, bookingStatus, ticketChips } from "@/components/events/VolunteerView"

describe("bookingStatus", () => {
  it("PAID → paid", () => expect(bookingStatus("PAID", 50)).toBe("paid"))
  it("PENDING with amount owed → unpaid", () => expect(bookingStatus("PENDING", 50)).toBe("unpaid"))
  it("PENDING free → registered", () => expect(bookingStatus("PENDING", 0)).toBe("registered"))
})

describe("ticketChips", () => {
  it("joins qty + type name", () => {
    expect(ticketChips([
      { quantity: 2, ticketType: { name: "Adult" } },
      { quantity: 1, ticketType: { name: "Child" } },
    ])).toBe("2 Adult · 1 Child")
  })
})

describe("VolunteerView", () => {
  const fills = [{ name: "Adult", sold: 8, capacity: 10, pct: 80 }]
  const registrations = [
    { firstName: "Ann", lastName: "Bell", paymentStatus: "PAID", totalAmount: 50,
      items: [{ quantity: 2, ticketType: { name: "Adult" } }] },
    { firstName: "Cy", lastName: "Dee", paymentStatus: "PENDING", totalAmount: 30,
      items: [{ quantity: 1, ticketType: { name: "Adult" } }] },
  ]

  it("renders fill rate, names, chips, and badges", () => {
    const html = renderToStaticMarkup(
      <VolunteerView title="Picnic" date={null} fills={fills} registrations={registrations} />,
    )
    expect(html).toContain("Picnic")
    expect(html).toContain("80%")            // fill rate
    expect(html).toContain("Ann Bell")
    expect(html).toContain("2 Adult")        // chips
    expect(html).toContain("Paid")
    expect(html).toContain("Unpaid")
  })

  it("renders the event date in Sydney time (not the server/UTC day)", () => {
    // 8:30 AM Sydney on Thu 8 Oct 2026 is stored as the prior UTC day (21:30Z on
    // the 7th). date-fns format() in UTC would print "Wed 7 Oct" — must be Thu 8.
    const html = renderToStaticMarkup(
      <VolunteerView title="Picnic" date={new Date("2026-10-07T21:30:00.000Z")} fills={fills} registrations={[]} />,
    )
    expect(html).toContain("Thu 8 Oct 2026")
  })

  it("mixed capped + uncapped types → no inflated overall fill %", () => {
    const mixed = [
      { name: "Adult", sold: 8, capacity: 10, pct: 80 },
      { name: "Helper", sold: 100, capacity: null, pct: null },
    ]
    const html = renderToStaticMarkup(
      <VolunteerView title="Picnic" date={null} fills={mixed} registrations={[]} />,
    )
    // Summing the uncapped type as 0 would report 1080% full — must be suppressed.
    expect(html).not.toContain("% full")
  })
})
