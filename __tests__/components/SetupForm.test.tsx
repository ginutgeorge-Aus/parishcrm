import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SetupForm } from "@/components/auth/SetupForm"
import { createFirstAdmin } from "@/lib/actions/setup"

jest.mock("@/lib/actions/setup", () => ({ createFirstAdmin: jest.fn() }))

const mockPush = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }))

function fill(password = "Str0ng!pass", confirm = password) {
  fireEvent.change(screen.getByLabelText("Setup token"), { target: { value: "t".repeat(32) } })
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Demo Admin" } })
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.com" } })
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } })
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: confirm } })
  fireEvent.click(screen.getByRole("button", { name: "Create administrator" }))
}

describe("SetupForm", () => {
  beforeEach(() => jest.clearAllMocks())

  it("rejects mismatched passwords without calling the action", async () => {
    render(<SetupForm />)
    fill("Str0ng!pass", "Different1!")
    await waitFor(() => expect(screen.getByText("Passwords do not match.")).toBeInTheDocument())
    expect(createFirstAdmin).not.toHaveBeenCalled()
  })

  it("redirects to login with the setup flag on success", async () => {
    ;(createFirstAdmin as jest.Mock).mockResolvedValue({ success: true })
    render(<SetupForm />)
    fill()
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login?setup=1"))
    const fd = (createFirstAdmin as jest.Mock).mock.calls[0][0] as FormData
    expect(fd.get("email")).toBe("admin@example.com")
  })

  it("shows the action's error", async () => {
    ;(createFirstAdmin as jest.Mock).mockResolvedValue({ error: "Setup is not available." })
    render(<SetupForm />)
    fill()
    await waitFor(() => expect(screen.getByText("Setup is not available.")).toBeInTheDocument())
    expect(mockPush).not.toHaveBeenCalled()
  })

  it("shows a generic error when the action throws", async () => {
    ;(createFirstAdmin as jest.Mock).mockRejectedValue(new Error("boom"))
    render(<SetupForm />)
    fill()
    await waitFor(() =>
      expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument()
    )
  })
})
