/** @jest-environment node */
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { EventReminderEmail, type EventReminderData } from "@/lib/emails/EventReminderEmail"

const base: EventReminderData = {
  churchName: "Test Church",
  firstName: "Jane",
  eventTitle: "Parish Picnic",
  eventDateLabel: "Tue 15 Jul 2026, 7:30 PM",
  eventLocation: "Church Hall",
}

describe("EventReminderEmail", () => {
  it("renders greeting, title, when and where", () => {
    const html = renderToStaticMarkup(React.createElement(EventReminderEmail, base))
    expect(html).toContain("Jane")
    expect(html).toContain("Parish Picnic")
    expect(html).toContain("Church Hall")
  })

  it("shows organiser contacts only when organizers present", () => {
    const withOrg = renderToStaticMarkup(
      React.createElement(EventReminderEmail, {
        ...base,
        organizers: [{ name: "Sam Organiser", phone: "0412 345 678" }, { name: "Pat Helper" }],
      })
    )
    expect(withOrg).toContain("Organisers")
    expect(withOrg).toContain("Sam Organiser")
    expect(withOrg).toContain("0412 345 678")
    expect(withOrg).toContain("Pat Helper")

    const noOrg = renderToStaticMarkup(React.createElement(EventReminderEmail, base))
    expect(noOrg).not.toContain("Organiser")
  })
})
