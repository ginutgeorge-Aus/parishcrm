/**
 * @jest-environment jsdom
 *
 * the Status <Select> defaulted its value to "" (the "all" state maps to
 * an empty query param), which matches no SelectItem so the trigger rendered
 * blank instead of "All". Fixed with value={status || "all"}.
 */
import { render, screen } from "@testing-library/react"
import { ReconciliationFilters } from "@/components/accounting/ReconciliationFilters"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

describe("ReconciliationFilters status select", () => {
  it("shows 'All' in the Status trigger when status is empty", () => {
    render(<ReconciliationFilters accounts={[]} paymentAccountId={1} from="" to="" status="" />)
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("All")
  })

  it("shows the selected label for a concrete status", () => {
    render(<ReconciliationFilters accounts={[]} paymentAccountId={1} from="" to="" status="pending" />)
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Pending")
  })
})
