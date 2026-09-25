/** @jest-environment node */
import { getFamilyLastUpdate } from "@/lib/actions/familyActivity"
import { prisma } from "@/lib/prisma"

// Locks in getFamilyLastUpdate's fallback chain: no audit row → Family.updatedAt
// (or null when the family is gone), the FAMILY_UPDATE_APPROVED self-update
// label with a masked invite email, and the generic admin label.

jest.mock("@/lib/crypto", () => ({
  safeDecrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { findFirst: jest.fn() },
    family: { findUnique: jest.fn() },
    familyUpdateSubmission: { findUnique: jest.fn() },
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
})

it("returns null when there is no audit row and no family", async () => {
  ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue(null)
  ;(prisma.family.findUnique as jest.Mock).mockResolvedValue(null)
  expect(await getFamilyLastUpdate(3)).toBeNull()
})

it("falls back to Family.updatedAt with an unknown actor when no audit row exists", async () => {
  const at = new Date("2026-01-02T00:00:00.000Z")
  ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue(null)
  ;(prisma.family.findUnique as jest.Mock).mockResolvedValue({ updatedAt: at })
  expect(await getFamilyLastUpdate(3)).toEqual({ at, actorLabel: "—", kind: "unknown" })
})

it("labels an admin change with the actor's name", async () => {
  const at = new Date("2026-01-03T00:00:00.000Z")
  ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue({
    action: "FAMILY_UPDATED",
    createdAt: at,
    metadata: null,
    user: { name: "Alice" },
  })
  expect(await getFamilyLastUpdate(3)).toEqual({ at, actorLabel: "Alice", kind: "admin" })
})

it("falls back to a generic admin label when the actor user is missing", async () => {
  const at = new Date("2026-01-04T00:00:00.000Z")
  ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue({
    action: "PERSON_UPDATED",
    createdAt: at,
    metadata: { familyId: 3 },
    user: null,
  })
  const r = await getFamilyLastUpdate(3)
  expect(r).toMatchObject({ actorLabel: "an administrator", kind: "admin" })
})

it("labels a self-update approval with the masked invite email", async () => {
  const at = new Date("2026-01-05T00:00:00.000Z")
  ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue({
    action: "FAMILY_UPDATE_APPROVED",
    createdAt: at,
    metadata: { submissionId: 9 },
    user: null,
  })
  ;(prisma.familyUpdateSubmission.findUnique as jest.Mock).mockResolvedValue({
    invite: { email: "enc:jane@example.com" },
  })
  const r = await getFamilyLastUpdate(3)
  expect(r?.kind).toBe("self-update")
  expect(r?.actorLabel).toContain("via self-update invite (")
  // maskEmail obscures the local part — the raw address must never leak.
  expect(r?.actorLabel).not.toContain("jane@example.com")
})

it("uses a generic self-update label when the submission has no invite email", async () => {
  const at = new Date("2026-01-06T00:00:00.000Z")
  ;(prisma.auditLog.findFirst as jest.Mock).mockResolvedValue({
    action: "FAMILY_UPDATE_APPROVED",
    createdAt: at,
    metadata: { submissionId: 9 },
    user: null,
  })
  ;(prisma.familyUpdateSubmission.findUnique as jest.Mock).mockResolvedValue({ invite: null })
  const r = await getFamilyLastUpdate(3)
  expect(r).toEqual({ at, actorLabel: "via self-update invite", kind: "self-update" })
})
