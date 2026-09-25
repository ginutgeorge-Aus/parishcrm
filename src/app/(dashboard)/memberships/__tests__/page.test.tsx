/** @jest-environment node */
import MembershipsInbox from "../page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => {
    throw new Error("REDIRECT")
  }),
}))
jest.mock("@/lib/membershipSettings", () => ({ getMembershipSettings: jest.fn().mockResolvedValue({ parishFields: false, minDues: null }) }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    membershipApplication: { findMany: jest.fn(), count: jest.fn() },
  },
}))

beforeEach(() => jest.clearAllMocks())

const sp = (o: Record<string, string> = {}) => Promise.resolve(o)

it("redirects a VIEWER away from the queue", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "3", role: "VIEWER" } })
  await expect(MembershipsInbox({ searchParams: sp() })).rejects.toThrow("REDIRECT")
  expect(redirect).toHaveBeenCalledWith("/")
  expect(prisma.membershipApplication.findMany).not.toHaveBeenCalled()
})

it("lists pending applications for an ADMIN", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.membershipApplication.findMany as jest.Mock).mockResolvedValue([
    { id: 7, applicantName: "John Miller", createdAt: new Date("2026-07-09"), status: "PENDING" },
  ])
  ;(prisma.membershipApplication.count as jest.Mock).mockResolvedValue(1)

  const el = await MembershipsInbox({ searchParams: sp() })
  expect(el).toBeTruthy()
  expect(redirect).not.toHaveBeenCalled()
  expect(prisma.membershipApplication.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { status: "PENDING" } }),
  )
})
