import { render, screen, fireEvent } from "@testing-library/react"
import { ReviewPanel } from "@/app/(dashboard)/memberships/[id]/ReviewPanel"

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))
jest.mock("@/lib/actions/membership", () => ({
  approveMembershipApplication: jest.fn(),
  rejectMembershipApplication: jest.fn(),
}))

it("labels the rejection-reason textarea for screen readers", () => {
  render(<ReviewPanel applicationId={1} matches={[]} status="PENDING" />)
  fireEvent.click(screen.getByRole("button", { name: "Reject" }))
  expect(screen.getByLabelText("Rejection reason")).toHaveProperty("tagName", "TEXTAREA")
})
