/**
 * @jest-environment jsdom
 *
 * UserForm role options mirror canAssignRole, and a self edit (AUD-1-02) is
 * name only: email read-only, no password field, role fixed via a hidden input.
 */
import { render, screen } from "@testing-library/react"
import { UserForm } from "@/components/users/UserForm"

// Plain native <select> so the options are inspectable without Radix internals.
jest.mock("@/components/ui/select", () => ({
  Select: ({ name, defaultValue, children }: { name: string; defaultValue?: string; children: React.ReactNode }) => (
    <select name={name} defaultValue={defaultValue} data-testid="role-select">
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}))

const action = jest.fn()
const optionValues = () =>
  Array.from(screen.getByTestId("role-select").querySelectorAll("option")).map((o) => o.getAttribute("value"))

it("OFFICE_ADMIN cannot pick ADMIN, PASTOR or OFFICE_ADMIN", () => {
  render(<UserForm action={action} currentUserRole="OFFICE_ADMIN" />)
  const values = optionValues()
  expect(values).toContain("VIEWER")
  expect(values).not.toContain("ADMIN")
  expect(values).not.toContain("PASTOR")
  expect(values).not.toContain("OFFICE_ADMIN")
})

it("ADMIN can pick every role", () => {
  render(<UserForm action={action} currentUserRole="ADMIN" />)
  expect(optionValues()).toEqual(expect.arrayContaining(["ADMIN", "PASTOR", "OFFICE_ADMIN", "VIEWER"]))
})

it("self edit shows the name only as editable and keeps the role", () => {
  const { container } = render(
    <UserForm
      action={action}
      currentUserRole="OFFICE_ADMIN"
      isSelf
      user={{ id: 2, name: "Me", email: "me@example.com", role: "OFFICE_ADMIN" }}
    />,
  )
  expect(screen.getByLabelText("Email")).toHaveAttribute("readonly")
  expect(container.querySelector('input[name="password"]')).toBeNull()
  expect(screen.queryByTestId("role-select")).toBeNull()
  expect(container.querySelector('input[type="hidden"][name="role"]')).toHaveValue("OFFICE_ADMIN")
})
