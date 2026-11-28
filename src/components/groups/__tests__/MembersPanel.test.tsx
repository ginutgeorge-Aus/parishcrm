import { fireEvent, render, screen, waitFor } from "@testing-library/react"

jest.mock("@/lib/actions/group", () => ({
  addGroupMember: jest.fn(),
  removeGroupMember: jest.fn(),
  searchGroupCandidates: jest.fn(),
  updateGroupMember: jest.fn(),
}))

import { removeGroupMember } from "@/lib/actions/group"
import { MembersPanel } from "@/components/groups/MembersPanel"

const remove = removeGroupMember as jest.Mock
const members = [{ personId: 5, name: "Sam Example", role: "MEMBER", title: "" }]

beforeEach(() => { jest.clearAllMocks(); remove.mockResolvedValue(undefined) })

describe("MembersPanel remove", () => {
  it("asks for confirmation before removing a member", async () => {
    render(<MembersPanel groupId={2} members={members as any} />)
    fireEvent.click(screen.getByRole("button", { name: "Remove" }))
    expect(remove).not.toHaveBeenCalled()
    expect(await screen.findByText("Remove Sam Example from this group?")).toBeInTheDocument()
    const confirm = screen.getAllByRole("button", { name: "Remove" }).at(-1)!
    fireEvent.click(confirm)
    await waitFor(() => expect(remove).toHaveBeenCalledWith(2, 5))
  })
})
