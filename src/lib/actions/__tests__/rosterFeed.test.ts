/** @jest-environment node */
import { UserRole } from "@/lib/generated/prisma/enums"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const m = { rosterFeedToken: { upsert: jest.fn() }, $transaction: jest.fn() }
  m.$transaction.mockImplementation((fn: (tx: typeof m) => unknown) => fn(m))
  return { prisma: m }
})
jest.mock("@/lib/audit", () => ({ logAuditTx: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAuditTx } from "@/lib/audit"
import { rotateRosterFeedToken } from "@/lib/actions/rosterFeed"
import { hashRosterFeedToken } from "@/lib/rosterFeed"

const upsert = (prisma as unknown as { rosterFeedToken: { upsert: jest.Mock } }).rosterFeedToken.upsert
const as = (role: UserRole | undefined) => (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "9", role } } : null)

beforeEach(() => {
  jest.clearAllMocks()
  as(UserRole.ADMIN)
  upsert.mockResolvedValue({ id: 5 })
  process.env.AUTH_URL = "https://app.example.com"
})

describe("rotateRosterFeedToken", () => {
  it.each([UserRole.VIEWER, UserRole.AUDITOR, UserRole.EVENT_ORGANISER, UserRole.TEACHER, undefined])("refuses %s", async (role) => {
    as(role)
    await expect(rotateRosterFeedToken(7)).resolves.toEqual({ error: "Unauthorized" })
    expect(upsert).not.toHaveBeenCalled()
  })

  it("rejects an invalid person id", async () => {
    await expect(rotateRosterFeedToken(0)).resolves.toEqual({ error: "Invalid person" })
  })

  it("stores only the hash, returns the URL once, and never audits the token", async () => {
    const r = await rotateRosterFeedToken(7)
    if (!("url" in r)) throw new Error("expected url")
    const token = r.url.split("/").pop() as string
    expect(r.url).toBe(`https://app.example.com/api/roster/feed/${token}`)
    const args = upsert.mock.calls[0][0]
    expect(args.where).toEqual({ personId: 7 })
    expect(args.create.tokenHash).toBe(hashRosterFeedToken(token))
    expect(args.update.tokenHash).toBe(hashRosterFeedToken(token))
    expect(JSON.stringify(args)).not.toContain(token)
    expect(JSON.stringify((logAuditTx as jest.Mock).mock.calls)).not.toContain(token)
    expect(logAuditTx).toHaveBeenCalledWith(expect.anything(), 9, "ROSTER_FEED_TOKEN_ROTATED", "RosterFeedToken", 5, { personId: 7 })
  })

  it("issues a different link each time (rotation)", async () => {
    const a = await rotateRosterFeedToken(7)
    const b = await rotateRosterFeedToken(7)
    expect(a).not.toEqual(b)
  })

  it("maps a missing person (FK error) to a message", async () => {
    upsert.mockRejectedValue({ code: "P2003" })
    await expect(rotateRosterFeedToken(7)).resolves.toEqual({ error: "Person not found" })
  })
})
