/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react"
import { AuditLogFilters } from "@/components/settings/AuditLogFilters"

let mockPush = jest.fn()
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}))

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  mockPush = jest.fn()
})

afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

describe("AuditLogFilters", () => {
  it("renders filter inputs and clear button", () => {
    render(<AuditLogFilters />)
    expect(screen.getByLabelText("Filter audit log by action")).toBeInTheDocument()
    expect(screen.getByLabelText("From date")).toBeInTheDocument()
    expect(screen.getByLabelText("To date")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument()
  })

  it("debounces action filter input (does not navigate immediately)", () => {
    render(<AuditLogFilters />)
    const actionInput = screen.getByLabelText("Filter audit log by action") as HTMLInputElement
    
    fireEvent.change(actionInput, { target: { value: "VIEW_" } })
    expect(mockPush).not.toHaveBeenCalled()
    
    fireEvent.change(actionInput, { target: { value: "VIEW_PASTORAL_NOTES" } })
    expect(mockPush).not.toHaveBeenCalled()
    
    // Fast forward past debounce timeout
    jest.runAllTimers()
    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("action=VIEW_PASTORAL_NOTES"))
  })

  it("cancels previous debounced action when user types again", () => {
    render(<AuditLogFilters />)
    const actionInput = screen.getByLabelText("Filter audit log by action")
    
    fireEvent.change(actionInput, { target: { value: "FIRST" } })
    jest.advanceTimersByTime(100)
    expect(mockPush).not.toHaveBeenCalled()
    
    fireEvent.change(actionInput, { target: { value: "SECOND" } })
    jest.runAllTimers()
    
    // Only the final value should cause a push
    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("action=SECOND"))
  })

  it("navigates immediately for date changes (no debounce)", () => {
    render(<AuditLogFilters />)
    const fromInput = screen.getByLabelText("From date")
    
    fireEvent.change(fromInput, { target: { value: "2026-01-01" } })
    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("from=2026-01-01"))
  })

  it("clears all filters when Clear button is clicked", () => {
    render(<AuditLogFilters />)
    
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    
    expect(mockPush).toHaveBeenCalledWith("/settings/audit-log")
    expect(screen.getByLabelText("Filter audit log by action")).toHaveValue("")
    expect(screen.getByLabelText("From date")).toHaveValue("")
    expect(screen.getByLabelText("To date")).toHaveValue("")
  })

  it("date change cancels pending debounced action", () => {
    render(<AuditLogFilters />)
    const actionInput = screen.getByLabelText("Filter audit log by action")
    const fromInput = screen.getByLabelText("From date")
    
    fireEvent.change(actionInput, { target: { value: "PENDING_ACTION" } })
    jest.advanceTimersByTime(100)
    expect(mockPush).not.toHaveBeenCalled()
    
    // Date change should cancel the pending debounce
    fireEvent.change(fromInput, { target: { value: "2026-01-01" } })
    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("from=2026-01-01"))
    
    // The debounced action should not fire after the date change
    jest.runAllTimers()
    expect(mockPush).toHaveBeenCalledTimes(1)
  })
})
