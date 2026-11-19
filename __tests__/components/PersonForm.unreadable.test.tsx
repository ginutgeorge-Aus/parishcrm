import { render, screen } from "@testing-library/react"
import { PersonForm } from "@/components/people/PersonForm"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ back: jest.fn() }),
}))

const noop = async () => undefined
const PLACEHOLDER = "[decryption error]"
const base = { firstName: "Jane", lastName: "Sample" }

// AUD-1-03: typed email/date inputs cannot echo the placeholder, so an
// unreadable value must be posted via a hidden field instead of a blank input.
describe("PersonForm unreadable values", () => {
  it("posts the placeholder in a hidden field and disables the visible input for email and dateOfBirth", () => {
    const { container } = render(
      <PersonForm action={noop} canSeePastoralNotes={false} person={{ ...base, email: PLACEHOLDER, dateOfBirth: PLACEHOLDER }} />
    )
    for (const name of ["email", "dateOfBirth"]) {
      const hidden = container.querySelector(`input[type="hidden"][name="${name}"]`)
      expect(hidden).toHaveAttribute("value", PLACEHOLDER)
      expect(container.querySelector(`input[type="email"][name="${name}"], input[type="date"][name="${name}"]`)).toBeNull()
    }
    expect(screen.getAllByText("This value could not be read. It has not been changed.")).toHaveLength(2)
  })

  it("renders normal typed inputs for readable values", () => {
    const { container } = render(
      <PersonForm action={noop} canSeePastoralNotes={false} person={{ ...base, email: "jane@example.com" }} />
    )
    expect(container.querySelector('input[type="email"][name="email"]')).toHaveValue("jane@example.com")
    expect(container.querySelector('input[type="hidden"][name="email"]')).toBeNull()
  })
})
