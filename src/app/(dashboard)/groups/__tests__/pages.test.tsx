/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"

jest.mock("next/navigation", () => ({
  redirect: jest.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) }),
  notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
  useRouter: () => ({}),
  unstable_rethrow: jest.fn(),
}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("server-only", () => ({}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    group: { findMany: jest.fn(), findUnique: jest.fn() },
    groupLeaderAccess: { findMany: jest.fn() },
  },
}))
jest.mock("@/lib/groupMembers", () => ({ loadMemberRows: jest.fn() }))
jest.mock("@/lib/actions/eventAccess", () => ({ listAssignableOrganisers: jest.fn() }))
jest.mock("@/lib/actions/group", () => ({ createGroup: jest.fn(), updateGroup: jest.fn() }))
jest.mock("@/components/groups/MembersPanel", () => ({
  MembersPanel: ({ members, readOnly }: { members: { name: string }[]; readOnly: boolean }) => (
    <ul data-ro={String(readOnly)}>{members.map((m) => <li key={m.name}>{m.name}</li>)}</ul>
  ),
}))
jest.mock("@/components/groups/LeaderAccessPanel", () => ({
  LeaderAccessPanel: ({ linked }: { linked: { name: string; active: boolean }[] }) => (
    <div>{linked.map((l) => <span key={l.name}>{`${l.name}:${l.active}`}</span>)}</div>
  ),
}))
jest.mock("@/components/groups/ArchiveGroupButton", () => ({
  RestoreGroupButton: () => <button>RestoreStub</button>,
  ArchiveGroupButton: () => <button>ArchiveStub</button>,
}))
jest.mock("@/components/groups/GroupForm", () => ({
  GroupForm: ({ group }: { group?: { name: string } }) => <form>{group ? `edit ${group.name}` : "create form"}</form>,
}))

import GroupsPage from "@/app/(dashboard)/groups/page"
import GroupPage from "@/app/(dashboard)/groups/[id]/page"
import EditGroupPage from "@/app/(dashboard)/groups/[id]/edit/page"
import NewGroupPage from "@/app/(dashboard)/groups/new/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { loadMemberRows } from "@/lib/groupMembers"
import { listAssignableOrganisers } from "@/lib/actions/eventAccess"

const p = prisma as unknown as {
  group: { findMany: jest.Mock; findUnique: jest.Mock }
  groupLeaderAccess: { findMany: jest.Mock }
}
const as = (role?: string) => (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "1", role } } : null)
const sp = (o: { category?: string; archived?: string } = {}) => ({ searchParams: Promise.resolve(o) })
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const group = { id: 4, name: "Choir", category: "MINISTRY", description: "Sings", archivedAt: null as Date | null }

beforeEach(() => {
  jest.clearAllMocks()
  as("ADMIN")
  p.group.findMany.mockResolvedValue([])
  p.group.findUnique.mockResolvedValue(group)
  p.groupLeaderAccess.findMany.mockResolvedValue([
    { user: { id: 7, name: "Liz", email: "l@example.com", role: "EVENT_ORGANISER" } },
    { user: { id: 8, name: "Old", email: "o@example.com", role: "VIEWER" } },
  ])
  ;(loadMemberRows as jest.Mock).mockResolvedValue([{ personId: 3, name: "Jo Doe" }])
  ;(listAssignableOrganisers as jest.Mock).mockResolvedValue([])
})

