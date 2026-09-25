import { render, screen } from "@testing-library/react"
import { FamilyForm } from "../FamilyForm"

describe("FamilyForm new-family dues pre-fill", () => {
  it("pre-fills from defaultDues", () => {
    render(<FamilyForm action={jest.fn()} defaultDues={80} />)
    expect(screen.getByLabelText("Monthly subscription dues")).toHaveValue(80)
  })
  it("leaves dues blank when no default is configured", () => {
    render(<FamilyForm action={jest.fn()} />)
    expect(screen.getByLabelText("Monthly subscription dues")).toHaveValue(null)
  })
})
