/** @jest-environment node */
import { buildIcs, googleCalendarUrl, icsDateUTC } from "@/lib/ics"

const start = new Date("2026-07-15T09:30:00.000Z")
const end = new Date("2026-07-15T11:00:00.000Z")

describe("icsDateUTC", () => {
  it("formats to UTC basic form", () => {
    expect(icsDateUTC(start)).toBe("20260715T093000Z")
  })
})

describe("buildIcs", () => {
  const ics = buildIcs({
    uid: "REG-ABC123",
    title: "Parish; Picnic, 2026",
    description: "Bring food\nand drinks",
    location: "Hall, Springfield",
    start,
    end,
  })

  it("wraps a single VEVENT in a VCALENDAR", () => {
    expect(ics).toContain("BEGIN:VCALENDAR")
    expect(ics).toContain("VERSION:2.0")
    expect(ics).toContain("BEGIN:VEVENT")
    expect(ics).toContain("END:VEVENT")
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true)
  })

  it("uses CRLF line endings", () => {
    expect(ics).toContain("\r\n")
    expect(ics).not.toMatch(/[^\r]\n/)
  })

  it("sets UTC DTSTART/DTEND", () => {
    expect(ics).toContain("DTSTART:20260715T093000Z")
    expect(ics).toContain("DTEND:20260715T110000Z")
  })

  it("escapes ; , \\ and newlines in text fields", () => {
    expect(ics).toContain("SUMMARY:Parish\\; Picnic\\, 2026")
    expect(ics).toContain("DESCRIPTION:Bring food\\nand drinks")
    expect(ics).toContain("LOCATION:Hall\\, Springfield")
  })

  it("includes the uid", () => {
    expect(ics).toContain("UID:REG-ABC123")
  })

  it("escapes a bare CR (no LF) so it can't inject a second property line", () => {
    // A lone \r (no following \n) previously passed straight through
    // escapeText, landing as a raw CR inside a CRLF-delimited TEXT value —
    // some calendar parsers treat a lone CR as a line terminator too, so
    // attacker-controlled input (event title/description/location) could
    // inject a fake second ICS property line.
    const out = buildIcs({
      uid: "X",
      title: "T",
      description: "line one\rORGANIZER:mailto:evil@example.com",
      start,
      end,
    })
    expect(out).not.toMatch(/\r(?!\n)/)
    const descLine = out.split("\r\n").find((l) => l.startsWith("DESCRIPTION:"))!
    expect(descLine).toBe("DESCRIPTION:line one\\nORGANIZER:mailto:evil@example.com")
  })

  it("stamps DTSTAMP from `now`, distinct from DTSTART", () => {
    const now = new Date("2026-06-01T00:00:00.000Z")
    const out = buildIcs({ uid: "X", title: "T", start, end, now })
    expect(out).toContain("DTSTAMP:20260601T000000Z")
    expect(out).toContain("DTSTART:20260715T093000Z")
  })

  it("PRODID uses the neutral product name, not the church", () => {
    const ics = buildIcs({
      uid: "u1",
      title: "T",
      start: new Date("2026-01-01T00:00:00Z"),
      end: new Date("2026-01-01T01:00:00Z"),
      now: new Date("2026-01-01T00:00:00Z"),
    })
    expect(ics).toContain("PRODID:-//ParishCRM//Event Registration//EN")
    expect(ics).not.toMatch(/Example Church/i)
  })
})

describe("googleCalendarUrl", () => {
  const url = googleCalendarUrl({
    title: "Parish Picnic",
    details: "Bring food",
    location: "Hall, Springfield",
    start,
    end,
  })

  it("targets the render template endpoint with encoded params", () => {
    expect(url).toContain("https://calendar.google.com/calendar/render?action=TEMPLATE")
    expect(url).toContain("text=Parish+Picnic")
    expect(url).toContain("dates=20260715T093000Z%2F20260715T110000Z")
    expect(url).toContain("location=Hall%2C+Springfield")
  })
})
