/** @jest-environment node */
jest.mock("server-only", () => ({}))
jest.mock("@/lib/prisma", () => ({
  prisma: { sundaySchoolEnrolment: { findMany: jest.fn() }, person: { findMany: jest.fn() } },
}))
jest.mock("@/lib/crypto", () => ({
  decrypt: jest.fn((v: string) => {
    if (v === "enc:corrupt") throw new Error("bad")
    return v.replace(/^enc:/, "")
  }),
}))

import { prisma } from "@/lib/prisma"
import { loadStudentParents, selectParentRecipients } from "@/lib/sundaySchoolParents"

const p = prisma as unknown as { sundaySchoolEnrolment: { findMany: jest.Mock }; person: { findMany: jest.Mock } }
type Parent = { id: number; email: string | null; emailConsent: boolean }
const parent = (id: number, email: string | null = `enc:p${id}@example.com`, emailConsent = true): Parent => ({ id, email, emailConsent })
const child = (id: number, people: Parent[]) => ({ person: { id, firstName: `C${id}`, lastName: "Kid", family: { people } } })

beforeEach(() => {
  jest.clearAllMocks()
  p.person.findMany.mockImplementation(async ({ where }: { where: { id: { in: number[] } } }) =>
    where.id.in.map((id) => ({ id, firstName: `P${id}`, lastName: "Parent" })))
})

describe("loadStudentParents", () => {
  it("queries live enrolments in the class and only live HEAD/SPOUSE family members", async () => {
    p.sundaySchoolEnrolment.findMany.mockResolvedValue([])
    await loadStudentParents(5, [1, 2])
    const q = p.sundaySchoolEnrolment.findMany.mock.calls[0][0]
    expect(q.where).toEqual({ classId: 5, person: { archivedAt: null }, personId: { in: [1, 2] } })
    expect(q.select.person.select.family.select.people.where).toEqual({ archivedAt: null, role: { in: ["HEAD", "SPOUSE"] } })
  })

  it("whole class when no ids are given", async () => {
    p.sundaySchoolEnrolment.findMany.mockResolvedValue([])
    await loadStudentParents(5)
    expect(p.sundaySchoolEnrolment.findMany.mock.calls[0][0].where).toEqual({ classId: 5, person: { archivedAt: null } })
  })

  it("keeps consenting parents with an address-shaped email; flags children with none", async () => {
    p.sundaySchoolEnrolment.findMany.mockResolvedValue([
      child(1, [parent(10), parent(11, "enc:p11@example.com", false)]), // one opted out
      child(2, []), // no HEAD/SPOUSE in the family
      child(3, [parent(12, null), parent(13, "enc:corrupt"), parent(14, "enc:not-an-address")]),
      child(4, [parent(4)]), // the child is its own family's HEAD: not a parent of itself
    ])
    expect(await loadStudentParents(5)).toEqual([
      { personId: 1, name: "C1 Kid", parentIds: [10], reason: null },
      { personId: 2, name: "C2 Kid", parentIds: [], reason: "NO_PARENT" },
      { personId: 3, name: "C3 Kid", parentIds: [], reason: "NO_REACHABLE_PARENT" },
      { personId: 4, name: "C4 Kid", parentIds: [], reason: "NO_PARENT" },
    ])
  })
})

describe("selectParentRecipients", () => {
  it("dedupes parents shared by siblings and lists skipped children by name and reason", async () => {
    p.sundaySchoolEnrolment.findMany.mockResolvedValue([
      child(1, [parent(10), parent(11)]),
      child(2, [parent(10), parent(11)]), // sibling
      child(3, [parent(12, null)]),
    ])
    const r = await selectParentRecipients(5, [1, 2, 3])
    expect(r.students).toBe(3)
    expect(r.recipients).toEqual([{ personId: 10, name: "P10 Parent" }, { personId: 11, name: "P11 Parent" }])
    expect(p.person.findMany.mock.calls[0][0].where).toEqual({ id: { in: [10, 11] } })
    expect(r.skipped).toEqual([{ personId: 3, name: "C3 Kid", reason: "NO_REACHABLE_PARENT" }])
  })

  it("returns no recipients without a second query when nobody is reachable", async () => {
    p.sundaySchoolEnrolment.findMany.mockResolvedValue([child(2, [])])
    const r = await selectParentRecipients(5, [2])
    expect(r.recipients).toEqual([])
    expect(p.person.findMany).not.toHaveBeenCalled()
  })

  it("never exposes an address", async () => {
    p.sundaySchoolEnrolment.findMany.mockResolvedValue([child(1, [parent(10)])])
    expect(JSON.stringify(await selectParentRecipients(5, [1]))).not.toContain("example.com")
  })
})
