/** @jest-environment node */
import { buildRosterIcs, escapeIcsText, foldIcsLine } from "@/lib/rosterIcs"

const now = new Date("2026-07-01T00:00:00.000Z")
const a = {
  id: "asg-1",
  title: "Usher; Sunday, 9am",
  start: new Date("2026-07-15T09:30:00.000Z"),
  end: new Date("2026-07-15T11:00:00.000Z"),
}

/** Unfold per RFC 5545 for content assertions. */
const unfold = (s: string) => s.replace(/\r\n /g, "")

describe("escapeIcsText", () => {
  it("escapes backslash, semicolon, comma, newline", () => {
    expect(escapeIcsText("a\\b;c,d\ne\r\nf")).toBe(String.raw`a\\b\;c\,d\ne\nf`)
  })
})

describe("escapeIcsText bare CR", () => {
  it("escapes a lone \\r so it cannot inject a property", () => {
    const out = escapeIcsText("line one\rORGANIZER:mailto:evil@example.com")
    expect(out).not.toMatch(/[\r\n]/)
    expect(out).toBe(String.raw`line one\nORGANIZER:mailto:evil@example.com`)
  })
})

describe("foldIcsLine", () => {
  it("leaves short lines alone", () => {
    expect(foldIcsLine("SUMMARY:hi")).toBe("SUMMARY:hi")
  })
  it("folds ASCII so every physical line is <= 75 octets", () => {
    const folded = foldIcsLine("DESCRIPTION:" + "x".repeat(300))
    const parts = folded.split("\r\n")
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect(Buffer.byteLength(p)).toBeLessThanOrEqual(75)
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true)
    expect(unfold(folded)).toBe("DESCRIPTION:" + "x".repeat(300))
  })
  it("never splits multibyte characters", () => {
    const text = "SUMMARY:" + "é€😀".repeat(60)
    const folded = foldIcsLine(text)
    for (const p of folded.split("\r\n")) {
      expect(Buffer.byteLength(p)).toBeLessThanOrEqual(75)
      expect(p).not.toContain("�")
    }
    expect(unfold(folded)).toBe(text)
  })
})

describe("buildRosterIcs", () => {
  it("empty list gives a valid empty calendar", () => {
    const ics = buildRosterIcs([], { now })
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true)
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true)
    expect(ics).not.toContain("VEVENT")
  })

  it("uses CRLF only, no bare LF", () => {
    const ics = buildRosterIcs([a], { now })
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/)
  })

  it("emits structure, escaped summary and DTSTAMP format", () => {
    const ics = buildRosterIcs([a], { now, calendarName: "My roster" })
    expect(ics).toContain("VERSION:2.0\r\n")
    expect(ics).toContain("X-WR-CALNAME:My roster\r\n")
    expect(ics).toContain("BEGIN:VEVENT\r\n")
    expect(ics).toContain(String.raw`SUMMARY:Usher\; Sunday\, 9am` + "\r\n")
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z\r\n/)
    expect(ics).toContain("DTSTAMP:20260701T000000Z\r\n")
    expect(ics).toContain("DTSTART:20260715T093000Z\r\n")
    expect(ics).toContain("DTEND:20260715T110000Z\r\n")
    expect(ics).not.toContain("DESCRIPTION")
  })

  it("UID is stable across builds and distinct per assignment", () => {
    const x = buildRosterIcs([a], { now })
    const y = buildRosterIcs([a], { now: new Date("2030-01-01T00:00:00Z") })
    const uid = (s: string) => /UID:(.*)\r\n/.exec(s)?.[1]
    expect(uid(x)).toBe(uid(y))
    const two = buildRosterIcs([a, { ...a, id: "asg-2" }], { now })
    expect(two.match(/UID:.*/g)).toHaveLength(2)
    expect(new Set(two.match(/UID:.*/g)).size).toBe(2)
  })

  it("folds long descriptions and keeps content", () => {
    const description = "Bring é€ items, " + "long ".repeat(60)
    const ics = buildRosterIcs([{ ...a, description, location: "Hall" }], { now })
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)
    }
    expect(unfold(ics)).toContain("DESCRIPTION:" + escapeIcsText(description))
    expect(ics).toContain("LOCATION:Hall\r\n")
  })

  it("rejects CR/LF injection via uidDomain and falls back to default", () => {
    const ics = buildRosterIcs([a], {
      now,
      uidDomain: "example.org\r\nSUMMARY:Injected",
    })
    expect(ics).not.toContain("SUMMARY:Injected")
    expect(ics).toContain("UID:asg-1@roster.parishcrm\r\n")
  })

  it("accepts a valid uidDomain and omits METHOD", () => {
    const ics = buildRosterIcs([a], { now, uidDomain: "example.org" })
    expect(ics).toContain("UID:asg-1@example.org\r\n")
    expect(ics).not.toContain("METHOD:")
  })
})
