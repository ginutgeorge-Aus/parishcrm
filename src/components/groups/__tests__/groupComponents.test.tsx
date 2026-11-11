import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const push = jest.fn()
const refresh = jest.fn()
const back = jest.fn()
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, back }),
  unstable_rethrow: jest.fn(),
}))
jest.mock("@/lib/actions/group", () => ({
  archiveGroup: jest.fn(),
  restoreGroup: jest.fn(),
  addGroupMember: jest.fn(),
  removeGroupMember: jest.fn(),
  updateGroupMember: jest.fn(),
  searchGroupCandidates: jest.fn(),
  addGroupLeaderAccess: jest.fn(),
  removeGroupLeaderAccess: jest.fn(),
}))

import { ArchiveGroupButton, RestoreGroupButton } from "@/components/groups/ArchiveGroupButton"
import { GroupForm } from "@/components/groups/GroupForm"
import { LeaderAccessPanel } from "@/components/groups/LeaderAccessPanel"
import { MembersPanel } from "@/components/groups/MembersPanel"
import * as actions from "@/lib/actions/group"

const a = actions as unknown as Record<string, jest.Mock>

beforeEach(() => {
  jest.clearAllMocks()
})

describe("ArchiveGroupButton", () => {
  it("archives after confirm and returns to the list", async () => {
    a.archiveGroup.mockResolvedValue(undefined)
    render(<ArchiveGroupButton groupId={4} />)
    await userEvent.click(screen.getByRole("button", { name: "Archive group" }))
    await userEvent.click(await screen.findByRole("button", { name: "Archive" }))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/groups"))
    expect(a.archiveGroup).toHaveBeenCalledWith(4)
  })

  it("stays put when the action errors", async () => {
    a.archiveGroup.mockResolvedValue({ error: "Group not found" })
    render(<ArchiveGroupButton groupId={4} />)
    await userEvent.click(screen.getByRole("button", { name: "Archive group" }))
    await userEvent.click(await screen.findByRole("button", { name: "Archive" }))
    expect(await screen.findByText("Group not found")).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })
})

