import {
  RETENTION_MONTHS,
  REDACTED_NAME,
  retentionCutoff,
  isEventPastRetention,
  anonymisedRegistrationData,
  anonymisedAttendeeData,
} from "@/lib/registrationRetention"

describe("registrationRetention", () => {
  const now = new Date("2026-07-09T00:00:00.000Z")

  describe("retentionCutoff", () => {
    it("subtracts the default retention window", () => {
      expect(retentionCutoff(now)).toEqual(new Date("2026-01-09T00:00:00.000Z"))
    })

    it("honours an explicit window", () => {
      expect(retentionCutoff(now, 12)).toEqual(new Date("2025-07-09T00:00:00.000Z"))
    })

    it("does not mutate the passed-in date", () => {
      const before = now.getTime()
      retentionCutoff(now)
      expect(now.getTime()).toBe(before)
    })
  })

  describe("isEventPastRetention", () => {
    it("purges an event whose one-off date is older than the window", () => {
      expect(isEventPastRetention(new Date("2025-12-01"), null, now)).toBe(true)
    })

    it("keeps an event still inside the window", () => {
      expect(isEventPastRetention(new Date("2026-06-01"), null, now)).toBe(false)
    })

    it("uses endDate over date when both are set (multi-day)", () => {
      // date is old but endDate is recent → still within window, keep.
      expect(isEventPastRetention(new Date("2025-12-01"), new Date("2026-06-30"), now)).toBe(false)
    })

    it("never purges an event with no date anchor", () => {
      expect(isEventPastRetention(null, null, now)).toBe(false)
    })

    it("treats the exact cutoff instant as not-yet-past (strict <)", () => {
      const cutoff = retentionCutoff(now)
      expect(isEventPastRetention(cutoff, null, now)).toBe(false)
    })

    it("purges one millisecond before the cutoff", () => {
      const justBefore = new Date(retentionCutoff(now).getTime() - 1)
      expect(isEventPastRetention(justBefore, null, now)).toBe(true)
    })
  })

  describe("anonymisedRegistrationData", () => {
    it("scrubs every PII field and stamps the marker", () => {
      expect(anonymisedRegistrationData(now)).toEqual({
        firstName: REDACTED_NAME,
        lastName: REDACTED_NAME,
        email: "",
        emailHash: null,
        phone: null,
        customAnswers: null,
        anonymizedAt: now,
      })
    })
  })

  describe("anonymisedAttendeeData", () => {
    it("scrubs the attendee name and answers", () => {
      expect(anonymisedAttendeeData()).toEqual({ name: REDACTED_NAME, answers: null })
    })
  })

  it("defaults the retention window to 6 months", () => {
    expect(RETENTION_MONTHS).toBe(6)
  })
})
