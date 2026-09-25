// The Turnstile site key is read once at module scope, so this scenario lives in
// its own file with the env set BEFORE the component loads. ES `import` is
// hoisted above assignments, so we require() the component after setting env
// (single module registry → single React copy, no isolateModules trap).
process.env.TURNSTILE_SITE_KEY = "test-site-key"

jest.mock("@/components/NonceProvider", () => ({ useNonce: () => undefined }))

const { render, screen, act } = require("@testing-library/react")
const {
  TurnstileWidget,
  TURNSTILE_LOAD_TIMEOUT_MS,
  TURNSTILE_LOAD_FAILED_MESSAGE,
} = require("@/components/public/TurnstileWidget")

afterEach(() => {
  delete (globalThis as unknown as { turnstile?: unknown }).turnstile
})

it("renders the widget, forwards the solved token, and removes it on unmount", () => {
  const remove = jest.fn()
  let solve: ((t: string) => void) | undefined
  ;(globalThis as unknown as { turnstile?: unknown }).turnstile = {
    render: (_el: HTMLElement, opts: { callback: (t: string) => void }) => {
      solve = opts.callback
      return "widget-1"
    },
    remove,
  }

  const onToken = jest.fn()
  const { container, unmount } = render(<TurnstileWidget onToken={onToken} />)

  expect(container.querySelector(".cf-turnstile")).toBeInTheDocument()

  solve?.("solved-token")
  expect(onToken).toHaveBeenCalledWith("solved-token")

  unmount()
  expect(remove).toHaveBeenCalledWith("widget-1")
})

describe("load-failure fallback", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it("shows the fallback message once the load timeout elapses with no widget mounted", () => {
    // No window.turnstile ever appears (ad-blocker/firewall/tracking protection
    // blocked the script) — the "load" event on the injected <script> never fires.
    render(<TurnstileWidget onToken={jest.fn()} />)
    expect(screen.queryByText(TURNSTILE_LOAD_FAILED_MESSAGE)).toBeNull()

    act(() => { jest.advanceTimersByTime(TURNSTILE_LOAD_TIMEOUT_MS) })

    expect(screen.getByRole("alert")).toHaveTextContent(TURNSTILE_LOAD_FAILED_MESSAGE)
  })

  it("does not show the fallback once the widget mounts before the timeout", () => {
    (globalThis as unknown as { turnstile?: unknown }).turnstile = {
      render: () => "widget-2",
      remove: jest.fn(),
    }
    render(<TurnstileWidget onToken={jest.fn()} />)

    act(() => { jest.advanceTimersByTime(TURNSTILE_LOAD_TIMEOUT_MS) })

    expect(screen.queryByText(TURNSTILE_LOAD_FAILED_MESSAGE)).toBeNull()
  })
})
