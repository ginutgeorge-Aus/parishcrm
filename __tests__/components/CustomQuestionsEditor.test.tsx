import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CustomQuestionsEditor } from "@/components/events/CustomQuestionsEditor"

it("shows options input for checkbox and body field for consent", () => {
  render(<CustomQuestionsEditor initial={[
    { label: "Meal", type: "checkbox", required: false, options: "Veg, Non-veg", body: "", ticketTypeNames: "", scope: "order", allowOther: false },
    { label: "Waiver", type: "consent", required: true, options: "", body: "Terms here", ticketTypeNames: "", scope: "order", allowOther: false },
  ]} ticketTypeNames={[]} />)
  expect(screen.getByDisplayValue("Veg, Non-veg")).toBeInTheDocument()
  expect(screen.getByDisplayValue("Terms here")).toBeInTheDocument()
})

it("shows a statements textarea for a consent row and posts it", () => {
  render(<CustomQuestionsEditor initial={[{ label: "C", type: "consent", required: true, options: "", body: "", ticketTypeNames: "", scope: "order", allowOther: false, statements: "Photo\nLiability" }]} ticketTypeNames={[]} />)
  const ta = screen.getByLabelText("Consent statements for question 1") as HTMLTextAreaElement
  expect(ta).toBeInTheDocument()
  expect(ta.name).toBe("customQuestion.0.statements")
  expect(ta.value).toBe("Photo\nLiability")
})

it("inserts a preset question", () => {
  render(<CustomQuestionsEditor initial={[]} ticketTypeNames={[]} />)
  fireEvent.click(screen.getByRole("button", { name: /dietary/i }))
  expect(screen.getByDisplayValue("Dietary requirements")).toBeInTheDocument()
})

it("renders a ticket-type checkbox group and emits selected names", async () => {
  render(<CustomQuestionsEditor initial={[{ label: "Child age", type: "number", required: false, options: "", body: "", ticketTypeNames: "", scope: "order", allowOther: false }]} ticketTypeNames={["Adult", "Child"]} />)
  const childBox = screen.getByRole("checkbox", { name: "Child" })
  await userEvent.click(childBox)
  const hidden = document.querySelector('input[name="customQuestion.0.ticketTypeNames"]') as HTMLInputElement
  expect(JSON.parse(hidden.value)).toEqual(["Child"])
})

it("keeps a comma-containing ticket name as one scoped selection", async () => {
  render(<CustomQuestionsEditor initial={[{ label: "Q", type: "text", required: false, options: "", body: "", ticketTypeNames: "", scope: "order", allowOther: false }]} ticketTypeNames={["Adult, member", "Child"]} />)
  await userEvent.click(screen.getByRole("checkbox", { name: "Adult, member" }))
  const hidden = document.querySelector('input[name="customQuestion.0.ticketTypeNames"]') as HTMLInputElement
  expect(JSON.parse(hidden.value)).toEqual(["Adult, member"])
  expect(screen.getByRole("checkbox", { name: "Adult, member" })).toBeChecked()
  expect(screen.queryByRole("alert")).not.toBeInTheDocument()
})

it("reads a JSON-encoded initial selection with a comma name", () => {
  render(<CustomQuestionsEditor initial={[{ label: "Q", type: "text", required: false, options: "", body: "", ticketTypeNames: JSON.stringify(["Adult, member"]), scope: "order", allowOther: false }]} ticketTypeNames={["Adult, member"]} />)
  expect(screen.getByRole("checkbox", { name: "Adult, member" })).toBeChecked()
})

it("toggles the per-attendee scope checkbox and posts scope=attendee", async () => {
  render(<CustomQuestionsEditor initial={[{ label: "Meal", type: "text", required: false, options: "", body: "", ticketTypeNames: "", scope: "order", allowOther: false }]} ticketTypeNames={[]} />)
  const scopeBox = screen.getByRole("checkbox", { name: /per attendee/i })
  expect(scopeBox).toHaveAttribute("aria-checked", "false")
  await userEvent.click(scopeBox)
  expect(scopeBox).toHaveAttribute("aria-checked", "true")
})

it("shows the allow-Other toggle only for select/radio/checkbox and flows into the row", async () => {
  render(<CustomQuestionsEditor initial={[{ label: "Meal", type: "checkbox", required: false, options: "Veg, Non-veg", body: "", ticketTypeNames: "", scope: "order", allowOther: false }]} ticketTypeNames={[]} />)
  const toggle = screen.getByRole("checkbox", { name: /other.*write-in/i })
  expect(toggle).toHaveAttribute("aria-checked", "false")
  await userEvent.click(toggle)
  expect(toggle).toHaveAttribute("aria-checked", "true")
})

