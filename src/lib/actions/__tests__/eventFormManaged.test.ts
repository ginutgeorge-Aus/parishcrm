/** @jest-environment node */
import { parseManagedEventForm, managedEventData } from "@/lib/actions/eventForm"

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

const oneOff = { title: "Camp", category: "youth", date: "2026-08-01T10:00", location: "Hall" }

describe("parseManagedEventForm", () => {
  it("parses the allowlisted detail fields", () => {
    const r = parseManagedEventForm(form({ ...oneOff, description: "Fun" }), "one_off")
    expect("error" in r).toBe(false)
    if ("error" in r) return
    expect(r.parsed).toMatchObject({ title: "Camp", category: "youth", kind: "one_off", location: "Hall" })
  })

  it("strips forged non-detail keys", () => {
    const r = parseManagedEventForm(
      form({ ...oneOff, slug: "hijack", bankBsb: "123-456", registrationDeadline: "2026-07-01T10:00", onlinePaymentEnabled: "on", kind: "recurring" }),
      "one_off",
    )
    if ("error" in r) throw new Error(r.error)
    for (const k of ["slug", "bankBsb", "registrationDeadline", "onlinePaymentEnabled"]) {
      expect(r.parsed).not.toHaveProperty(k)
    }
    // kind comes from the caller (DB), never the form
    expect(r.parsed.kind).toBe("one_off")
  })

  it("requires a date for one-off events", () => {
    const r = parseManagedEventForm(form({ title: "Camp" }), "one_off")
    expect(r).toEqual({ error: "Date required for one-off events" })
  })

  it("requires a recurrence pattern for recurring events", () => {
    const r = parseManagedEventForm(form({ title: "Mass" }), "recurring")
    expect(r).toEqual({ error: "Recurrence pattern required for recurring events" })
  })

  it("rejects an end before the start", () => {
    const r = parseManagedEventForm(form({ ...oneOff, endDate: "2026-07-31T10:00" }), "one_off")
    expect(r).toEqual({ error: "End date must not be before the start date" })
  })

  it("parses organiser contacts", () => {
    const r = parseManagedEventForm(form({ ...oneOff, "organizer.0.name": "Jo", "organizer.0.phone": "0400 000 000" }), "one_off")
    if ("error" in r) throw new Error(r.error)
    expect(r.organizers).toEqual([{ name: "Jo", phone: "0400 000 000" }])
  })
})

describe("managedEventData", () => {
  it("returns exactly the detail columns for a one-off event", () => {
    const r = parseManagedEventForm(form({ ...oneOff, "recursLabel": "ignored", startTime: "ignored" }), "one_off")
    if ("error" in r) throw new Error(r.error)
    const data = managedEventData(r.parsed)
    expect(Object.keys(data).sort()).toEqual(
      ["category", "date", "description", "endDate", "location", "recurs", "recursLabel", "startTime", "title"],
    )
    expect(data.date).toBeInstanceOf(Date)
    expect(data.recursLabel).toBeNull()
    expect(data.startTime).toBeNull()
  })

  it("nulls the date for a recurring event", () => {
    const r = parseManagedEventForm(form({ title: "Mass", recurs: "every-sunday", recursLabel: "Sun", startTime: "9:30 AM" }), "recurring")
    if ("error" in r) throw new Error(r.error)
    const data = managedEventData(r.parsed)
    expect(data.date).toBeNull()
    expect(data.recurs).toBe("every-sunday")
    expect(data.startTime).toBe("9:30 AM")
  })
})
