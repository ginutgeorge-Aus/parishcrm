/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react"
import { ViewToggle } from "@/components/accounting/ViewToggle"

const mockPush = jest.fn()

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}))

describe("ViewToggle", () => {
  beforeEach(() => jest.clearAllMocks())

  it("renders Annual and Monthly buttons", () => {
    render(<ViewToggle currentView="annual" year={2025} />)
    expect(screen.getByRole("button", { name: "Annual" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Monthly" })).toBeInTheDocument()
  })

  it("clicking Monthly pushes ?year=2025&view=monthly", () => {
    render(<ViewToggle currentView="annual" year={2025} />)
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }))
    expect(mockPush).toHaveBeenCalledWith("?year=2025&view=monthly")
  })

  it("clicking Annual pushes without view param", () => {
    render(<ViewToggle currentView="monthly" year={2025} />)
    fireEvent.click(screen.getByRole("button", { name: "Annual" }))
    expect(mockPush).toHaveBeenCalledWith("?year=2025")
  })

  it("clicking the already-active button still fires router.push", () => {
    render(<ViewToggle currentView="annual" year={2025} />)
    fireEvent.click(screen.getByRole("button", { name: "Annual" }))
    expect(mockPush).toHaveBeenCalledWith("?year=2025")
  })

  it("preserves existing year in URL when switching views", () => {
    render(<ViewToggle currentView="annual" year={2024} />)
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }))
    expect(mockPush).toHaveBeenCalledWith("?year=2024&view=monthly")
  })

  it("marks only the active view as aria-pressed", () => {
    render(<ViewToggle currentView="annual" year={2025} />)
    expect(screen.getByRole("button", { name: "Annual" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Monthly" })).toHaveAttribute("aria-pressed", "false")
  })
})
