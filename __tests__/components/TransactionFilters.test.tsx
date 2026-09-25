/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, act } from "@testing-library/react"
import { TransactionFilters } from "@/components/accounting/TransactionFilters"

// Stateful navigation mock: router.push mutates the "URL" and useSearchParams
// reflects it, mirroring how Next re-renders the component with fresh params.
const mockState = { params: "" }
const mockPush = jest.fn((url: string) => {
  mockState.params = url.includes("?") ? url.split("?")[1] : ""
})
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(mockState.params),
}))

// Render shadcn Select as a native <select> so we can drive it in jsdom. The
// six selects render in DOM order: range, account, type, family, paymentAccount,
// reconciled — so account is combobox index 1. Forward the SelectTrigger's
// aria-label onto the native <select> so getByLabelText/accessible-name
// assertions exercise the same prop the real Radix trigger receives.
jest.mock("@/components/ui/select", () => {
  const React = require("react")
  const SelectTrigger = () => null
  return {
    Select: ({ value, onValueChange, children }: any) => {
      const trigger = React.Children.toArray(children).find(
        (c: any) => c.type === SelectTrigger
      ) as any
      return (
        <select
          value={value || ""}
          onChange={(e: any) => onValueChange(e.target.value)}
          aria-label={trigger?.props?.["aria-label"]}
        >
          {children}
        </select>
      )
    },
    SelectTrigger,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  }
})

const accounts = [{ id: 5, code: "100", name: "Tithe" }]

beforeEach(() => {
  jest.useFakeTimers()
  mockState.params = ""
  mockPush.mockClear()
})
afterEach(() => {
  act(() => { jest.runOnlyPendingTimers() })
  jest.useRealTimers()
})

test("a filter chosen within the debounce window is not dropped by the search timer", () => {
  const { rerender } = render(<TransactionFilters accounts={accounts} families={[]} paymentAccounts={[]} />)

  // Type into the search box — schedules a 350ms debounced navigation.
  fireEvent.change(screen.getByLabelText("Search by description"), {
    target: { value: "tithe" },
  })

  // Within the window, pick an Account filter — navigates immediately.
  fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "5" } })
  // Simulate Next re-rendering the component against the new URL params.
  rerender(<TransactionFilters accounts={accounts} families={[]} paymentAccounts={[]} />)

  // Fire the debounced search.
  act(() => { jest.advanceTimersByTime(350) })

  const lastUrl = mockPush.mock.calls.at(-1)![0] as string
  const params = new URLSearchParams(lastUrl.split("?")[1])
  // Both filters must survive — the search timer must not revert the account filter.
  expect(params.get("q")).toBe("tithe")
  expect(params.get("account")).toBe("5")
})

test("all six filter Selects have an accessible name", () => {
  render(<TransactionFilters accounts={accounts} families={[]} paymentAccounts={[]} />)

  for (const name of [
    "Quick range",
    "Account",
    "Type",
    "Family",
    "Payment account",
    "Reconciled status",
  ]) {
    expect(screen.getByLabelText(name)).toBeInTheDocument()
  }
})

test("quick-range 'today' is the APP_TIMEZONE date, not the browser zone", () => {
  // 15:00 UTC on 23 Sep = 01:00 on 24 Sep in Australia/Sydney (AEST, UTC+10).
  jest.setSystemTime(new Date("2026-09-23T15:00:00Z"))
  render(<TransactionFilters accounts={accounts} families={[]} paymentAccounts={[]} />)
  fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "this-month" } })
  expect(mockPush).toHaveBeenLastCalledWith(expect.stringContaining("from=2026-09-01"))
  expect(mockPush).toHaveBeenLastCalledWith(expect.stringContaining("to=2026-09-24"))
})
