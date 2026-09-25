/** @jest-environment node */
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  RegistrationConfirmationEmail,
  type RegistrationConfirmationData,
} from "@/lib/emails/RegistrationConfirmationEmail"

const base: RegistrationConfirmationData = {
  churchName: "Test Church",
  eventTitle: "Parish Picnic",
  eventDateLabel: "Tue 15 Jul 2026, 7:30 PM",
  eventLocation: "Church Hall",
  registrantName: "Jane Doe",
  items: [{ quantity: 2, ticketName: "Adult", attendeeNames: ["Jane Doe", "John Doe"] }],
  totalLabel: "$40.00",
}

describe("RegistrationConfirmationEmail", () => {
  it("renders event title, registrant, tickets and total", () => {
    const html = renderToStaticMarkup(React.createElement(RegistrationConfirmationEmail, base))
    expect(html).toContain("Parish Picnic")
    expect(html).toContain("Jane Doe")
    expect(html).toContain("Adult")
    expect(html).toContain("$40.00")
  })

  it("shows payment block + reference only when payment present", () => {
    const withPay = renderToStaticMarkup(
      React.createElement(RegistrationConfirmationEmail, {
        ...base,
        payment: { bankBsb: "012-345", bankAccount: "12345678", reference: "REG-ABC123" },
      })
    )
    expect(withPay).toContain("REG-ABC123")
    expect(withPay).toContain("012-345")

    const noPay = renderToStaticMarkup(React.createElement(RegistrationConfirmationEmail, base))
    expect(noPay).not.toContain("REG-ABC123")
    expect(noPay).not.toContain("BSB")
  })

  it("shows organiser contacts only when organizers present", () => {
    const withOrg = renderToStaticMarkup(
      React.createElement(RegistrationConfirmationEmail, {
        ...base,
        organizers: [{ name: "Sam Organiser", phone: "0412 345 678" }, { name: "Pat Helper" }],
      })
    )
    expect(withOrg).toContain("Organisers")
    expect(withOrg).toContain("Sam Organiser")
    expect(withOrg).toContain("0412 345 678")
    expect(withOrg).toContain("Pat Helper")

    const noOrg = renderToStaticMarkup(React.createElement(RegistrationConfirmationEmail, base))
    expect(noOrg).not.toContain("Organiser")
  })

  it("shows the calendar button only when a url is given", () => {
    const withCal = renderToStaticMarkup(
      React.createElement(RegistrationConfirmationEmail, {
        ...base,
        googleCalendarUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE",
      })
    )
    expect(withCal).toContain("calendar.google.com")

    const noCal = renderToStaticMarkup(React.createElement(RegistrationConfirmationEmail, base))
    expect(noCal).not.toContain("calendar.google.com")
  })
})
