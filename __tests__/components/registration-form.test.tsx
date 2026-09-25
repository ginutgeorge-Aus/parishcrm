import { render, screen, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RegistrationForm } from "@/components/public-event/RegistrationForm"

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }))
// RegistrationForm imports this server action; mock it so the jsdom test does
// not pull the real Prisma client (crashes on import in the browser env).
jest.mock("@/lib/actions/eventCheckout", () => ({ startEventCheckout: jest.fn() }))

const props = {
  slug: "test-event",
  ticketTypes: [{ id: 1, name: "Adult", price: 10, capacity: null }],
  soldCounts: {},
  customQuestions: [],
  allSoldOut: false,
  formToken: "tok",
}

describe("RegistrationForm custom question types", () => {
  it("renders radio, checkbox, textarea and consent controls", () => {
    render(<RegistrationForm {...props} customQuestions={[
      { id: "q0", label: "Pick", type: "radio", required: false, options: ["A", "B"] },
      { id: "q1", label: "Meal", type: "checkbox", required: false, options: ["Veg", "Non-veg"] },
      { id: "q2", label: "Notes", type: "textarea", required: false },
      { id: "q3", label: "Waiver", type: "consent", required: true, body: "I agree" },
    ] as never} />)
    expect(screen.getByText("I agree")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "A" })).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "Veg" })).toBeInTheDocument()
  })

  it("blocks submit when a required checkbox question has no selection", async () => {
    render(<RegistrationForm {...props} customQuestions={[
      { id: "q1", label: "Meal", type: "checkbox", required: true, options: ["Veg", "Non-veg"] },
    ] as never} />)
    fireEvent.click(screen.getByLabelText("Increase Adult quantity"))
    fireEvent.change(screen.getByLabelText("Adult 1"), { target: { value: "Alice" } })
    const submit = screen.getByRole("button", { name: /Reserve My Tickets/i })
    expect(submit).toHaveAttribute("aria-disabled", "true")
    await userEvent.click(screen.getByRole("checkbox", { name: "Veg" }))
    expect(submit).toHaveAttribute("aria-disabled", "false")
  })

  it("blocks submit when a required consent is unchecked", () => {
    render(<RegistrationForm {...props} customQuestions={[
      { id: "q3", label: "Waiver", type: "consent", required: true, body: "I agree" },
    ] as never} />)
    const submit = screen.getByRole("button", { name: /Reserve My Tickets/i })
    // Submit stays disabled (no tickets + consent not checked)
    expect(submit).toHaveAttribute("aria-disabled", "true")
  })

  it("blocks submit until every statements-consent box is ticked", async () => {
    render(<RegistrationForm {...props} customQuestions={[
      { id: "q3", label: "Waiver", type: "consent", required: true, body: "Policies", statements: ["A", "B"] },
    ] as never} />)
    fireEvent.click(screen.getByLabelText("Increase Adult quantity"))
    fireEvent.change(screen.getByLabelText("Adult 1"), { target: { value: "Alice" } })
    const submit = screen.getByRole("button", { name: /Reserve My Tickets/i })
    expect(submit).toHaveAttribute("aria-disabled", "true")
    // Ticking the statement boxes alone is not enough — the final agree box gates too.
    await userEvent.click(screen.getByRole("checkbox", { name: "A" }))
    await userEvent.click(screen.getByRole("checkbox", { name: "B" }))
    expect(submit).toHaveAttribute("aria-disabled", "true")
    await userEvent.click(screen.getByRole("checkbox", { name: /I have read and agree/i }))
    expect(submit).toHaveAttribute("aria-disabled", "false")
  })
})

