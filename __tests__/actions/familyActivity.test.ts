import { getFamilyLastUpdate } from "@/lib/actions/familyActivity"
import { prisma } from "@/lib/prisma"

jest.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { findFirst: jest.fn() },
    familyUpdateSubmission: { findUnique: jest.fn() },
    family: { findUnique: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))

const at = new Date("2026-06-27T04:40:00.000Z")

beforeEach(() => jest.clearAllMocks())

it("admin edit -> by user name, kind admin", async () => {
  ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue({
    action: "FAMILY_UPDATED", createdAt: at, metadata: { monthlyDues: 60 },
    user: { name: "Alex Admin" },
  })
  const r = await getFamilyLastUpdate(5)
  expect(r).toEqual({ at, actorLabel: "Alex Admin", kind: "admin" })
})

it("member edit counts -> kind admin by editor", async () => {
  ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue({
    action: "PERSON_UPDATED", createdAt: at, metadata: { familyId: 5 },
    user: { name: "Tom A" },
  })
  const r = await getFamilyLastUpdate(5)
  expect(r).toEqual({ at, actorLabel: "Tom A", kind: "admin" })
})

it("self-update -> masked invite email, kind self-update", async () => {
  ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue({
    action: "FAMILY_UPDATE_APPROVED", createdAt: at, metadata: { submissionId: 9 },
    user: { name: "Approver Admin" },
  })
  ;(prisma.familyUpdateSubmission.findUnique as jest.Mock).mockResolvedValue({
    invite: { email: "enc:jdoe@gmail.com" },
  })
  const r = await getFamilyLastUpdate(5)
  expect(r).toEqual({ at, actorLabel: "via self-update invite (j***@gmail.com)", kind: "self-update" })
})

it("self-update with missing invite -> generic label, no throw", async () => {
  ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue({
    action: "FAMILY_UPDATE_APPROVED", createdAt: at, metadata: { submissionId: 9 },
    user: { name: "Approver Admin" },
  })
  ;(prisma.familyUpdateSubmission.findUnique as jest.Mock).mockResolvedValue(null)
  const r = await getFamilyLastUpdate(5)
  expect(r).toEqual({ at, actorLabel: "via self-update invite", kind: "self-update" })
})

it("no audit rows -> fallback to family.updatedAt, kind unknown", async () => {
  ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue(null)
  ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ updatedAt: at })
  const r = await getFamilyLastUpdate(5)
  expect(r).toEqual({ at, actorLabel: "—", kind: "unknown" })
})