it("hides the allow-Other toggle for text and consent questions", () => {
  render(<CustomQuestionsEditor initial={[
    { label: "Name", type: "text", required: false, options: "", body: "", ticketTypeNames: "", scope: "order", allowOther: false },
    { label: "Waiver", type: "consent", required: true, options: "", body: "Terms", ticketTypeNames: "", scope: "order", allowOther: false },
  ]} ticketTypeNames={[]} />)
  expect(screen.queryByRole("checkbox", { name: /other.*write-in/i })).not.toBeInTheDocument()
})

it("hides the group when there are no ticket types", () => {
  render(<CustomQuestionsEditor initial={[{ label: "Q", type: "text", required: false, options: "", body: "", ticketTypeNames: "", scope: "order", allowOther: false }]} ticketTypeNames={[]} />)
  expect(screen.queryByText(/show only for/i)).not.toBeInTheDocument()
})

// every row's Remove button announced identically as "Remove question"
// to a screen reader with no indication of which row it removes.
it("gives each row's Remove button a row-distinguishing accessible name", () => {
  render(<CustomQuestionsEditor initial={[
    { label: "Meal", type: "text", required: false, options: "", body: "", ticketTypeNames: "", scope: "order", allowOther: false },
    { label: "Size", type: "text", required: false, options: "", body: "", ticketTypeNames: "", scope: "order", allowOther: false },
  ]} ticketTypeNames={[]} />)
  expect(screen.getByRole("button", { name: "Remove question (row 1)" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Remove question (row 2)" })).toBeInTheDocument()
})

// question ids used to be derived from loop position (`q${i}`), so
// deleting an earlier question shifted every later question into a lower
// index — silently relabeling historical Registration.customAnswers stored
// under the old id. Ids are now submitted per-row and stay put across edits.
it("keeps a question's submitted id stable when an earlier row is removed", () => {
  render(<CustomQuestionsEditor initial={[
    { id: "dietary-id", label: "Dietary", type: "text", required: false, options: "", body: "", ticketTypeNames: "", scope: "order", allowOther: false },
    { id: "emergency-id", label: "Emergency contact", type: "text", required: false, options: "", body: "", ticketTypeNames: "", scope: "order", allowOther: false },
    { id: "tshirt-id", label: "T-shirt size", type: "text", required: false, options: "", body: "", ticketTypeNames: "", scope: "order", allowOther: false },
  ]} ticketTypeNames={[]} />)
  fireEvent.click(screen.getAllByRole("button", { name: /^Remove question/ })[0])
  // Emergency contact and T-shirt size are now rows 1 and 2 (index shifted),
  // but their submitted id hidden inputs must still carry their ORIGINAL ids.
  const emergencyRow = screen.getByDisplayValue("Emergency contact").closest("div.flex.flex-col")!
  const tshirtRow = screen.getByDisplayValue("T-shirt size").closest("div.flex.flex-col")!
  expect((emergencyRow.querySelector('input[type="hidden"]') as HTMLInputElement).value).toBe("emergency-id")
  expect((tshirtRow.querySelector('input[type="hidden"]') as HTMLInputElement).value).toBe("tshirt-id")
})

it("assigns each newly-added question a distinct id", () => {
  render(<CustomQuestionsEditor initial={[]} ticketTypeNames={[]} />)
  fireEvent.click(screen.getByRole("button", { name: "+ Add question" }))
  fireEvent.click(screen.getByRole("button", { name: "+ Add question" }))
  const hiddenIds = Array.from(document.querySelectorAll('input[name^="customQuestion"][name$=".id"]')) as HTMLInputElement[]
  expect(hiddenIds).toHaveLength(2)
  expect(hiddenIds[0].value).not.toBe("")
  expect(hiddenIds[0].value).not.toBe(hiddenIds[1].value)
})

it("drops a dangling ticket-type name after a rename and warns instead of silently submitting it", () => {
  const { rerender } = render(
    <CustomQuestionsEditor
      initial={[{ label: "Q", type: "text", required: false, options: "", body: "", ticketTypeNames: "Adult", scope: "order", allowOther: false }]}
      ticketTypeNames={["Adult"]}
    />,
  )
  // Ticket type renamed Adult -> Grown-up in the same edit session; EventForm
  // re-renders CustomQuestionsEditor with the new live names.
  rerender(
    <CustomQuestionsEditor
      initial={[{ label: "Q", type: "text", required: false, options: "", body: "", ticketTypeNames: "Adult", scope: "order", allowOther: false }]}
      ticketTypeNames={["Grown-up"]}
    />,
  )
  const hidden = document.querySelector('input[name="customQuestion.0.ticketTypeNames"]') as HTMLInputElement
  expect(hidden.value).not.toContain("Adult")
  expect(screen.getByRole("alert")).toHaveTextContent(/adult/i)
})
