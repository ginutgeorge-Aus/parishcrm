import { fireEvent, render, screen } from "@testing-library/react"
import { QuestionField } from "@/components/public-event/QuestionField"
import type { CustomQuestion } from "@/lib/eventQuestions"

it("gives a consent checkbox an accessible name that includes its topic", () => {
  const q: CustomQuestion = {
    id: "c1",
    label: "Photo consent",
    type: "consent",
    required: true,
    body: "We may photograph attendees during the event.",
  }
  render(<QuestionField q={q} idPrefix="reg-q" value={undefined} onChange={() => {}} />)
  // Two consents with identical "agree" text must be distinguishable — the topic
  // body is wired in via aria-labelledby.
  expect(screen.getByRole("checkbox")).toHaveAccessibleName(/We may photograph attendees/i)
})

it("marks required multi-select checkbox options as aria-required", () => {
  const q: CustomQuestion = {
    id: "m1",
    label: "Meal choice",
    type: "checkbox",
    required: true,
    options: ["Veg", "Non-veg"],
  }
  render(<QuestionField q={q} idPrefix="reg-q" value={[]} onChange={() => {}} />)
  for (const box of screen.getAllByRole("checkbox")) {
    expect(box).toHaveAttribute("aria-required", "true")
  }
})

it("renders one checkbox per statement plus a final agree box", () => {
  const q = { id: "q0", label: "Consent", type: "consent" as const, required: true, statements: ["Photo", "Liability"] }
  const onChange = jest.fn()
  render(<QuestionField q={q} idPrefix="p" value={undefined} onChange={onChange} />)
  // 2 statements + 1 final = 3 checkboxes
  expect(screen.getAllByRole("checkbox")).toHaveLength(3)
  expect(screen.getByText("Photo")).toBeInTheDocument()
  expect(screen.getByText("Liability")).toBeInTheDocument()
})

it("emits a padded boolean[] when a statement box is toggled", () => {
  const q = { id: "q0", label: "Consent", type: "consent" as const, required: true, statements: ["Photo", "Liability"] }
  const onChange = jest.fn()
  render(<QuestionField q={q} idPrefix="p" value={undefined} onChange={onChange} />)
  fireEvent.click(screen.getAllByRole("checkbox")[0])
  expect(onChange).toHaveBeenCalledWith([true, false, false])
})

it("reflects an incoming boolean[] value", () => {
  const q = { id: "q0", label: "Consent", type: "consent" as const, required: true, statements: ["Photo", "Liability"] }
  render(<QuestionField q={q} idPrefix="p" value={[true, false, true]} onChange={jest.fn()} />)
  const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[]
  expect(boxes[0].checked).toBe(true)
  expect(boxes[1].checked).toBe(false)
  expect(boxes[2].checked).toBe(true)
})

it("still renders a single-box consent unchanged", () => {
  const q = { id: "q0", label: "Consent", type: "consent" as const, required: true, body: "Agree please" }
  render(<QuestionField q={q} idPrefix="p" value={undefined} onChange={jest.fn()} />)
  expect(screen.getAllByRole("checkbox")).toHaveLength(1)
})
