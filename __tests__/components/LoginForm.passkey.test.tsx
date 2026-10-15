import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { LoginForm } from "@/components/auth/LoginForm"
import { signIn } from "next-auth/react"
import { startPasskeyLogin } from "@/lib/actions/passkey"
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser"

jest.mock("next-auth/react", () => ({ signIn: jest.fn() }))
jest.mock("@/lib/actions/trustedDevice", () => ({ trustDevice: jest.fn().mockResolvedValue({ success: true }) }))
jest.mock("@/lib/actions/passkey", () => ({ startPasskeyLogin: jest.fn() }))
jest.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: jest.fn(() => true),
  startAuthentication: jest.fn(),
}))
const mockPush = jest.fn()
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))

const mockSignIn = signIn as jest.Mock
const mockStart = startPasskeyLogin as jest.Mock
const mockAuthn = startAuthentication as jest.Mock

async function clickPasskey() {
  render(<LoginForm churchName="Demo Church" />)
  const btn = await screen.findByRole("button", { name: "Sign in with a passkey" })
  await act(async () => { fireEvent.click(btn) })
}

describe("LoginForm — passkey", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(browserSupportsWebAuthn as jest.Mock).mockReturnValue(true)
    mockStart.mockResolvedValue({ challengeId: "ch1", options: { challenge: "c" } })
    mockAuthn.mockResolvedValue({ id: "cred-1" })
  })

  it("hides the button when the browser has no WebAuthn", () => {
    ;(browserSupportsWebAuthn as jest.Mock).mockReturnValue(false)
    render(<LoginForm churchName="Demo Church" />)
    expect(screen.queryByRole("button", { name: "Sign in with a passkey" })).not.toBeInTheDocument()
  })

  it("runs the ceremony and signs in with the assertion, honouring remember", async () => {
    mockSignIn.mockResolvedValue({ ok: true })
    await clickPasskey()
    expect(mockAuthn).toHaveBeenCalledWith({ optionsJSON: { challenge: "c" } })
    expect(mockSignIn).toHaveBeenCalledWith("credentials", {
      email: "passkey", mode: "passkey", challengeId: "ch1",
      assertion: JSON.stringify({ id: "cred-1" }), remember: "true", redirect: false,
    })
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"))
  })

  it("shows the server's start error", async () => {
    mockStart.mockResolvedValue({ error: "Too many attempts. Try again shortly." })
    await clickPasskey()
    expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts. Try again shortly.")
    expect(mockAuthn).not.toHaveBeenCalled()
  })

  it("reports a cancelled prompt", async () => {
    mockAuthn.mockRejectedValue(Object.assign(new Error("x"), { name: "NotAllowedError" }))
    await clickPasskey()
    expect(screen.getByRole("alert")).toHaveTextContent("Passkey sign-in was cancelled.")
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it("reports an unrecognised passkey", async () => {
    mockSignIn.mockResolvedValue({ error: "CredentialsSignin", ok: false })
    await clickPasskey()
    expect(screen.getByRole("alert")).toHaveTextContent("Passkey not recognised. Use your password instead.")
    expect(mockPush).not.toHaveBeenCalled()
  })

  it("reports a locked account", async () => {
    mockSignIn.mockResolvedValue({ code: "AccountLocked", error: "CredentialsSignin", ok: false })
    await clickPasskey()
    expect(screen.getByRole("alert")).toHaveTextContent(/Account locked/)
  })
})
