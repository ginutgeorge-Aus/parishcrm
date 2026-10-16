/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { PeopleFilters } from "@/components/people/PeopleFilters"

let mockParams = new URLSearchParams()
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => mockParams,
}))

beforeEach(() => {
  mockParams = new URLSearchParams()
})

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
  // "Other" is both a family role and a ministry role option.
  expect(screen.getAllByText("Other")).toHaveLength(2)
  expect(screen.queryByText("VISITOR")).not.toBeInTheDocument()
  expect(screen.queryByText("HEAD")).not.toBeInTheDocument()
})

test("mobile Filters toggle shows and hides the select filters", () => {
  render(<PeopleFilters />)
  const toggle = screen.getByRole("button", { name: "Filters" })
  const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "")
  expect(panel).not.toBeNull()
  expect(toggle).toHaveAttribute("aria-expanded", "false")
  expect(panel).toHaveClass("hidden", "md:contents")

  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute("aria-expanded", "true")
  expect(panel).toHaveClass("flex")
  expect(panel).not.toHaveClass("hidden")

  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute("aria-expanded", "false")
  expect(panel).toHaveClass("hidden")
  expect(panel).not.toHaveClass("flex")
})

test("Filters toggle counts active select filters but not the name search", () => {
  mockParams = new URLSearchParams("q=jo&classification=MEMBER&ministryRole=OTHER&role=ALL")
  render(<PeopleFilters />)
  expect(screen.getByRole("button", { name: "Filters (2)" })).toBeInTheDocument()
})
