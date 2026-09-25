import {
  retentionCutoff,
  isEventPastRetention,
  RETENTION_MONTHS,
  anonymisedWaitlistData,
  anonymisedCheckoutSessionData,
  REDACTED_NAME,
} from "@/lib/registrationRetention"

describe("retentionCutoff", () => {
  it("subtracts whole months for a mid-month date (no rollover)", () => {
    const cutoff = retentionCutoff(new Date(2025, 7, 15, 9, 30), 6) // 15 Aug 2025
    expect(cutoff.getFullYear()).toBe(2025)
    expect(cutoff.getMonth()).toBe(1) // February
    expect(cutoff.getDate()).toBe(15)
  })

  it("does NOT roll past the target month when the day overflows", () => {
    // 31 Aug − 6mo must land in February, not spill into March. Feb 2025 has 28
    // days, so the day is clamped to 28 rather than becoming "Feb 31" → Mar 3.
    const cutoff = retentionCutoff(new Date(2025, 7, 31, 12, 0), 6) // 31 Aug 2025
    expect(cutoff.getFullYear()).toBe(2025)
    expect(cutoff.getMonth()).toBe(1) // February — NOT March
    expect(cutoff.getDate()).toBe(28)
  })

  it("clamps to Feb 29 in a leap year", () => {
    const cutoff = retentionCutoff(new Date(2024, 7, 31), 6) // 31 Aug 2024 (leap)
    expect(cutoff.getMonth()).toBe(1)
    expect(cutoff.getDate()).toBe(29)
  })

  it("crosses the year boundary correctly", () => {
    const cutoff = retentionCutoff(new Date(2025, 2, 31), 6) // 31 Mar 2025 − 6mo
    expect(cutoff.getFullYear()).toBe(2024)
    expect(cutoff.getMonth()).toBe(8) // September (30 days) — NOT October
    expect(cutoff.getDate()).toBe(30)
  })

  it("preserves the time-of-day", () => {
    const cutoff = retentionCutoff(new Date(2025, 7, 31, 12, 34, 56), 6)
    expect(cutoff.getHours()).toBe(12)
    expect(cutoff.getMinutes()).toBe(34)
    expect(cutoff.getSeconds()).toBe(56)
  })

  it("defaults to RETENTION_MONTHS", () => {
    const a = retentionCutoff(new Date(2025, 5, 15))
    const b = retentionCutoff(new Date(2025, 5, 15), RETENTION_MONTHS)
    expect(a.getTime()).toBe(b.getTime())
  })
})

describe("isEventPastRetention", () => {
  const now = new Date(2025, 7, 31, 12, 0) // 31 Aug 2025 → cutoff 28 Feb 2025

  it("purges an event that closed before the cutoff", () => {
    expect(isEventPastRetention(new Date(2025, 0, 1), null, now, 6)).toBe(true)
  })

  it("keeps an event that closed on/after the cutoff", () => {
    expect(isEventPastRetention(new Date(2025, 5, 1), null, now, 6)).toBe(false)
  })

  it("prefers endDate over date for multi-day events", () => {
    // Starts before the cutoff but ends after → not yet past retention.
    expect(isEventPastRetention(new Date(2025, 0, 1), new Date(2025, 6, 1), now, 6)).toBe(false)
  })

  it("never purges an event with neither date set", () => {
    expect(isEventPastRetention(null, null, now, 6)).toBe(false)
  })
})

// Waitlist PII (name+email) shares the same purge shape as Registration.
describe("anonymisedWaitlistData", () => {
  it("redacts name, blanks email, clears emailHash, and sets the marker", () => {
    const now = new Date(2025, 7, 31, 12, 0)
    expect(anonymisedWaitlistData(now)).toEqual({
      name: REDACTED_NAME,
      email: "",
      emailHash: null,
      anonymizedAt: now,
    })
  })
})

// CheckoutSession.payload survives Registration anonymisation forever
// on the COMPLETED/UNFULFILLED path unless the purge also scrubs it here.
describe("anonymisedCheckoutSessionData", () => {
  it("blanks payload and sets the marker", () => {
    const now = new Date(2025, 7, 31, 12, 0)
    expect(anonymisedCheckoutSessionData(now)).toEqual({
      payload: "",
      anonymizedAt: now,
    })
  })
})
