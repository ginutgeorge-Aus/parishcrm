/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }),
  notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    group: { findFirst: jest.fn() },
    groupMember: { findMany: jest.fn() },
    groupLeaderAccess: { findUnique: jest.fn(), findMany: jest.fn() },
  },
}))
jest.mock("@/lib/crypto", () => ({ safeDecrypt: jest.fn((v: string) => v) }))
jest.mock("server-only", () => ({}))
jest.mock("@/components/groups/MembersPanel", () => ({
  MembersPanel: ({ members }: { members: { name: string }[] }) => <ul>{members.map((m) => <li key={m.name}>{m.name}</li>)}</ul>,
}))

import MyGroupPage from "@/app/(organiser)/my-groups/[id]/page"
import MyGroupsPage from "@/app/(organiser)/my-groups/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const p = prisma as unknown as {
  group: { findFirst: jest.Mock }
  groupMember: { findMany: jest.Mock }
  groupLeaderAccess: { findUnique: jest.Mock; findMany: jest.Mock }
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "EVENT_ORGANISER" } })
  p.group.findFirst.mockResolvedValue({ id: 4, name: "Choir", category: "MINISTRY" })
  p.groupMember.findMany.mockResolvedValue([
    { role: "MEMBER", title: "", person: { id: 3, firstName: "Jo", lastName: "Doe", family: { name: "Doe" } } },
  ])
})

describe("/my-groups/[id]", () => {
  it("404s an organiser not linked to the group, before reading the group or its members", async () => {
    p.groupLeaderAccess.findUnique.mockResolvedValue(null)
    await expect(MyGroupPage(params("4"))).rejects.toThrow("NEXT_NOT_FOUND")
    expect(p.groupLeaderAccess.findUnique).toHaveBeenCalledWith({ where: { groupId_userId: { groupId: 4, userId: 5 } }, select: { id: true } })
    expect(p.group.findFirst).not.toHaveBeenCalled()
    expect(p.groupMember.findMany).not.toHaveBeenCalled()
  })

  it("404s a VIEWER even with a stale link row", async () => {
    ;(auth as jest.Mock).mockResolvedValue({ user: { id: "5", role: "VIEWER" } })
    p.groupLeaderAccess.findUnique.mockResolvedValue({ id: 1 })
    await expect(MyGroupPage(params("4"))).rejects.toThrow("NEXT_NOT_FOUND")
    expect(p.groupMember.findMany).not.toHaveBeenCalled()
  })

  it("404s a linked organiser once the group is archived", async () => {
    p.groupLeaderAccess.findUnique.mockResolvedValue({ id: 1 })
    p.group.findFirst.mockResolvedValue(null)
    await expect(MyGroupPage(params("4"))).rejects.toThrow("NEXT_NOT_FOUND")
    expect(p.group.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 4, archivedAt: null } }))
  })

  it("shows a linked organiser the members", async () => {
    p.groupLeaderAccess.findUnique.mockResolvedValue({ id: 1 })
    const html = renderToStaticMarkup(await MyGroupPage(params("4")))
    expect(html).toContain("Choir")
    expect(html).toContain("Jo Doe")
  })

  it("404s a bad id", async () => {
    await expect(MyGroupPage(params("abc"))).rejects.toThrow("NEXT_NOT_FOUND")
  })
})

describe("/my-groups", () => {
  it("lists only this login's linked live groups", async () => {
    p.groupLeaderAccess.findMany.mockResolvedValue([{ group: { id: 4, name: "Choir", category: "MINISTRY", _count: { members: 2 } } }])
    const html = renderToStaticMarkup(await MyGroupsPage())
    expect(p.groupLeaderAccess.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 5, group: { archivedAt: null } } }))
    expect(html).toContain("Choir")
    expect(html).toContain("2 members")
  })

  it("shows the empty notice when nothing is linked", async () => {
    p.groupLeaderAccess.findMany.mockResolvedValue([])
    expect(renderToStaticMarkup(await MyGroupsPage())).toContain("No groups linked to you yet")
  })
})
