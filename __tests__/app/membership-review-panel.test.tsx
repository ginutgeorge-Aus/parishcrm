import { render, screen, fireEvent, within, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ReviewPanel } from "@/app/(dashboard)/memberships/[id]/ReviewPanel"
import { approveMembershipApplication } from "@/lib/actions/membership"

const push = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: jest.fn() }) }))
jest.mock("@/lib/actions/membership", () => ({
  approveMembershipApplication: jest.fn(),
  rejectMembershipApplication: jest.fn(),
}))

it("labels the rejection-reason textarea for screen readers", () => {
  render(<ReviewPanel applicationId={1} matches={[]} incoming={[]} status="PENDING" />)
  fireEvent.click(screen.getByRole("button", { name: "Reject" }))
  expect(screen.getByLabelText("Rejection reason")).toHaveProperty("tagName", "TEXTAREA")
})

// AUD-9-02: merge needs a visible target + confirmation before the action runs.
const matches = [{ familyId: 7, familyName: "O'Brien", reason: "email" as const, memberCount: 3 }]
const incoming = [
  { name: "John Miller", role: "Head" },
  { name: "Mary Miller", role: "Spouse" },
]

beforeEach(() => {
  jest.clearAllMocks()
  ;(approveMembershipApplication as jest.Mock).mockResolvedValue({ success: "Application approved", familyId: 7 })
})

function renderPanel() {
  return render(<ReviewPanel applicationId={1} matches={matches} incoming={incoming} status="PENDING" />)
}

it("links the family name to its page in a new tab and shows the member count", () => {
  renderPanel()
  const link = screen.getByRole("link", { name: /O'Brien/ })
  expect(link).toHaveAttribute("href", "/families/7")
  expect(link).toHaveAttribute("target", "_blank")
  expect(screen.getByText(/3 members/)).toBeInTheDocument()
})

it("asks for confirmation naming the family and the people, without calling the action", async () => {
  const user = userEvent.setup()
  renderPanel()
  await user.click(screen.getByRole("button", { name: "Merge into this family" }))
  const dialog = await screen.findByRole("alertdialog")
  expect(dialog).toHaveTextContent("O'Brien")
  expect(dialog).toHaveTextContent("John Miller")
  expect(dialog).toHaveTextContent("Mary Miller")
  expect(approveMembershipApplication).not.toHaveBeenCalled()
})

it("calls the merge action only after confirm, then goes to the family page", async () => {
  const user = userEvent.setup()
  renderPanel()
  await user.click(screen.getByRole("button", { name: "Merge into this family" }))
  const dialog = await screen.findByRole("alertdialog")
  await user.click(within(dialog).getByRole("button", { name: "Merge" }))
  await waitFor(() => expect(approveMembershipApplication).toHaveBeenCalledWith(1, { mode: "merge", familyId: 7 }))
  await waitFor(() => expect(push).toHaveBeenCalledWith("/families/7"))
})

it("cancel does not call the action", async () => {
  const user = userEvent.setup()
  renderPanel()
  await user.click(screen.getByRole("button", { name: "Merge into this family" }))
  const dialog = await screen.findByRole("alertdialog")
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
  expect(approveMembershipApplication).not.toHaveBeenCalled()
})
