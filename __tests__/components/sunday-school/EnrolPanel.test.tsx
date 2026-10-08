import { render, screen, fireEvent, waitFor } from "@testing-library/react"

jest.mock("@/lib/actions/sundaySchool", () => ({
  enrolChildren: jest.fn().mockResolvedValue({ success: "Enrolled 2" }),
  unenrolChild: jest.fn().mockResolvedValue(undefined),
}))

import { EnrolPanel } from "@/components/sunday-school/EnrolPanel"
import { enrolChildren } from "@/lib/actions/sundaySchool"

const enrolled = [{ id: 1, name: "Test Child", familyName: "Sample" }]
const candidates = [
  { id: 2, name: "Amy Brown", familyName: "Brown", isChild: true, currentClass: null },
  { id: 3, name: "Ben Brown", familyName: "Brown", isChild: true, currentClass: "Years 3–4" },
  { id: 4, name: "Carol Brown", familyName: "Brown", isChild: false, currentClass: null },
]

beforeEach(() => jest.clearAllMocks())

describe("EnrolPanel", () => {
  it("lists enrolled children with a Remove control", () => {
    render(<EnrolPanel classId={9} enrolled={enrolled} candidates={candidates} readOnly={false} />)
    expect(screen.getByRole("link", { name: "Test Child" })).toHaveAttribute("href", "/people/1")
    expect(screen.getByRole("button", { name: "Remove Test Child" })).toBeInTheDocument()
  })

  it("shows children only by default and everyone when unticked", () => {
    render(<EnrolPanel classId={9} enrolled={enrolled} candidates={candidates} readOnly={false} />)
    expect(screen.queryByLabelText(/Carol Brown/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("Children only"))
    expect(screen.getByLabelText(/Carol Brown/)).toBeInTheDocument()
  })

  it("filters candidates by name, case-insensitively", () => {
    render(<EnrolPanel classId={9} enrolled={enrolled} candidates={candidates} readOnly={false} />)
    fireEvent.change(screen.getByLabelText("Search people"), { target: { value: "AMY" } })
    expect(screen.getByLabelText(/Amy Brown/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Ben Brown/)).not.toBeInTheDocument()
  })

  it("flags a candidate already in another class", () => {
    render(<EnrolPanel classId={9} enrolled={enrolled} candidates={candidates} readOnly={false} />)
    expect(screen.getByText("in Years 3–4 — will move")).toBeInTheDocument()
  })

  it("enrols the ticked candidates in one call", async () => {
    render(<EnrolPanel classId={9} enrolled={enrolled} candidates={candidates} readOnly={false} />)
    fireEvent.click(screen.getByLabelText(/Amy Brown/))
    fireEvent.click(screen.getByLabelText(/Ben Brown/))
    fireEvent.click(screen.getByRole("button", { name: "Enrol 2" }))
    await waitFor(() => expect(enrolChildren).toHaveBeenCalledTimes(1))
    expect(enrolChildren).toHaveBeenCalledWith(9, [2, 3])
    expect(await screen.findByText("Enrolled 2")).toBeInTheDocument()
  })

  it("hides every control when read-only", () => {
    render(<EnrolPanel classId={9} enrolled={enrolled} candidates={candidates} readOnly />)
    expect(screen.getByText("Test Child")).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Search people")).not.toBeInTheDocument()
  })
})
