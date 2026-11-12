import { render, screen } from "@testing-library/react"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    group: { findMany: jest.fn(), findUnique: jest.fn() },
    groupLeaderAccess: { findMany: jest.fn().mockResolvedValue([]) },
  },
}))
jest.mock("@/lib/groupMembers", () => ({ loadMemberRows: jest.fn() }))
jest.mock("@/lib/actions/eventAccess", () => ({ listAssignableOrganisers: jest.fn().mockResolvedValue([]) }))
jest.mock("@/components/groups/MembersPanel", () => ({
  MembersPanel: ({ members, readOnly }: { members: { name: string }[]; readOnly: boolean }) => (
    <ul data-testid="members" data-readonly={String(readOnly)}>
      {members.map((m) => <li key={m.name}>{m.name}</li>)}
    </ul>
  ),
}))
jest.mock("@/components/groups/LeaderAccessPanel", () => ({ LeaderAccessPanel: () => <div>leader-panel</div> }))
jest.mock("@/components/groups/ArchiveGroupButton", () => ({ RestoreGroupButton: () => <button>restore</button> }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { loadMemberRows } from "@/lib/groupMembers"
import GroupsPage from "../page"
import GroupPage from "../[id]/page"

const mockAuth = auth as unknown as jest.Mock
const db = prisma as unknown as { group: { findMany: jest.Mock; findUnique: jest.Mock } }
const mockMembers = loadMemberRows as jest.Mock

const listProps = (sp: Record<string, string> = {}) => ({ searchParams: Promise.resolve(sp) })
const detailProps = (id: string) => ({ params: Promise.resolve({ id }) })
const asRole = (role: string) => mockAuth.mockResolvedValue({ user: { id: "1", role } })

beforeEach(() => {
  jest.clearAllMocks()
  asRole("VIEWER")
})

describe("/groups list page", () => {
  it("redirects to /login without a session", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(GroupsPage(listProps())).rejects.toThrow("REDIRECT")
    expect(db.group.findMany).not.toHaveBeenCalled()
  })

  it.each(["AUDITOR", "EVENT_ORGANISER"])("redirects %s without querying", async (role) => {
    asRole(role)
    await expect(GroupsPage(listProps())).rejects.toThrow("REDIRECT")
    expect(db.group.findMany).not.toHaveBeenCalled()
  })

  it("lists groups with member counts and no create button for VIEWER", async () => {
    db.group.findMany.mockResolvedValue([
      { id: 1, name: "Choir", category: "MINISTRY", description: "", _count: { members: 3 } },
      { id: 2, name: "Youth", category: "FELLOWSHIP", description: "", _count: { members: 1 } },
    ])
    render(await GroupsPage(listProps()))
    expect(screen.getByText("Choir")).toBeInTheDocument()
    expect(screen.getByText("3 members")).toBeInTheDocument()
    expect(screen.getByText("1 member")).toBeInTheDocument()
    expect(screen.queryByText("New group")).not.toBeInTheDocument()
  })

  it("applies the category filter and ignores an invalid one", async () => {
    db.group.findMany.mockResolvedValue([])
    render(await GroupsPage(listProps({ category: "COMMITTEE" })))
    expect(db.group.findMany.mock.calls[0][0].where).toEqual({ archivedAt: null, category: "COMMITTEE" })

    db.group.findMany.mockClear()
    render(await GroupsPage(listProps({ category: "bogus" })))
    expect(db.group.findMany.mock.calls[0][0].where).toEqual({ archivedAt: null })
  })

  it("shows the New group button to managers", async () => {
    asRole("ADMIN")
    db.group.findMany.mockResolvedValue([])
    render(await GroupsPage(listProps()))
    expect(screen.getAllByText("New group").length).toBeGreaterThan(0)
  })
})

describe("/groups/[id] page", () => {
  const group = { id: 5, name: "Choir", category: "MINISTRY", description: "Sings", archivedAt: null }

  it("redirects roles that cannot view groups", async () => {
    asRole("AUDITOR")
    await expect(GroupPage(detailProps("5"))).rejects.toThrow("REDIRECT")
    expect(db.group.findUnique).not.toHaveBeenCalled()
  })

  it("404s on an invalid id and on a missing group", async () => {
    await expect(GroupPage(detailProps("abc"))).rejects.toThrow("NOT_FOUND")
    expect(db.group.findUnique).not.toHaveBeenCalled()
    db.group.findUnique.mockResolvedValue(null)
    await expect(GroupPage(detailProps("5"))).rejects.toThrow("NOT_FOUND")
  })

  it("renders members read-only for VIEWER, without leader logins or edit", async () => {
    db.group.findUnique.mockResolvedValue(group)
    mockMembers.mockResolvedValue([{ personId: 1, name: "Ann Lee", familyName: "Lee", role: "LEADER", title: "" }])
    render(await GroupPage(detailProps("5")))
    expect(screen.getByText("Members (1)")).toBeInTheDocument()
    expect(screen.getByText("Ann Lee")).toBeInTheDocument()
    expect(screen.getByTestId("members")).toHaveAttribute("data-readonly", "true")
    expect(screen.queryByText("leader-panel")).not.toBeInTheDocument()
    expect(screen.queryByText("Edit")).not.toBeInTheDocument()
    expect(screen.queryByText("Export CSV")).not.toBeInTheDocument()
  })

  it("makes the panel editable and shows leader logins for managers", async () => {
    asRole("ADMIN")
    db.group.findUnique.mockResolvedValue(group)
    mockMembers.mockResolvedValue([])
    render(await GroupPage(detailProps("5")))
    expect(screen.getByTestId("members")).toHaveAttribute("data-readonly", "false")
    expect(screen.getByText("leader-panel")).toBeInTheDocument()
    expect(screen.getByText("Edit")).toBeInTheDocument()
  })

  it("keeps archived groups read-only even for managers", async () => {
    asRole("ADMIN")
    db.group.findUnique.mockResolvedValue({ ...group, archivedAt: new Date() })
    mockMembers.mockResolvedValue([])
    render(await GroupPage(detailProps("5")))
    expect(screen.getByTestId("members")).toHaveAttribute("data-readonly", "true")
    expect(screen.getByText("Archived")).toBeInTheDocument()
    expect(screen.queryByText("Edit")).not.toBeInTheDocument()
  })
})
