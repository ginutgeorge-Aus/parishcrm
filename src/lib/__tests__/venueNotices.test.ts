/** @jest-environment node */
import { buildAutoSentEmail, buildReminderEmail, venuePageUrl } from "@/lib/venueNotices"

describe("buildReminderEmail", () => {
  it("lists the problems, links to the page and escapes values", () => {
    const { subject, text, html } = buildReminderEmail({
      churchName: "Example <Church>", month: "2026-10",
      problems: ["1 date is still marked Requested", "No confirmed or cancelled booking for: Sunday, 4 October"],
      url: "https://app.example.com/venue-usage?month=2026-10",
    })
    expect(subject).toBe("Venue invoice request for October 2026 needs attention")
    expect(text).toContain("- 1 date is still marked Requested")
    expect(text).toContain("https://app.example.com/venue-usage?month=2026-10")
    expect(html).toContain("Example &lt;Church&gt;")
    expect(html).toContain('<a href="https://app.example.com/venue-usage?month=2026-10">')
  })
  it("omits the link when there is no URL", () => {
    expect(buildReminderEmail({ churchName: "Example Church", month: "2026-10", problems: ["x"], url: null }).html).not.toContain("<a ")
  })
})

describe("buildAutoSentEmail", () => {
  it("names the month, count and hours", () => {
    const { subject, text } = buildAutoSentEmail({ churchName: "Example Church", month: "2026-10", rowCount: 4, totalHoursLabel: "12 hours" })
    expect(subject).toBe("Invoice request for October 2026 sent")
    expect(text).toContain("4 confirmed dates, 12 hours")
  })
})

describe("venuePageUrl", () => {
  const old = process.env.AUTH_URL
  afterEach(() => {
    if (old === undefined) delete process.env.AUTH_URL
    else process.env.AUTH_URL = old
  })
  it("builds an absolute link and returns null for a bad base", () => {
    process.env.AUTH_URL = "https://app.example.com"
    expect(venuePageUrl("2026-10")).toBe("https://app.example.com/venue-usage?month=2026-10")
    process.env.AUTH_URL = "not a url"
    expect(venuePageUrl("2026-10")).toBeNull()
  })
})
