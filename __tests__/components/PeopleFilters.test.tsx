/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react"
import { PeopleFilters } from "@/components/people/PeopleFilters"
import type { ReactNode } from "react"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// Render shadcn Select as a native <select> so option text is queryable.
jest.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange: (value: string) => void; children?: React.ReactNode }) => (
    <select value={value ?? ""} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
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
  // "Other" is both a family role and a ministry role option.
  expect(screen.getAllByText("Other")).toHaveLength(2)
  expect(screen.queryByText("VISITOR")).not.toBeInTheDocument()
  expect(screen.queryByText("HEAD")).not.toBeInTheDocument()
})