describe("RegistrationForm — per-ticket-type questions", () => {
  it("hides a ticket-targeted question until its ticket is selected", async () => {
    render(<RegistrationForm
      slug="test-event"
      ticketTypes={[
        { id: 1, name: "Adult", price: 10, capacity: null },
        { id: 2, name: "Child", price: 5, capacity: null },
      ]}
      soldCounts={{}}
      customQuestions={[{ id: "q0", label: "Child age", type: "number", required: true, ticketTypeNames: ["Child"] }] as never}
      allSoldOut={false}
      formToken="tok"
    />)
    // Question not shown yet — no Child ticket selected
    expect(screen.queryByLabelText(/child age/i)).not.toBeInTheDocument()
    // Select one Child ticket
    await userEvent.click(screen.getByLabelText("Increase Child quantity"))
    // Question should now appear
    expect(screen.getByLabelText(/child age/i)).toBeInTheDocument()
  })

  it("does not block submit for a required targeted question when its ticket is not selected", () => {
    render(<RegistrationForm
      slug="test-event"
      ticketTypes={[
        { id: 1, name: "Adult", price: 10, capacity: null },
        { id: 2, name: "Child", price: 5, capacity: null },
      ]}
      soldCounts={{}}
      customQuestions={[{ id: "q0", label: "Child age", type: "number", required: true, ticketTypeNames: ["Child"] }] as never}
      allSoldOut={false}
      formToken="tok"
    />)
    // Select an Adult ticket and fill in name — the required Child question should not block submit
    fireEvent.click(screen.getByLabelText("Increase Adult quantity"))
    fireEvent.change(screen.getByLabelText("Adult 1"), { target: { value: "Alice" } })
    // Submit button should not be blocked by the unapplicable Child question
    const submit = screen.getByRole("button", { name: /Reserve My Tickets/i })
    expect(submit).toHaveAttribute("aria-disabled", "false")
  })
})

describe("RegistrationForm attendee-scoped questions", () => {
  it("renders an attendee-scoped question once per attendee", async () => {
    render(<RegistrationForm {...props} customQuestions={[
      { id: "q-diet", label: "Diet", type: "text", required: false, scope: "attendee" },
    ] as never} />)
    const plus = screen.getByLabelText("Increase Adult quantity")
    fireEvent.click(plus)
    fireEvent.click(plus)
    // Two attendees → two Diet fields
    expect(screen.getAllByLabelText(/Diet/)).toHaveLength(2)
  })

  it("does not render order-scoped questions inside the attendee block", async () => {
    render(<RegistrationForm {...props} customQuestions={[
      { id: "q-order", label: "Notes", type: "text", required: false },
      { id: "q-att", label: "Diet", type: "text", required: false, scope: "attendee" },
    ] as never} />)
    const plus = screen.getByLabelText("Increase Adult quantity")
    fireEvent.click(plus)
    fireEvent.click(plus)
    // One Notes field (order-level), two Diet fields (per-attendee)
    expect(screen.getAllByLabelText(/Notes/)).toHaveLength(1)
    expect(screen.getAllByLabelText(/Diet/)).toHaveLength(2)
  })

  it("blocks submit when a required attendee-scoped question is unanswered", async () => {
    render(<RegistrationForm {...props} customQuestions={[
      { id: "q-diet", label: "Diet", type: "text", required: true, scope: "attendee" },
    ] as never} />)
    const plus = screen.getByLabelText("Increase Adult quantity")
    fireEvent.click(plus)
    fireEvent.change(screen.getByLabelText("Adult 1"), { target: { value: "Alice" } })
    const submit = screen.getByRole("button", { name: /Reserve My Tickets/i })
    expect(submit).toHaveAttribute("aria-disabled", "true")
    // Fill in the attendee-scoped question
    const dietInputs = screen.getAllByLabelText(/Diet/)
    fireEvent.change(dietInputs[0], { target: { value: "Vegan" } })
    expect(submit).toHaveAttribute("aria-disabled", "false")
  })
})

describe("RegistrationForm attendee names", () => {
  it("shows one name input per ticket after increasing quantity", () => {
    render(<RegistrationForm {...props} />)
    const plus = screen.getByLabelText("Increase Adult quantity")
    fireEvent.click(plus)
    fireEvent.click(plus)
    expect(screen.getByLabelText("Adult 1")).toBeInTheDocument()
    expect(screen.getByLabelText("Adult 2")).toBeInTheDocument()
  })

  it("disables submit while a required attendee name is empty", () => {
    render(<RegistrationForm {...props} />)
    fireEvent.click(screen.getByLabelText("Increase Adult quantity"))
    const submit = screen.getByRole("button", { name: /Reserve My Tickets/i })
    expect(submit).toHaveAttribute("aria-disabled", "true")
    fireEvent.change(screen.getByLabelText("Adult 1"), { target: { value: "Alice Garcia" } })
    expect(submit).toHaveAttribute("aria-disabled", "false")
  })
})