describe("RestoreGroupButton", () => {
  it("refreshes on success", async () => {
    a.restoreGroup.mockResolvedValue(undefined)
    render(<RestoreGroupButton groupId={4} />)
    await userEvent.click(screen.getByRole("button", { name: "Restore group" }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("shows the action error", async () => {
    a.restoreGroup.mockResolvedValue({ error: "Group not found" })
    render(<RestoreGroupButton groupId={4} />)
    await userEvent.click(screen.getByRole("button", { name: "Restore group" }))
    expect(await screen.findByText("Group not found")).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it("shows a generic message when the action throws", async () => {
    a.restoreGroup.mockRejectedValue(new Error("boom"))
    render(<RestoreGroupButton groupId={4} />)
    await userEvent.click(screen.getByRole("button", { name: "Restore group" }))
    expect(await screen.findByText("Could not restore. Please try again.")).toBeInTheDocument()
  })
})

describe("GroupForm", () => {
  it("renders create mode, submits to the action and shows its error", async () => {
    const action = jest.fn().mockResolvedValue({ error: "A group with this name already exists" })
    render(<GroupForm action={action} />)
    expect(screen.getByRole("button", { name: "Create group" })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText("Name"), "Choir")
    await userEvent.click(screen.getByRole("button", { name: "Create group" }))
    expect(await screen.findByText("A group with this name already exists")).toBeInTheDocument()
    expect(action).toHaveBeenCalled()
    const fd = action.mock.calls[0][1] as FormData
    expect(fd.get("name")).toBe("Choir")
    expect(fd.get("category")).toBe("MINISTRY")
  })

  it("prefills edit mode and Cancel goes back", async () => {
    render(<GroupForm action={jest.fn()} group={{ name: "Youth", category: "COMMITTEE", description: "Fri" }} />)
    expect(screen.getByLabelText("Name")).toHaveValue("Youth")
    expect(screen.getByLabelText("Category")).toHaveValue("COMMITTEE")
    expect(screen.getByLabelText(/Description/)).toHaveValue("Fri")
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(back).toHaveBeenCalled()
  })
})

describe("LeaderAccessPanel", () => {
  const linked = [
    { id: 1, name: "Liz", email: "liz@example.com", active: true },
    { id: 2, name: "Old", email: "old@example.com", active: false },
  ]

  it("removes a link and flags an inactive login", async () => {
    a.removeGroupLeaderAccess.mockResolvedValue(undefined)
    render(<LeaderAccessPanel groupId={4} linked={linked} assignable={[]} />)
    expect(screen.getByText(/no longer an Event organiser/)).toBeInTheDocument()
    expect(screen.getByText(/No unlinked Event organiser logins/)).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole("button", { name: "Remove" })[0])
    await waitFor(() => expect(a.removeGroupLeaderAccess).toHaveBeenCalledWith(4, 1))
  })

  it("surfaces an error and a thrown failure on remove", async () => {
    a.removeGroupLeaderAccess.mockResolvedValueOnce({ error: "Nope" })
    render(<LeaderAccessPanel groupId={4} linked={linked} assignable={[]} />)
    await userEvent.click(screen.getAllByRole("button", { name: "Remove" })[0])
    expect(await screen.findByText("Nope")).toBeInTheDocument()
    a.removeGroupLeaderAccess.mockRejectedValueOnce(new Error("x"))
    await userEvent.click(screen.getAllByRole("button", { name: "Remove" })[0])
    expect(await screen.findByText("Could not remove. Please try again.")).toBeInTheDocument()
  })

  it("shows the picker when assignable logins exist, hides it when read-only, keeps Remove", () => {
    const assignable = [{ id: 9, name: "New", email: "new@example.com" }]
    const { rerender } = render(<LeaderAccessPanel groupId={4} linked={[]} assignable={assignable} />)
    expect(screen.getByText("No leader logins linked.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled()
    rerender(<LeaderAccessPanel groupId={4} linked={linked} assignable={assignable} readOnly />)
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2)
  })
})

describe("MembersPanel", () => {
  const members = [
    { personId: 3, name: "Jo Doe", familyName: "Doe", role: "LEADER" as const, title: "Chair" },
    { personId: 5, name: "Al Roe", familyName: "Roe", role: "MEMBER" as const, title: "" },
  ]

  it("renders read-only rows with links and no controls", () => {
    render(<MembersPanel groupId={4} members={members} readOnly linkPeople />)
    expect(screen.getByRole("link", { name: "Jo Doe" })).toHaveAttribute("href", "/people/3")
    expect(screen.getByText("Leader")).toBeInTheDocument()
    expect(screen.getByText("Chair")).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("shows the empty notice", () => {
    render(<MembersPanel groupId={4} members={[]} />)
    expect(screen.getByText("No members yet.")).toBeInTheDocument()
  })

  it("saves a changed role/title and removes a member", async () => {
    a.updateGroupMember.mockResolvedValue(undefined)
    a.removeGroupMember.mockResolvedValue(undefined)
    render(<MembersPanel groupId={4} members={members} />)
    const save = screen.getAllByRole("button", { name: "Save" })[1]
    expect(save).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText("Role for Al Roe"), "LEADER")
    await userEvent.type(screen.getByLabelText("Title for Al Roe"), "Sec")
    await userEvent.click(save)
    await waitFor(() => expect(a.updateGroupMember).toHaveBeenCalledWith(4, 5, "LEADER", "Sec"))
    await userEvent.click(screen.getAllByRole("button", { name: "Remove" })[0])
    await waitFor(() => expect(a.removeGroupMember).toHaveBeenCalledWith(4, 3))
  })

  it("shows an action error and a thrown failure", async () => {
    a.removeGroupMember.mockResolvedValueOnce({ error: "Not a member of this group" })
    render(<MembersPanel groupId={4} members={members} />)
    await userEvent.click(screen.getAllByRole("button", { name: "Remove" })[0])
    expect(await screen.findByText("Not a member of this group")).toBeInTheDocument()
    a.removeGroupMember.mockRejectedValueOnce(new Error("x"))
    await userEvent.click(screen.getAllByRole("button", { name: "Remove" })[0])
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument()
  })

  it("searches, adds a result and drops it from the list", async () => {
    a.searchGroupCandidates.mockResolvedValue({ people: [{ id: 8, name: "Kim Lee", familyName: "Lee" }] })
    a.addGroupMember.mockResolvedValue(undefined)
    render(<MembersPanel groupId={4} members={members} />)
    const search = screen.getByRole("button", { name: "Search" })
    expect(search).toBeDisabled()
    await userEvent.type(screen.getByLabelText("Search people to add"), "kim")
    await userEvent.click(search)
    expect(await screen.findByText("Kim Lee")).toBeInTheDocument()
    expect(a.searchGroupCandidates).toHaveBeenCalledWith(4, "kim")
    await userEvent.click(screen.getByRole("button", { name: "Add" }))
    await waitFor(() => expect(a.addGroupMember).toHaveBeenCalledWith(4, 8))
    await waitFor(() => expect(screen.queryByText("Kim Lee")).not.toBeInTheDocument())
    expect(screen.getByText(/No matching people/)).toBeInTheDocument()
  })

  it("shows search errors", async () => {
    a.searchGroupCandidates.mockResolvedValueOnce({ error: "Unauthorized" })
    render(<MembersPanel groupId={4} members={members} />)
    await userEvent.type(screen.getByLabelText("Search people to add"), "kim")
    await userEvent.click(screen.getByRole("button", { name: "Search" }))
    expect(await screen.findByText("Unauthorized")).toBeInTheDocument()
    a.searchGroupCandidates.mockRejectedValueOnce(new Error("x"))
    await userEvent.click(screen.getByRole("button", { name: "Search" }))
    expect(await screen.findByText("Search failed. Please try again.")).toBeInTheDocument()
  })
})
