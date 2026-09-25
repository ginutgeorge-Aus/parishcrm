import { render, screen, fireEvent } from "@testing-library/react"
import { useState } from "react"
import { QuestionField } from "@/components/public-event/QuestionField"
import type { CustomAnswer, CustomQuestion } from "@/lib/eventQuestions"

// Controlled harness so onChange round-trips into value, like the real form.
function Harness({ q }: { q: CustomQuestion }) {
  const [value, setValue] = useState<CustomAnswer | undefined>(undefined)
  return <QuestionField q={q} idPrefix="t" value={value} onChange={setValue} />
}

const radioQ: CustomQuestion = { id: "q0", label: "Pickup", required: false, type: "radio", options: ["Parent"], allowOther: true }
const checkboxQ: CustomQuestion = { id: "q1", label: "Allergies", required: false, type: "checkbox", options: ["Not Applicable"], allowOther: true }
const selectQ: CustomQuestion = { id: "q2", label: "Pickup", required: false, type: "select", options: ["Parent"], allowOther: true }

describe("QuestionField — allowOther", () => {
  it("radio: choosing Other reveals a text box and stores the typed value", () => {
    render(<Harness q={radioQ} />)
    fireEvent.click(screen.getByLabelText("Other"))
    const box = screen.getByLabelText("Other (please specify)")
    fireEvent.change(box, { target: { value: "Grandma" } })
    expect((box as HTMLInputElement).value).toBe("Grandma")
  })

  it("radio: does NOT render Other when allowOther is false", () => {
    render(<Harness q={{ ...radioQ, allowOther: false }} />)
    expect(screen.queryByLabelText("Other")).toBeNull()
  })

  it("checkbox: ticking Other and typing adds one write-in element", () => {
    render(<Harness q={checkboxQ} />)
    fireEvent.click(screen.getByLabelText("Other"))
    const box = screen.getByLabelText("Other (please specify)")
    fireEvent.change(box, { target: { value: "Peanuts" } })
    expect((box as HTMLInputElement).value).toBe("Peanuts")
  })

  it("checkbox: a write-in equal to a configured option can still be unchecked, and never duplicates", () => {
    const onChange = jest.fn()
    function Spy() {
      const [value, setValue] = useState<CustomAnswer | undefined>(undefined)
      return <QuestionField q={{ ...checkboxQ, options: ["Nuts", "Dairy"] }} idPrefix="t" value={value} onChange={(v) => { onChange(v); setValue(v) }} />
    }
    render(<Spy />)
    fireEvent.click(screen.getByLabelText("Other"))
    fireEvent.change(screen.getByLabelText("Other (please specify)"), { target: { value: "Nuts" } })
    expect(onChange).toHaveBeenLastCalledWith(["Nuts"])
    // Ticking another option must not emit "Nuts" twice.
    fireEvent.click(screen.getByRole("checkbox", { name: "Dairy" }))
    expect(onChange).toHaveBeenLastCalledWith(["Dairy", "Nuts"])
    // Unticking the matching option actually removes it.
    const nuts = screen.getByRole("checkbox", { name: "Nuts" })
    fireEvent.click(nuts)
    expect(onChange).toHaveBeenLastCalledWith(["Dairy"])
    expect(nuts).not.toBeChecked()
  })

  it("checkbox: editing a write-in away from a matching option drops that option", () => {
    const onChange = jest.fn()
    function Spy() {
      const [value, setValue] = useState<CustomAnswer | undefined>(undefined)
      return <QuestionField q={{ ...checkboxQ, options: ["Nuts", "Dairy"] }} idPrefix="t" value={value} onChange={(v) => { onChange(v); setValue(v) }} />
    }
    render(<Spy />)
    fireEvent.click(screen.getByLabelText("Other"))
    const box = screen.getByLabelText("Other (please specify)")
    fireEvent.change(box, { target: { value: "Nuts" } })
    fireEvent.change(box, { target: { value: "Nut-free" } })
    expect(onChange).toHaveBeenLastCalledWith(["Nut-free"])
    expect(screen.getByRole("checkbox", { name: "Nuts" })).not.toBeChecked()
    // Leaving Other with an absorbed write-in drops it too.
    fireEvent.change(box, { target: { value: "Nuts" } })
    fireEvent.click(screen.getByLabelText("Other"))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it("checkbox: an explicitly ticked option survives a matching write-in being edited", () => {
    const onChange = jest.fn()
    function Spy() {
      const [value, setValue] = useState<CustomAnswer | undefined>(undefined)
      return <QuestionField q={{ ...checkboxQ, options: ["Nuts", "Dairy"] }} idPrefix="t" value={value} onChange={(v) => { onChange(v); setValue(v) }} />
    }
    render(<Spy />)
    fireEvent.click(screen.getByRole("checkbox", { name: "Nuts" }))
    fireEvent.click(screen.getByLabelText("Other"))
    const box = screen.getByLabelText("Other (please specify)")
    fireEvent.change(box, { target: { value: "Nuts" } })
    fireEvent.change(box, { target: { value: "Nut-free" } })
    expect(onChange).toHaveBeenLastCalledWith(["Nuts", "Nut-free"])
  })

  // Radix Select's dropdown doesn't open under fireEvent in jsdom, so drive the
  // derive-from-stored-value path directly: a stored write-in (a string not in
  // options) must surface the Other text box pre-populated.
  it("select: a stored write-in value shows the Other text box populated", () => {
    render(<QuestionField q={selectQ} idPrefix="t" value="Grandma" onChange={() => {}} />)
    expect((screen.getByLabelText("Other (please specify)") as HTMLInputElement).value).toBe("Grandma")
  })

  it("select: editing the Other box emits the typed text, never the OTHER sentinel", () => {
    const onChange = jest.fn()
    render(<QuestionField q={selectQ} idPrefix="t" value="Grandma" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText("Other (please specify)"), { target: { value: "Uncle Joe" } })
    expect(onChange).toHaveBeenCalledWith("Uncle Joe")
    expect(onChange).not.toHaveBeenCalledWith("__other__")
  })

  it("select: does NOT render Other when allowOther is false", () => {
    render(<QuestionField q={{ ...selectQ, allowOther: false }} idPrefix="t" value="Grandma" onChange={() => {}} />)
    expect(screen.queryByLabelText("Other (please specify)")).toBeNull()
  })
})
