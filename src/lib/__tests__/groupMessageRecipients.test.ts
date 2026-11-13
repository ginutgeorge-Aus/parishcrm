/** @jest-environment node */
jest.mock("server-only", () => ({}))
jest.mock("@/lib/prisma", () => ({ prisma: { groupMember: { findMany: jest.fn() } } }))
jest.mock("@/lib/crypto", () => ({
  decrypt: jest.fn((v: string) => {
    if (v === "enc:corrupt") throw new Error("bad")
    return v.replace(/^enc:/, "")
  }),
}))

import { prisma } from "@/lib/prisma"
import { selectRecipients } from "@/lib/groupRecipients"

const findMany = (prisma as unknown as { groupMember: { findMany: jest.Mock } }).groupMember.findMany
const member = (id: number, email: string | null, emailConsent = true) => ({
  person: { id, firstName: `F${id}`, lastName: `L${id}`, email, emailConsent },
})

beforeEach(() => jest.clearAllMocks())

describe("selectRecipients", () => {
  it("returns consenting members with a decryptable address, skips the rest with a reason", async () => {
    findMany.mockResolvedValue([
      member(1, "enc:a@example.com"),
      member(2, "enc:b@example.com", false), // opted out
      member(3, null), // no address
      member(4, "enc:corrupt"), // undecryptable
      member(5, "enc:not-an-address"), // wrong shape
      member(6, null, false), // opted out wins over missing address
    ])
    const r = await selectRecipients(7)
    expect(r.recipients).toEqual([{ personId: 1, name: "F1 L1" }])
    expect(r.skipped).toEqual([
      { personId: 2, name: "F2 L2", reason: "NO_CONSENT" },
      { personId: 3, name: "F3 L3", reason: "NO_EMAIL" },
      { personId: 4, name: "F4 L4", reason: "BAD_EMAIL" },
      { personId: 5, name: "F5 L5", reason: "BAD_EMAIL" },
      { personId: 6, name: "F6 L6", reason: "NO_CONSENT" },
    ])
  })

  it("never exposes an address in its result", async () => {
    findMany.mockResolvedValue([member(1, "enc:a@example.com")])
    expect(JSON.stringify(await selectRecipients(7))).not.toContain("a@example.com")
  })

  it("queries only live (non-archived) people in this group", async () => {
    findMany.mockResolvedValue([])
    await selectRecipients(7)
    expect(findMany.mock.calls[0][0].where).toEqual({ groupId: 7, person: { archivedAt: null } })
  })
})
