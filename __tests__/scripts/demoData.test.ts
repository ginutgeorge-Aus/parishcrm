/** @jest-environment node */
import { buildDemoData, centsToDecimal, ymd } from "../../scripts/demo/demoData"
import { pettyCashTitle } from "@/lib/formatting"

const TODAY = new Date(Date.UTC(2026, 9, 2)) // 2 Oct 2026

describe("buildDemoData", () => {
  const data = buildDemoData(TODAY)

  it("is deterministic for the same seed and date", () => {
    expect(JSON.stringify(buildDemoData(TODAY))).toEqual(JSON.stringify(data))
    expect(JSON.stringify(buildDemoData(TODAY, 7))).not.toEqual(JSON.stringify(data))
  })

  it("hits size targets", () => {
    const people = data.families.flatMap((f) => f.people)
    expect(data.families).toHaveLength(40)
    expect(people.length).toBeGreaterThanOrEqual(120)
    expect(people.length).toBeLessThanOrEqual(180)
    expect(data.transactions.length).toBeGreaterThan(400)
    expect(data.events.filter((e) => e.date < TODAY)).toHaveLength(3)
    expect(data.events.filter((e) => e.date > TODAY)).toHaveLength(2)
    expect(data.users).toHaveLength(6)
  })

  it("uses unique family names and per-family-unique person names", () => {
    expect(new Set(data.families.map((f) => f.name)).size).toBe(40)
    for (const f of data.families) {
      const keys = f.people.map((p) => `${p.firstName} ${p.lastName}`)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it("only uses synthetic contact details", () => {
    const people = data.families.flatMap((f) => f.people)
    for (const p of people) {
      if (p.email) expect(p.email).toMatch(/@example\.com$/)
      if (p.mobile) {
        const n = Number(p.mobile.slice(7))
        expect(p.mobile.startsWith("0491570")).toBe(true)
        expect(n).toBeGreaterThanOrEqual(6)
        expect(n).toBeLessThanOrEqual(159)
      }
    }
    expect(new Set(people.filter((p) => p.mobile).map((p) => p.mobile)).size)
      .toBe(people.filter((p) => p.mobile).length)
  })

  it("puts at least 3 birthdays and 1 anniversary in the next 7 days", () => {
    const inWeek = (m: number, d: number) => {
      for (let k = 0; k < 7; k++) {
        const t = new Date(TODAY.getTime() + k * 86_400_000)
        if (t.getUTCMonth() === m && t.getUTCDate() === d) return true
      }
      return false
    }
    const bdays = data.families.flatMap((f) => f.people).filter((p) => {
      const [, m, d] = p.dateOfBirth.split("-").map(Number)
      return inWeek(m - 1, d)
    })
    const annivs = data.families.filter((f) => f.marriageDate && inWeek(f.marriageDate.getUTCMonth(), f.marriageDate.getUTCDate()))
    expect(bdays.length).toBeGreaterThanOrEqual(3)
    expect(annivs.length).toBeGreaterThanOrEqual(1)
  })

  it("keeps transactions within the last 12 months and positive", () => {
    const yearAgo = new Date(TODAY.getTime() - 366 * 86_400_000)
    for (const t of data.transactions) {
      expect(t.date <= TODAY && t.date >= yearAgo).toBe(true)
      expect(Number.isInteger(t.cents) && t.cents > 0).toBe(true)
    }
  })

  it("titles petty cash sessions exactly like the app", () => {
    for (const s of data.pettyCash) expect(s.title).toBe(pettyCashTitle(ymd(s.date)))
    expect(data.pettyCash.filter((s) => !s.closed)).toHaveLength(1)
  })

  it("assigns exactly one event to the organiser", () => {
    expect(data.events.filter((e) => e.managedByOrganiser)).toHaveLength(1)
  })

  it("formats cents without float parsing", () => {
    expect(centsToDecimal(12345)).toBe("123.45")
    expect(centsToDecimal(5)).toBe("0.05")
    expect(centsToDecimal(100000)).toBe("1000.00")
  })
  it("keeps forced dates in their month across Feb 29 (non-leap birth years)", () => {
    const leapEve = new Date(Date.UTC(2028, 1, 27)) // +2 days = 29 Feb 2028
    const people = buildDemoData(leapEve).families.flatMap((f) => f.people)
    expect(people.some((p) => p.dateOfBirth.endsWith("-03-01"))).toBe(false)
  })
})
