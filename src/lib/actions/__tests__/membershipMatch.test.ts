/** @jest-environment node */
import { findMembershipMatches } from "@/lib/actions/membership"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

jest.mock("@/lib/prisma", () => ({ prisma: {
  membershipApplication: { findUnique: jest.fn() },
  person: { findMany: jest.fn() },
} }))
jest.mock("@/lib/crypto", () => ({ hmacEmail: () => "HASH", hmacMobile: () => "MHASH", encrypt: (s: string) => s, decrypt: (s: string) => s }))
jest.mock("@/auth", () => ({ auth: jest.fn() }))

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "9", role: "ADMIN" } })
})

it("returns empty for a non-editor role (IDOR guard)", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "3", role: "VIEWER" } })
  expect(await findMembershipMatches(1)).toEqual([])
  expect(prisma.membershipApplication.findUnique).not.toHaveBeenCalled()
})

it("returns email + mobile + surname matches deduped, email first", async () => {
  ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue({ id: 1, emailHash: "HASH", mobileHash: "MHASH", applicantName: "John Miller" })
  ;(prisma.person.findMany as jest.Mock)
    .mockResolvedValueOnce([{ familyId: 5, family: { name: "Miller" } }])          // email
    .mockResolvedValueOnce([{ familyId: 5, family: { name: "Miller" } }, { familyId: 6, family: { name: "Taylor" } }]) // mobile
    .mockResolvedValueOnce([{ familyId: 7, family: { name: "Miller" } }])          // surname
  const r = await findMembershipMatches(1)
  expect(r[0]).toEqual({ familyId: 5, familyName: "Miller", reason: "email" })
  expect(r.map((c) => c.familyId)).toEqual([5, 6, 7]) // deduped
})
it("returns empty when application missing", async () => {
  ;(prisma.membershipApplication.findUnique as jest.Mock).mockResolvedValue(null)
  expect(await findMembershipMatches(99)).toEqual([])
})
