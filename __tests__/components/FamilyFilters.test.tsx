/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import { FamilyFilters } from "@/components/families/FamilyFilters"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select value={value ?? ""} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

test("status dropdown shows humanized labels, not raw ACTIVE/INACTIVE/VISITOR", () => {
  render(<FamilyFilters />)
  expect(screen.getByText("Active")).toBeInTheDocument()
  expect(screen.getByText("Inactive")).toBeInTheDocument()
  expect(screen.getByText("Visitor")).toBeInTheDocument()
  expect(screen.queryByText("ACTIVE")).not.toBeInTheDocument()
  expect(screen.queryByText("INACTIVE")).not.toBeInTheDocument()
  expect(screen.queryByText("VISITOR")).not.toBeInTheDocument()
})
