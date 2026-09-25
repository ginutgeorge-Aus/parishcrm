// The Turnstile site key is read once at module scope (in useRegistrationForm),
// so this scenario lives in its own file with the env set BEFORE the component
// loads — same pattern as TurnstileWidget.configured.test.tsx.
process.env.TURNSTILE_SITE_KEY = "test-site-key"

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock("@/lib/actions/eventCheckout", () => ({ startEventCheckout: jest.fn() }))

const { render, screen, act } = require("@testing-library/react")
const { RegistrationForm } = require("@/components/public-event/RegistrationForm")
const { TURNSTILE_LOAD_TIMEOUT_MS, TURNSTILE_LOAD_FAILED_MESSAGE } = require("@/components/public/TurnstileWidget")

const baseProps = {
  slug: "test-event",
  ticketTypes: [{ id: 1, name: "General", price: 0, capacity: null }],
  soldCounts: {},
  customQuestions: [],
  allSoldOut: false,
  formToken: "tok",
}

afterEach(() => {
  delete (globalThis as unknown as { turnstile?: unknown }).turnstile
})

describe("RegistrationForm Turnstile load-failure fallback", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it("shows the fallback message once the load timeout elapses with no widget mounted", () => {
    render(<RegistrationForm {...baseProps} />)
    expect(screen.queryByText(TURNSTILE_LOAD_FAILED_MESSAGE)).toBeNull()

    act(() => { jest.advanceTimersByTime(TURNSTILE_LOAD_TIMEOUT_MS) })

    expect(screen.getByRole("alert")).toHaveTextContent(TURNSTILE_LOAD_FAILED_MESSAGE)
  })

  it("names the configured church email in the fallback message", () => {
    render(<RegistrationForm {...baseProps} churchEmail="office@demo.example.com" />)

    act(() => { jest.advanceTimersByTime(TURNSTILE_LOAD_TIMEOUT_MS) })

    expect(screen.getByRole("alert")).toHaveTextContent("contact your church administrator at office@demo.example.com.")
  })

  it("does not show the fallback once the widget mounts before the timeout", () => {
    (globalThis as unknown as { turnstile?: unknown }).turnstile = {
      render: () => "widget-1",
      remove: jest.fn(),
    }
    render(<RegistrationForm {...baseProps} />)

    act(() => { jest.advanceTimersByTime(TURNSTILE_LOAD_TIMEOUT_MS) })

    expect(screen.queryByText(TURNSTILE_LOAD_FAILED_MESSAGE)).toBeNull()
  })
})
