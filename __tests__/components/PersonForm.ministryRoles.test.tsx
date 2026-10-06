import { render, screen } from "@testing-library/react"
import { PersonForm } from "@/components/people/PersonForm"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ back: jest.fn() }),
}))

const noop = async () => undefined

describe("PersonForm ministry roles", () => {
  it("renders one named checkbox per ministry role, all unticked for a new person", () => {
    render(<PersonForm action={noop} canSeePastoralNotes={false} />)
    const boxes = screen.getAllByRole("checkbox", { name: /staff|volunteer|sunday school teacher|youth leader|children's ministry|other/i })
    expect(boxes).toHaveLength(6)
    for (const b of boxes) {
      expect(b).not.toBeChecked()
      expect(b).toHaveAttribute("name", "ministryRoles")
    }
  })

  it("pre-ticks the person's existing roles", () => {
    render(
      <PersonForm
        action={noop}
        canSeePastoralNotes={false}
        person={{ firstName: "Jane", lastName: "Sample", ministryRoles: ["SUNDAY_SCHOOL_TEACHER"] }}
      />
    )
    expect(screen.getByRole("checkbox", { name: "Sunday school teacher" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Staff" })).not.toBeChecked()
  })
})
