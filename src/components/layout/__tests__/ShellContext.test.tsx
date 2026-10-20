import { act, render, screen } from "@testing-library/react"
import { ShellProvider, useShell } from "../ShellContext"

/** Exposes the drawer state and an opener for the assertions. */
function Probe() {
  const { mobileOpen, setMobileOpen } = useShell()
  return (
    <button type="button" onClick={() => setMobileOpen(true)}>
      {mobileOpen ? "open" : "closed"}
    </button>
  )
}

describe("ShellProvider", () => {
  let listener: ((e: { matches: boolean }) => void) | null = null
  const original = window.matchMedia

  beforeEach(() => {
    listener = null
    window.matchMedia = jest.fn().mockReturnValue({
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => { listener = fn },
      removeEventListener: jest.fn(),
    }) as unknown as typeof window.matchMedia
  })

  afterEach(() => { window.matchMedia = original })

  it("closes the drawer when the viewport widens past md", () => {
    render(<ShellProvider><Probe /></ShellProvider>)
    act(() => screen.getByRole("button").click())
    expect(screen.getByRole("button")).toHaveTextContent("open")

    act(() => listener?.({ matches: false }))
    expect(screen.getByRole("button")).toHaveTextContent("open")

    act(() => listener?.({ matches: true }))
    expect(screen.getByRole("button")).toHaveTextContent("closed")
  })

  it("throws when used outside the provider", () => {
    jest.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow("useShell must be used within ShellProvider")
  })
})
