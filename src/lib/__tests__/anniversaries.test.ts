import { upcomingAnniversaries, anniversaryYears, type AnniversaryFamily } from "@/lib/anniversaries"

const today = new Date("2026-06-15T00:00:00.000Z")
const head = { id: 1, firstName: "Sam", role: "HEAD" as const, email: "s@x.com", emailConsent: true }
const spouse = { id: 2, firstName: "Pat", role: "SPOUSE" as const, email: "p@x.com", emailConsent: true }
const child = { id: 3, firstName: "Kid", role: "CHILD" as const, email: "k@x.com", emailConsent: true }
function fam(id: number, marriageISO: string, people: AnniversaryFamily["people"]): AnniversaryFamily {
  return { id, name: `Fam${id}`, marriageDate: new Date(marriageISO), people }
}

test("matches today's anniversary, ≥1 year, couple only", () => {
  const due = upcomingAnniversaries([fam(10, "2020-06-15T00:00:00.000Z", [head, spouse, child])], 0, today)
  expect(due).toHaveLength(1)
  expect(due[0]).toMatchObject({ familyId: 10, yearsMarried: 6, daysUntil: 0, coupleNames: "Sam and Pat" })
  expect(due[0].recipients.map((r) => r.id).sort()).toEqual([1, 2]) // no child
})

test("window includes an anniversary N days out; sorted by daysUntil", () => {
  const due = upcomingAnniversaries([
    fam(11, "2019-06-22T00:00:00.000Z", [head]), // +7
    fam(12, "2019-06-18T00:00:00.000Z", [head]), // +3
  ], 14, today)
  expect(due.map((d) => d.familyId)).toEqual([12, 11])
})

test("skips the wedding year itself (year 0)", () => {
  expect(upcomingAnniversaries([fam(13, "2026-06-15T00:00:00.000Z", [head])], 30, today)).toHaveLength(0)
})

test("29 Feb marriage observed on 28 Feb in a non-leap year", () => {
  const feb28 = new Date("2027-02-28T00:00:00.000Z")
  expect(upcomingAnniversaries([fam(14, "2016-02-29T00:00:00.000Z", [head])], 0, feb28).map((d) => d.familyId)).toEqual([14])
})

test("anniversaryYears = years at the upcoming occurrence", () => {
  expect(anniversaryYears(new Date("2020-06-15T00:00:00.000Z"), today)).toBe(6)
})
