import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { LoginForm } from "@/components/auth/LoginForm"
import { signIn } from "next-auth/react"

jest.mock("next-auth/react", () => ({ signIn: jest.fn() }))
jest.mock("@/lib/actions/trustedDevice", () => ({ trustDevice: jest.fn().mockResolvedValue({ success: true }) }))

const mockPush = jest.fn()
let mockNext: string | null = null
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: jest.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === "next" ? mockNext : null) }),
}))

function fillAndSubmitPassword() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.com" } })
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correctpassword" } })
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
}

describe("LoginForm — ?next= deep link", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockNext = null
  })

  it("redirects to a valid next path after password login", async () => {
    mockNext = "/people/123?tab=notes"
    ;(signIn as jest.Mock).mockResolvedValueOnce({ ok: true })
    render(<LoginForm churchName="Demo Church" />)
    fillAndSubmitPassword()
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/people/123?tab=notes"))
  })

  it("redirects to next after the OTP step", async () => {
    mockNext = "/accounting"
    ;(signIn as jest.Mock)
      .mockResolvedValueOnce({ code: "OtpSent", error: "OtpSent", ok: false })
      .mockResolvedValueOnce({ ok: true })
    render(<LoginForm churchName="Demo Church" />)
    fillAndSubmitPassword()
    await waitFor(() => expect(screen.getByLabelText("Verification code")).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: "Verify" }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/accounting"))
  })

  it.each(["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)"])(
    "falls back to / for unsafe next %s",
    async (bad) => {
      mockNext = bad
      ;(signIn as jest.Mock).mockResolvedValueOnce({ ok: true })
      render(<LoginForm churchName="Demo Church" />)
      fillAndSubmitPassword()
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"))
    },
  )
})