describe("/groups", () => {
  it("redirects anonymous to login and non-viewers home", async () => {
    as()
    await expect(GroupsPage(sp())).rejects.toThrow("NEXT_REDIRECT /login")
    as("EVENT_ORGANISER")
    await expect(GroupsPage(sp())).rejects.toThrow("NEXT_REDIRECT /")
  })

  it("redirects AUDITOR home without querying", async () => {
    as("AUDITOR")
    await expect(GroupsPage(sp())).rejects.toThrow("NEXT_REDIRECT /")
    expect(p.group.findMany).not.toHaveBeenCalled()
  })

  it("ignores an invalid category filter", async () => {
    await GroupsPage(sp({ category: "bogus" }))
    expect(p.group.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { archivedAt: null } }))
  })

  it("lists groups with counts, singular/plural, and a New button for managers", async () => {
    p.group.findMany.mockResolvedValue([
      { id: 1, name: "Choir", category: "MINISTRY", description: "Sings", _count: { members: 1 } },
      { id: 2, name: "Board", category: "COMMITTEE", description: "", _count: { members: 3 } },
    ])
    const html = renderToStaticMarkup(await GroupsPage(sp({ category: "COMMITTEE" })))
    expect(p.group.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { archivedAt: null, category: "COMMITTEE" } }))
    expect(html).toContain("1 member<")
    expect(html).toContain("3 members")
    expect(html).toContain("New group")
    expect(html).toContain("Show archived groups")
  })

  it("empty state offers create to managers only; archived view has no New", async () => {
    expect(renderToStaticMarkup(await GroupsPage(sp()))).toContain("Create the first group")
    as("VIEWER")
    const viewer = renderToStaticMarkup(await GroupsPage(sp()))
    expect(viewer).toContain("No groups yet.")
    expect(viewer).not.toContain("New group")
    as("ADMIN")
    const arch = renderToStaticMarkup(await GroupsPage(sp({ archived: "1" })))
    expect(p.group.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { archivedAt: { not: null } } }))
    expect(arch).toContain("Archived groups")
    expect(arch).toContain("No archived groups.")
    expect(arch).toContain("Back to active groups")
  })
})

describe("/groups/[id]", () => {
  it("redirects and 404s", async () => {
    as()
    await expect(GroupPage(params("4"))).rejects.toThrow("NEXT_REDIRECT /login")
    as("EVENT_ORGANISER")
    await expect(GroupPage(params("4"))).rejects.toThrow("NEXT_REDIRECT /")
    as("ADMIN")
    await expect(GroupPage(params("abc"))).rejects.toThrow("NEXT_NOT_FOUND")
    p.group.findUnique.mockResolvedValue(null)
    await expect(GroupPage(params("4"))).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("manager sees edit, members editable and leader logins", async () => {
    const html = renderToStaticMarkup(await GroupPage(params("4")))
    expect(html).toContain("Choir")
    expect(html).toContain("/groups/4/edit")
    expect(html).toContain("Members (1)")
    expect(html).toContain('data-ro="false"')
    expect(html).toContain("Liz:true")
    expect(html).toContain("Old:false")
    expect(listAssignableOrganisers).toHaveBeenCalled()
  })

  it("viewer sees read-only members and no leader data", async () => {
    as("VIEWER")
    const html = renderToStaticMarkup(await GroupPage(params("4")))
    expect(html).toContain('data-ro="true"')
    expect(html).not.toContain("Leader logins")
    expect(html).not.toContain("/edit")
    expect(p.groupLeaderAccess.findMany).not.toHaveBeenCalled()
    expect(listAssignableOrganisers).not.toHaveBeenCalled()
  })

  it("archived group shows Restore and is read-only for managers", async () => {
    p.group.findUnique.mockResolvedValue({ ...group, archivedAt: new Date() })
    const html = renderToStaticMarkup(await GroupPage(params("4")))
    expect(html).toContain("Archived")
    expect(html).toContain("RestoreStub")
    expect(html).toContain('data-ro="true"')
    expect(html).not.toContain("/groups/4/edit")
    expect(listAssignableOrganisers).not.toHaveBeenCalled()
  })
})

describe("/groups/[id]/edit and /groups/new", () => {
  it("edit: non-managers go to the list; bad id, missing or archived 404", async () => {
    as("VIEWER")
    await expect(EditGroupPage(params("4"))).rejects.toThrow("NEXT_REDIRECT /groups")
    as("ADMIN")
    await expect(EditGroupPage(params("abc"))).rejects.toThrow("NEXT_NOT_FOUND")
    p.group.findUnique.mockResolvedValue(null)
    await expect(EditGroupPage(params("4"))).rejects.toThrow("NEXT_NOT_FOUND")
    p.group.findUnique.mockResolvedValue({ ...group, archivedAt: new Date() })
    await expect(EditGroupPage(params("4"))).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("edit: renders the form and archive button for a live group", async () => {
    const html = renderToStaticMarkup(await EditGroupPage(params("4")))
    expect(html).toContain("edit Choir")
    expect(html).toContain("ArchiveStub")
  })

  it("new: managers only", async () => {
    expect(renderToStaticMarkup(await NewGroupPage())).toContain("create form")
    as("VIEWER")
    await expect(NewGroupPage()).rejects.toThrow("NEXT_REDIRECT /groups")
    as()
    await expect(NewGroupPage()).rejects.toThrow("NEXT_REDIRECT /groups")
  })
})
