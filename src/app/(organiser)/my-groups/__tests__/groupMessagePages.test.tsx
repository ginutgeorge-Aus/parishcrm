/** @jest-environment node */
jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }),
  notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: { group: { findFirst: jest.fn() }, groupLeaderAccess: { findUnique: jest.fn() } },
}))
jest.mock("@/components/groups/GroupMessageViews", () => ({
  GroupComposeView: () => <div>compose</div>,
  GroupHistoryView: () => <div>history</div>,
}))

import MyGroupMessagePage from "@/app/(organiser)/my-groups/[id]/message/page"
import MyGroupMessagesPage from "@/app/(organiser)/my-groups/[id]/messages/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const p = prisma as unknown as { group: { findFirst: jest.Mock }; groupLeaderAccess: { findUnique: jest.Mock } }
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "EVENT_ORGANISER" } })
  p.group.findFirst.mockResolvedValue({ id: 4, name: "Choir" })
})

describe.each([
  ["compose", MyGroupMessagePage],
  ["history", MyGroupMessagesPage],
])("organiser group message %s page", (_n, Page) => {
  it("404s an organiser of another group (IDOR) before reading the group", async () => {
    p.groupLeaderAccess.findUnique.mockResolvedValue(null)
    await expect(Page(params("4"))).rejects.toThrow("NEXT_NOT_FOUND")
    expect(p.group.findFirst).not.toHaveBeenCalled()
  })

  it("404s a downgraded login with a stale link row", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "VIEWER" } })
    p.groupLeaderAccess.findUnique.mockResolvedValue({ id: 1 })
    await expect(Page(params("4"))).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("404s an archived group", async () => {
    p.groupLeaderAccess.findUnique.mockResolvedValue({ id: 1 })
    p.group.findFirst.mockResolvedValue(null)
    await expect(Page(params("4"))).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("renders for a linked organiser", async () => {
    p.groupLeaderAccess.findUnique.mockResolvedValue({ id: 1 })
    await expect(Page(params("4"))).resolves.toBeTruthy()
  })
})
