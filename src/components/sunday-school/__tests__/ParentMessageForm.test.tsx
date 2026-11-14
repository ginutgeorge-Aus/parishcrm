import { fireEvent, render, screen } from "@testing-library/react"
import { ParentMessageForm, type FormStudent } from "@/components/sunday-school/ParentMessageForm"

const students: FormStudent[] = [
  { personId: 1, name: "Amy Kid", parentIds: [10, 11], skipLabel: null },
  { personId: 2, name: "Ben Kid", parentIds: [10, 11], skipLabel: null }, // sibling of Amy
  { personId: 3, name: "Cal Other", parentIds: [], skipLabel: "No parent in the family record" },
]
const action = jest.fn(async () => undefined)

describe("ParentMessageForm", () => {
  it("counts each parent once across siblings and shows why a child is skipped", () => {
    render(<ParentMessageForm action={action} students={students} preselected={[1, 2, 3]} />)
    expect(screen.getByText("This email will go to 2 parents.")).toBeInTheDocument()
    expect(screen.getByText("No parent in the family record")).toBeInTheDocument()
  })

  it("pre-selects only the given children and disables send when nobody is reachable", () => {
    render(<ParentMessageForm action={action} students={students} preselected={[3]} />)
    expect(screen.getByText("This email will go to 0 parents.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send email" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Whole class" }))
    expect(screen.getByText("This email will go to 2 parents.")).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("Amy Kid"))
    expect(screen.getByText("This email will go to 2 parents.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(screen.getByText("This email will go to 0 parents.")).toBeInTheDocument()
  })
})
