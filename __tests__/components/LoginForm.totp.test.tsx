import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { LoginForm } from "@/components/auth/LoginForm"
import { signIn } from "next-auth/react"
import { trustDevice } from "@/lib/actions/trustedDevice"

jest.mock("next-auth/react", () => ({ signIn: jest.fn() }))
jest.mock("@/lib/actions/trustedDevice", () => ({ trustDevice: jest.fn().mockResolvedValue({ success: true }) }))
const mockPush = jest.fn()
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))

const mockSignIn = signIn as jest.Mock

async function toTotpStep() {
  mockSignIn.mockResolvedValueOnce({ code: "TotpRequired", error: "TotpRequired", ok: false })
  render(<LoginForm churchName="Demo Church" />)
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.com" } })
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } })
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
  await screen.findByLabelText("Authenticator code")
}

describe("LoginForm — authenticator step", () => {
  beforeEach(() => jest.clearAllMocks())

  it("shows the authenticator step on TotpRequired and submits password + code", async () => {
    await toTotpStep()
    mockSignIn.mockResolvedValueOnce({ ok: true })
    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: "Verify" }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"))
    expect(mockSignIn).toHaveBeenLastCalledWith("credentials", expect.objectContaining({
      email: "admin@example.com", password: "pw", code: "123456", mode: "totp",
    }))
    expect(trustDevice).toHaveBeenCalled()
  })

  it("shows an error on a bad code", async () => {
    await toTotpStep()
    mockSignIn.mockResolvedValueOnce({ error: "CredentialsSignin", ok: false })
    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "000000" } })
    fireEvent.click(screen.getByRole("button", { name: "Verify" }))
    expect(await screen.findByText("Invalid code.")).toBeInTheDocument()
  })

  it("backup-code toggle relabels the input and accepts letters", async () => {
    await toTotpStep()
    fireEvent.click(screen.getByRole("button", { name: "Use a backup code" }))
    const input = screen.getByLabelText("Backup code")
    fireEvent.change(input, { target: { value: "ab3cd-ef4gh" } })
    expect((input as HTMLInputElement).value).toBe("AB3CD-EF4GH")
  })

  it("email fallback delivery failure shows an error and stays on the authenticator step", async () => {
    await toTotpStep()
    mockSignIn.mockResolvedValueOnce({ code: "OtpDeliveryFailed", error: "OtpDeliveryFailed", ok: false })
    fireEvent.click(screen.getByRole("button", { name: "Send email code instead" }))
    expect(await screen.findByText("We couldn't send your verification code. Please try again in a moment.")).toBeInTheDocument()
    expect(screen.getByLabelText("Authenticator code")).toBeInTheDocument()
  })

  it("email fallback requests an emailed code and moves to the OTP step", async () => {
    await toTotpStep()
    mockSignIn.mockResolvedValueOnce({ code: "OtpSent", error: "OtpSent", ok: false })
    fireEvent.click(screen.getByRole("button", { name: "Send email code instead" }))
    await screen.findByLabelText("Verification code")
    expect(mockSignIn).toHaveBeenLastCalledWith("credentials", expect.objectContaining({
      mode: "password", emailFallback: "true",
    }))
  })
})
