import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { LoginForm } from "@/components/auth/LoginForm"
import { signIn } from "next-auth/react"

jest.mock("next-auth/react", () => ({ signIn: jest.fn() }))
jest.mock("@/lib/actions/trustedDevice", () => ({ trustDevice: jest.fn() }))
const mockPush = jest.fn()
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))

const LOGINS = [
  { label: "Admin", email: "admin@demo.invalid" },
  { label: "Viewer", email: "viewer@demo.invalid" },
]

describe("LoginForm — demo logins", () => {
  beforeEach(() => jest.clearAllMocks())

  it("renders no demo buttons and keeps forgot-password by default", () => {
    render(<LoginForm churchName="Demo Church" />)
    expect(screen.queryByRole("button", { name: "Try as Admin" })).not.toBeInTheDocument()
    expect(screen.getByText("Forgot password?")).toBeInTheDocument()
  })

  it("signs in with mode=demo and hides forgot-password", async () => {
    ;(signIn as jest.Mock).mockResolvedValue({ ok: true })
    render(<LoginForm churchName="Demo Church" demoLogins={LOGINS} />)
    expect(screen.queryByText("Forgot password?")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Try as Viewer" }))
    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith("credentials", { email: "viewer@demo.invalid", mode: "demo", redirect: false }),
    )
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"))
  })

  it("shows an error when demo sign-in fails", async () => {
    ;(signIn as jest.Mock).mockResolvedValue({ ok: false, error: "CredentialsSignin" })
    render(<LoginForm churchName="Demo Church" demoLogins={LOGINS} />)
    fireEvent.click(screen.getByRole("button", { name: "Try as Admin" }))
    expect(await screen.findByText("Demo sign-in failed. Please try again.")).toBeInTheDocument()
  })
})
