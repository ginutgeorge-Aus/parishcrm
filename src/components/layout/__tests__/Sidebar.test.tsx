import { render } from "@testing-library/react"
import { Sidebar } from "@/components/layout/Sidebar"

jest.mock("next/navigation", () => ({
  usePathname: () => "/",
}))

jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}))

jest.mock("@/lib/actions/session", () => ({
  logout: jest.fn(),
}))

// FeedbackDialog (rendered inside Sidebar) imports this server action, whose
// chain pulls in "@/auth" (next-auth ESM) — mock it out so this component
// test doesn't need to load that chain.
jest.mock("@/lib/actions/feedback", () => ({
  submitFeedback: jest.fn(),
}))

test("sidebar shows the configured church name / alt text", () => {
  const { container } = render(
    <Sidebar churchName="Demo Church" pendingUpdates={0} verifyPending={0} membershipPending={0} />,
  )
  expect(container.innerHTML).toContain("Demo Church")
  expect(container.innerHTML).not.toMatch(/Example Church/i)
})
