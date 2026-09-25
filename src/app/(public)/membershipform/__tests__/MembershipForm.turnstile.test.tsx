// The Turnstile site key is read once at module scope, so this scenario lives
// in its own file with the env set BEFORE the component loads — same pattern
// as TurnstileWidget.configured.test.tsx.
process.env.TURNSTILE_SITE_KEY = "test-site-key"

const submit = jest.fn().mockResolvedValue({ success: "ok" })
jest.mock("@/lib/actions/membership", () => ({ submitMembershipApplication: (...a: unknown[]) => submit(...a) }))
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }))

const { render, screen, act } = require("@testing-library/react")
const { MembershipForm } = require("../MembershipForm")
const { TURNSTILE_LOAD_TIMEOUT_MS, TURNSTILE_LOAD_FAILED_MESSAGE, turnstileLoadFailedMessage } = require("@/components/public/TurnstileWidget")

afterEach(() => {
  delete (globalThis as unknown as { turnstile?: unknown }).turnstile
})

describe("MembershipForm Turnstile load-failure fallback", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it("shows the fallback message once the load timeout elapses with no widget mounted", () => {
    render(<MembershipForm churchName="Demo Church" churchWebsite="https://demo.example.com" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)
    expect(screen.queryByText(TURNSTILE_LOAD_FAILED_MESSAGE)).toBeNull()

    act(() => { jest.advanceTimersByTime(TURNSTILE_LOAD_TIMEOUT_MS) })

    expect(screen.getByRole("alert")).toHaveTextContent(TURNSTILE_LOAD_FAILED_MESSAGE)
  })

  it("names the configured church email in the fallback message", () => {
    render(<MembershipForm churchName="Demo Church" churchWebsite="https://demo.example.com" churchEmail="office@demo.example.com" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)

    act(() => { jest.advanceTimersByTime(TURNSTILE_LOAD_TIMEOUT_MS) })

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Verification didn't load. Check your connection, disable tracking protection, or contact your church administrator at office@demo.example.com.",
    )
    expect(turnstileLoadFailedMessage("office@demo.example.com")).toContain("at office@demo.example.com.")
  })

  it("does not show the fallback once the widget mounts before the timeout", () => {
    (globalThis as unknown as { turnstile?: unknown }).turnstile = {
      render: () => undefined,
      remove: jest.fn(),
    }
    render(<MembershipForm churchName="Demo Church" churchWebsite="https://demo.example.com" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)

    act(() => { jest.advanceTimersByTime(TURNSTILE_LOAD_TIMEOUT_MS) })

    expect(screen.queryByText(TURNSTILE_LOAD_FAILED_MESSAGE)).toBeNull()
  })
})
