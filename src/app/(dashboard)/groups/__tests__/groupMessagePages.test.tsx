/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }),
  notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { group: { findFirst: jest.fn() } } }))
jest.mock("@/lib/groupAccess", () => ({ canManageGroupMembers: jest.fn() }))
jest.mock("@/components/groups/GroupMessageViews", () => ({
  GroupComposeView: (p: { historyHref: string }) => <div>compose {p.historyHref}</div>,
  GroupHistoryView: (p: { composeHref: string }) => <div>history {p.composeHref}</div>,
}))

import GroupMessagePage from "@/app/(dashboard)/groups/[id]/message/page"
import GroupMessagesPage from "@/app/(dashboard)/groups/[id]/messages/page"
import MyGroupMessagePage from "@/app/(organiser)/my-groups/[id]/message/page"
import MyGroupMessagesPage from "@/app/(organiser)/my-groups/[id]/messages/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { canManageGroupMembers } from "@/lib/groupAccess"

const findFirst = (prisma as unknown as { group: { findFirst: jest.Mock } }).group.findFirst
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "ADMIN" } })
  ;(canManageGroupMembers as jest.Mock).mockResolvedValue(true)
  findFirst.mockResolvedValue({ id: 4, name: "Choir" })
})

describe.each([
  ["dashboard compose", GroupMessagePage, "/groups", "Groups", "Email group", "compose /groups/4/messages", "/"],
  ["dashboard history", GroupMessagesPage, "/groups", "Groups", "Sent messages", "history /groups/4/message", "/"],
  ["organiser compose", MyGroupMessagePage, "/my-groups", "My Groups", "Email group", "compose /my-groups/4/messages", null],
  ["organiser history", MyGroupMessagesPage, "/my-groups", "My Groups", "Sent messages", "history /my-groups/4/message", null],
])("%s page", (_n, Page, base, rootLabel, heading, viewText, deniedTo) => {
  it("renders breadcrumb, heading and view for an allowed user", async () => {
    const html = renderToStaticMarkup(await Page(params("4")))
    expect(html).toContain(`href="${base}"`)
    expect(html).toContain(rootLabel)
    expect(html).toContain(`href="${base}/4"`)
    expect(html).toContain("Choir")
    expect(html).toContain(heading)
    expect(html).toContain(viewText)
  })

  it("sends a signed-out visitor to login", async () => {
    ;(auth as jest.Mock).mockResolvedValue(null)
    await expect(Page(params("4"))).rejects.toThrow("NEXT_REDIRECT /login")
  })

  it("404s a non-numeric id without reading the group", async () => {
    await expect(Page(params("abc"))).rejects.toThrow("NEXT_NOT_FOUND")
    expect(findFirst).not.toHaveBeenCalled()
  })

  it(deniedTo ? "redirects home when access is denied" : "404s when access is denied", async () => {
    ;(canManageGroupMembers as jest.Mock).mockResolvedValue(false)
    await expect(Page(params("4"))).rejects.toThrow(deniedTo ? `NEXT_REDIRECT ${deniedTo}` : "NEXT_NOT_FOUND")
    expect(findFirst).not.toHaveBeenCalled()
  })

  it("404s an archived or missing group", async () => {
    findFirst.mockResolvedValue(null)
    await expect(Page(params("4"))).rejects.toThrow("NEXT_NOT_FOUND")
  })
})
