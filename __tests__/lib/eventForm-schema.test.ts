/** @jest-environment node */
import { EventSchema } from "@/lib/actions/eventForm"

const base = {
  title: "Parish Picnic",
  slug: "parish-picnic",
  kind: "one_off" as const,
  category: "worship" as const,
}

describe("EventSchema — cross-field date validation", () => {
  it("accepts an event with no end date or deadline", () => {
    const r = EventSchema.safeParse({ ...base, date: "2026-08-15T10:00" })
    expect(r.success).toBe(true)
  })

  it("accepts endDate after date", () => {
    const r = EventSchema.safeParse({ ...base, date: "2026-08-15T10:00", endDate: "2026-08-15T12:00" })
    expect(r.success).toBe(true)
  })

  it("accepts endDate equal to date", () => {
    const r = EventSchema.safeParse({ ...base, date: "2026-08-15T10:00", endDate: "2026-08-15T10:00" })
    expect(r.success).toBe(true)
  })

  it("rejects an endDate before the start date", () => {
    const r = EventSchema.safeParse({ ...base, date: "2026-08-15T10:00", endDate: "2026-08-14T10:00" })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(["endDate"])
      expect(r.error.issues[0].message).toBe("End date must not be before the start date")
    }
  })

  it("accepts a registration deadline before the (single) event date", () => {
    const r = EventSchema.safeParse({ ...base, date: "2026-08-15T10:00", registrationDeadline: "2026-08-14T10:00" })
    expect(r.success).toBe(true)
  })

  it("accepts a registration deadline equal to the event date", () => {
    const r = EventSchema.safeParse({ ...base, date: "2026-08-15T10:00", registrationDeadline: "2026-08-15T10:00" })
    expect(r.success).toBe(true)
  })

  it("rejects a registration deadline after the (single) event date", () => {
    const r = EventSchema.safeParse({ ...base, date: "2026-08-15T10:00", registrationDeadline: "2026-08-16T10:00" })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(["registrationDeadline"])
      expect(r.error.issues[0].message).toBe("Registration deadline must not be after the event ends")
    }
  })

  it("checks the deadline against endDate, not the start date, when both are set", () => {
    // Deadline is after `date` but still before `endDate` — should be valid.
    const r = EventSchema.safeParse({
      ...base,
      date: "2026-08-15T10:00",
      endDate: "2026-08-17T18:00",
      registrationDeadline: "2026-08-16T10:00",
    })
    expect(r.success).toBe(true)
  })

  it("rejects a deadline after endDate even though it's before the start date", () => {
    const r = EventSchema.safeParse({
      ...base,
      date: "2026-08-15T10:00",
      endDate: "2026-08-16T18:00",
      registrationDeadline: "2026-08-17T00:00",
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "registrationDeadline")).toBe(true)
    }
  })

  it("skips date-ordering checks entirely for a recurring event with no date", () => {
    const r = EventSchema.safeParse({ ...base, kind: "recurring", recurs: "every-sunday" })
    expect(r.success).toBe(true)
  })
})
