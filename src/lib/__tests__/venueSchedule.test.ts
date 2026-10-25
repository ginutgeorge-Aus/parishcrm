/** @jest-environment node */
import { VENUE_JOB_LAST_DAY, autoSendLabel, venueInvoiceMonth, venueJobWindowOpen } from "@/lib/venueSchedule"

describe("venueJobWindowOpen (Sydney 1st, from 09:00)", () => {
  it("is closed at 08:59 and open at 09:00 on the 1st (AEDT)", () => {
    expect(venueJobWindowOpen(new Date("2026-10-31T21:59:00Z"))).toBe(false) // 1 Nov 08:59 AEDT
    expect(venueJobWindowOpen(new Date("2026-10-31T22:00:00Z"))).toBe(true) // 1 Nov 09:00 AEDT
  })
  it("uses AEST in winter", () => {
    expect(venueJobWindowOpen(new Date("2026-06-30T22:59:00Z"))).toBe(false) // 1 Jul 08:59 AEST
    expect(venueJobWindowOpen(new Date("2026-06-30T23:00:00Z"))).toBe(true) // 1 Jul 09:00 AEST
  })
  it("is open until the end of the Sydney 1st and closed on the 2nd", () => {
    expect(venueJobWindowOpen(new Date("2026-11-01T12:59:00Z"))).toBe(true) // 1 Nov 23:59 AEDT
    expect(venueJobWindowOpen(new Date("2026-11-01T13:00:00Z"))).toBe(false) // 2 Nov 00:00 AEDT
  })
  it("is closed on other days", () => {
    expect(venueJobWindowOpen(new Date("2026-10-25T00:00:00Z"))).toBe(false)
  })
  it("keys off the Sydney date, not the UTC date", () => {
    // 31 Oct 23:30 UTC is already 1 Nov 10:30 in Sydney: open although the UTC date is the 31st.
    expect(venueJobWindowOpen(new Date("2026-10-31T23:30:00Z"))).toBe(true)
  })
  it("follows VENUE_JOB_LAST_DAY at the window edges (AEDT, November 2026)", () => {
    // 23:59 Sydney on the last open day is still open; 00:00 the day after is closed.
    expect(venueJobWindowOpen(new Date(Date.UTC(2026, 10, VENUE_JOB_LAST_DAY, 12, 59)))).toBe(true)
    expect(venueJobWindowOpen(new Date(Date.UTC(2026, 10, VENUE_JOB_LAST_DAY, 13, 0)))).toBe(false)
  })
})

describe("venueInvoiceMonth", () => {
  it("is the previous Sydney month, including Dec -> Jan", () => {
    expect(venueInvoiceMonth(new Date("2026-10-31T22:00:00Z"))).toBe("2026-10") // 1 Nov Sydney
    expect(venueInvoiceMonth(new Date("2026-12-31T22:00:00Z"))).toBe("2026-12") // 1 Jan 2027 Sydney
  })
})

describe("autoSendLabel", () => {
  it("names the 1st of the following month", () => {
    expect(autoSendLabel("2026-10")).toBe("1 November, 9:00 AM")
    expect(autoSendLabel("2026-12")).toBe("1 January, 9:00 AM")
  })
})
