import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { LoginForm } from "@/components/auth/LoginForm"
import { signIn } from "next-auth/react"
import { trustDevice } from "@/lib/actions/trustedDevice"

jest.mock("next-auth/react", () => ({ signIn: jest.fn() }))
jest.mock("@/lib/actions/passkey", () => ({ startPasskeyLogin: jest.fn() }))
jest.mock("@simplewebauthn/browser", () => ({ browserSupportsWebAuthn: jest.fn(() => false), startAuthentication: jest.fn() }))
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

  it("email fallback refused while backup codes exist explains why and stays on the authenticator step", async () => {
    await toTotpStep()
    mockSignIn.mockResolvedValueOnce({ code: "TotpRequiredBackup", error: "TotpRequiredBackup", ok: false })
    fireEvent.click(screen.getByRole("button", { name: "Send email code instead" }))
    // One notice only, and the untouched authenticator code is not marked invalid.
    expect(await screen.findAllByText(/Email codes are off while you have unused backup codes/)).toHaveLength(1)
    expect(screen.queryByRole("button", { name: "Send email code instead" })).not.toBeInTheDocument()
    expect(screen.getByLabelText("Authenticator code")).not.toHaveAttribute("aria-invalid")
  })

  it("OTP-step resend refused while backup codes exist moves to the authenticator step with the email button hidden", async () => {
    // Reach the OTP step via the email fallback (no backup codes at that point).
    await toTotpStep()
    mockSignIn.mockResolvedValueOnce({ code: "OtpSent", error: "OtpSent", ok: false })
    fireEvent.click(screen.getByRole("button", { name: "Send email code instead" }))
    await screen.findByLabelText("Verification code")
    // Backup codes were generated since: the resend is refused with TotpRequiredBackup.
    mockSignIn.mockResolvedValueOnce({ code: "TotpRequiredBackup", error: "TotpRequiredBackup", ok: false })
    fireEvent.click(screen.getByRole("button", { name: /resend/i }))
    await screen.findByLabelText("Authenticator code")
    expect(screen.getAllByText(/Email codes are off while you have unused backup codes/)).toHaveLength(1)
    expect(screen.getByLabelText("Authenticator code")).not.toHaveAttribute("aria-invalid")
    expect(screen.queryByRole("button", { name: "Send email code instead" })).not.toBeInTheDocument()
    expect(screen.queryByText("Failed to resend. Try again.")).not.toBeInTheDocument()
  })

  it("ignores a late resend reply after the user went Back from the OTP step", async () => {
    await toTotpStep()
    mockSignIn.mockResolvedValueOnce({ code: "OtpSent", error: "OtpSent", ok: false })
    fireEvent.click(screen.getByRole("button", { name: "Send email code instead" }))
    await screen.findByLabelText("Verification code")
    let settle!: (v: unknown) => void
    mockSignIn.mockReturnValueOnce(new Promise((r) => { settle = r }))
    fireEvent.click(screen.getByRole("button", { name: /resend/i }))
    fireEvent.click(screen.getByRole("button", { name: "Back to password step" }))
    await screen.findByLabelText("Password")
    await act(async () => { settle({ code: "TotpRequiredBackup", error: "TotpRequiredBackup", ok: false }) })
    expect(screen.getByLabelText("Password")).toBeInTheDocument()
    expect(screen.queryByLabelText("Authenticator code")).not.toBeInTheDocument()
  })

  it("hides the email-code button and explains why when backup codes exist", async () => {
    mockSignIn.mockResolvedValueOnce({ code: "TotpRequiredBackup", error: "TotpRequiredBackup", ok: false })
    render(<LoginForm churchName="Demo Church" />)
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.com" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    await screen.findByLabelText("Authenticator code")
    expect(screen.queryByRole("button", { name: "Send email code instead" })).not.toBeInTheDocument()
    expect(screen.getByText(/Email codes are off while you have unused backup codes/)).toBeInTheDocument()
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
