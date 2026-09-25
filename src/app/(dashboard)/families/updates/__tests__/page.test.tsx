/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { familyUpdateSubmission: { findMany: jest.fn(), count: jest.fn() } } }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("REDIRECT") }) }))

import { renderToStaticMarkup } from "react-dom/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import FamilyUpdatesInbox from "../page"

test("excludes archived families from both the inbox and its pending count", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
  ;(prisma.familyUpdateSubmission.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.familyUpdateSubmission.count as jest.Mock).mockResolvedValue(0)
  const html = renderToStaticMarkup(await FamilyUpdatesInbox())
  expect(html).toContain("No pending submissions.")
  expect(prisma.familyUpdateSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { status: "PENDING", family: { archivedAt: null } },
  }))
  expect(prisma.familyUpdateSubmission.count).toHaveBeenCalledWith({
    where: { status: "PENDING", family: { archivedAt: null } },
  })
})
