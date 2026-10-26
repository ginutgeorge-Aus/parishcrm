/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react"
import { ImportStepper } from "@/components/accounting/import/ImportStepper"
import { SourceStep } from "@/components/accounting/import/SourceStep"

describe("ImportStepper", () => {
  it("marks earlier steps done and the current step active", () => {
    render(<ImportStepper current="review" />)
    expect(screen.getByText(/Step 3 of 4/)).toBeInTheDocument()
    expect(screen.getByRole("listitem", { name: /Review/ })).toHaveAttribute("aria-current", "step")
    expect(screen.getByRole("listitem", { name: /Upload, completed/ })).toBeInTheDocument()
  })
})

describe("SourceStep", () => {
  it("selects a source and continues", () => {
    const onChange = jest.fn()
    const onContinue = jest.fn()
    render(<SourceStep value="anz" onChange={onChange} onContinue={onContinue} />)
    fireEvent.click(screen.getByRole("radio", { name: /OFX \/ QFX/ }))
    expect(onChange).toHaveBeenCalledWith("ofx")
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(onContinue).toHaveBeenCalled()
  })

  it("shows AI import disabled as coming soon", () => {
    render(<SourceStep value="anz" onChange={jest.fn()} onContinue={jest.fn()} />)
    const ai = screen.getByRole("radio", { name: /AI import/ })
    expect(ai).toBeDisabled()
    expect(screen.getByText("Coming soon")).toBeInTheDocument()
  })
})
