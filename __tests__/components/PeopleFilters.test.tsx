/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import { PeopleFilters } from "@/components/people/PeopleFilters"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// Render shadcn Select as a native <select> so option text is queryable.
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

test("classification and role dropdowns show humanized labels, not raw enum values", () => {
  render(<PeopleFilters />)
  expect(screen.getByText("Member")).toBeInTheDocument()
  expect(screen.getByText("Visitor")).toBeInTheDocument()
  expect(screen.getByText("Inactive")).toBeInTheDocument()
  expect(screen.getByText("Student")).toBeInTheDocument()
  expect(screen.getByText("Head")).toBeInTheDocument()
  expect(screen.getByText("Spouse")).toBeInTheDocument()
  expect(screen.getByText("Child")).toBeInTheDocument()
  expect(screen.getByText("Other")).toBeInTheDocument()
  expect(screen.queryByText("VISITOR")).not.toBeInTheDocument()
  expect(screen.queryByText("HEAD")).not.toBeInTheDocument()
})
