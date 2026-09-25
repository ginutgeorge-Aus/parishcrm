import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { LoginForm } from "@/components/auth/LoginForm"
import { signIn } from "next-auth/react"
import { trustDevice } from "@/lib/actions/trustedDevice"

jest.mock("next-auth/react", () => ({
  signIn: jest.fn(),
}))

jest.mock("@/lib/actions/trustedDevice", () => ({ trustDevice: jest.fn().mockResolvedValue({ success: true }) }))

const mockPush = jest.fn()
const mockRefresh = jest.fn()
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useSearchParams: () => ({ get: () => null }),
}))

describe("LoginForm — OTP step AccountLocked handling", () => {
  beforeEach(() => jest.clearAllMocks())

  it("shows lockout message (not invalid-code message) when OTP submission returns AccountLocked", async () => {
    const mockSignIn = signIn as jest.Mock
    // Password step → OTP sent
    mockSignIn.mockResolvedValueOnce({ code: "OtpSent", error: "OtpSent", ok: false })
    // OTP step → account locked
    mockSignIn.mockResolvedValueOnce({ code: "AccountLocked", error: "AccountLocked", ok: false })

    render(<LoginForm churchName="Demo Church" />)

    // Submit password step
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.com" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correctpassword" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))

    // Wait for OTP step
    await waitFor(() => expect(screen.getByLabelText("Verification code")).toBeInTheDocument())

    // Submit OTP
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: "Verify" }))

    // Should show lockout message, not "Invalid or expired code."
    await waitFor(() =>
      expect(screen.getByText(/Account locked after too many failed attempts/)).toBeInTheDocument()
    )
    expect(screen.queryByText("Invalid or expired code.")).not.toBeInTheDocument()
  })

  it("shows invalid-code message when OTP is wrong", async () => {
    const mockSignIn = signIn as jest.Mock
    mockSignIn.mockResolvedValueOnce({ code: "OtpSent", error: "OtpSent", ok: false })
    mockSignIn.mockResolvedValueOnce({ code: "CredentialsSignin", error: "CredentialsSignin", ok: false })

    render(<LoginForm churchName="Demo Church" />)

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.com" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correctpassword" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))

    await waitFor(() => expect(screen.getByLabelText("Verification code")).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "999999" } })
    fireEvent.click(screen.getByRole("button", { name: "Verify" }))

    await waitFor(() =>
      expect(screen.getByText("Invalid or expired code.")).toBeInTheDocument()
    )
  })
})

describe("LoginForm — password step", () => {
  beforeEach(() => jest.clearAllMocks())

  const submitPassword = () => {
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.com" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correctpassword" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
  }

  it("transitions to the OTP step when password submit returns OtpSent", async () => {
    ;(signIn as jest.Mock).mockResolvedValueOnce({ code: "OtpSent", error: "OtpSent", ok: false })
    render(<LoginForm churchName="Demo Church" />)
    submitPassword()
    await waitFor(() => expect(screen.getByLabelText("Verification code")).toBeInTheDocument())
    // No redirect yet — OTP still pending
    expect(mockPush).not.toHaveBeenCalled()
  })

  it("shows the lockout message when password submit returns AccountLocked", async () => {
    ;(signIn as jest.Mock).mockResolvedValueOnce({ code: "AccountLocked", error: "AccountLocked", ok: false })
    render(<LoginForm churchName="Demo Church" />)
    submitPassword()
    await waitFor(() =>
      expect(screen.getByText(/Account locked after too many failed attempts/)).toBeInTheDocument()
    )
    // Stays on the password step
    expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument()
  })

  // after AccountLocked the submit button must stay disabled with a live
  // countdown instead of re-enabling and inviting futile retries.
  it("disables submit with a countdown after AccountLocked", async () => {
    ;(signIn as jest.Mock).mockResolvedValueOnce({ code: "AccountLocked", error: "AccountLocked", ok: false })
    render(<LoginForm churchName="Demo Church" />)
    submitPassword()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Locked · \d+:\d\d/ })).toBeDisabled()
    )
  })

  it("shows 'Invalid email or password' on a generic credentials error", async () => {
    ;(signIn as jest.Mock).mockResolvedValueOnce({ error: "CredentialsSignin", ok: false })
    render(<LoginForm churchName="Demo Church" />)
    submitPassword()
    await waitFor(() => expect(screen.getByText("Invalid email or password")).toBeInTheDocument())
  })

  it("redirects home when password submit succeeds without OTP", async () => {
    ;(signIn as jest.Mock).mockResolvedValueOnce({ ok: true })
    render(<LoginForm churchName="Demo Church" />)
    submitPassword()
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"))
    expect(mockRefresh).toHaveBeenCalled()
  })

  // a transport-level rejection (network drop / DNS / 5xx) rejects the
  // signIn promise before it can resolve to a {code}/{error} object. Without a
  // try/catch the button was left stuck on "Signing in…" with no feedback.
  it("surfaces a retry message and re-enables the button when sign-in throws", async () => {
    ;(signIn as jest.Mock).mockRejectedValueOnce(new Error("network down"))
    render(<LoginForm churchName="Demo Church" />)
    submitPassword()
    await waitFor(() =>
      expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument()
    )
    // Not stuck disabled on "Signing in…"
    const button = screen.getByRole("button", { name: "Sign in" })
    expect(button).not.toBeDisabled()
  })
})

describe("LoginForm — OTP step navigation & resend", () => {
  beforeEach(() => jest.clearAllMocks())

  // Drive the form from password into the OTP step, leaving it ready for OTP actions.
  const enterOtpStep = async () => {
    ;(signIn as jest.Mock).mockResolvedValueOnce({ code: "OtpSent", error: "OtpSent", ok: false })
    render(<LoginForm churchName="Demo Church" />)
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.com" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correctpassword" } })
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    await waitFor(() => expect(screen.getByLabelText("Verification code")).toBeInTheDocument())
  }

  it("redirects home when the OTP submit succeeds", async () => {
    await enterOtpStep()
    ;(signIn as jest.Mock).mockResolvedValueOnce({ ok: true })
    fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: "Verify" }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"))
  })

  it("shows the cooldown message when resend returns OtpCooldown", async () => {
    await enterOtpStep()
    ;(signIn as jest.Mock).mockResolvedValueOnce({ code: "OtpCooldown", error: "OtpCooldown", ok: false })
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }))
    await waitFor(() =>
      expect(screen.getByText("Please wait 30 seconds before requesting a new code.")).toBeInTheDocument()
    )
  })

  it("confirms a new code was sent when resend returns OtpSent", async () => {
    await enterOtpStep()
    ;(signIn as jest.Mock).mockResolvedValueOnce({ code: "OtpSent", error: "OtpSent", ok: false })
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }))
    await waitFor(() => expect(screen.getByText("New code sent.")).toBeInTheDocument())
  })

  it("the back button returns to the password step", async () => {
    await enterOtpStep()
    fireEvent.click(screen.getByRole("button", { name: /Back/ }))
    await waitFor(() => expect(screen.getByLabelText("Password")).toBeInTheDocument())
    expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument()
  })
})

describe("LoginForm — remember this device", () => {
  beforeEach(() => jest.clearAllMocks())

  it("defaults the remember checkbox to checked and passes remember through password sign-in", async () => {
    ;(signIn as jest.Mock).mockResolvedValue({ code: "OtpSent" })
    render(<LoginForm churchName="Demo Church" />)
    const remember = screen.getByLabelText(/remember this device/i)
    expect(remember).toBeChecked()

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } })
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }))

    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith(
        "credentials",
        expect.objectContaining({ mode: "password", remember: "true" }),
      ),
    )
  })

  it("calls trustDevice after a successful OTP verify when remember is checked", async () => {
    ;(signIn as jest.Mock)
      .mockResolvedValueOnce({ code: "OtpSent" }) // password step
      .mockResolvedValueOnce({ ok: true })         // otp step
    render(<LoginForm churchName="Demo Church" />)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } })
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }))

    await screen.findByLabelText(/verification code/i)
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: /verify/i }))

    await waitFor(() => expect(trustDevice).toHaveBeenCalled())
  })
})

describe("LoginForm — church identity", () => {
  beforeEach(() => jest.clearAllMocks())

  it("renders the configured church name as the sr-only heading, not a hardcoded one", () => {
    render(<LoginForm churchName="Demo Church" />)
    const heading = screen.getByRole("heading", { level: 1 })
    expect(heading).toHaveTextContent("Demo Church")
    expect(screen.queryByText(/Example Church/i)).not.toBeInTheDocument()
  })
})

describe("LoginForm — password show/hide toggle", () => {
  beforeEach(() => jest.clearAllMocks())

  it("flips the password input between password and text on toggle click", () => {
    render(<LoginForm churchName="Demo Church" />)
    const passwordInput = screen.getByLabelText("Password")
    expect(passwordInput).toHaveAttribute("type", "password")

    fireEvent.click(screen.getByRole("button", { name: "Show password" }))
    expect(passwordInput).toHaveAttribute("type", "text")

    fireEvent.click(screen.getByRole("button", { name: "Hide password" }))
    expect(passwordInput).toHaveAttribute("type", "password")
  })
})
