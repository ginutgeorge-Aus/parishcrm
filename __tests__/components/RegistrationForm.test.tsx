import { render, screen, fireEvent } from "@testing-library/react"
import { RegistrationForm } from "@/components/public-event/RegistrationForm"

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock("@/lib/actions/eventCheckout", () => ({ startEventCheckout: jest.fn() }))

const baseProps = {
  slug: "test-event",
  ticketTypes: [{ id: 1, name: "General", price: 0, capacity: null }],
  soldCounts: {},
  customQuestions: [],
  allSoldOut: false,
  formToken: "tok",
}

describe("RegistrationForm submit blockers", () => {
  it("shows no blocker checklist before any ticket is selected", () => {
    render(<RegistrationForm {...baseProps} />)
    expect(screen.queryByText(/Before you can reserve/i)).toBeNull()
  })

  it("surfaces the unmet name requirement once a ticket is selected", () => {
    render(<RegistrationForm {...baseProps} />)
    fireEvent.click(screen.getByLabelText(/Increase General quantity/i))
    expect(screen.getByText(/Before you can reserve/i)).toBeInTheDocument()
    expect(screen.getByText(/Enter a name for each attendee/i)).toBeInTheDocument()
  })

  it("clears the blocker checklist once the attendee name is filled", () => {
    render(<RegistrationForm {...baseProps} />)
    fireEvent.click(screen.getByLabelText(/Increase General quantity/i))
    fireEvent.change(screen.getByLabelText(/General 1/i), { target: { value: "Jane Doe" } })
    expect(screen.queryByText(/Before you can reserve/i)).toBeNull()
  })

  it("keeps the reserve button focusable while blocked, via aria-disabled", () => {
    render(<RegistrationForm {...baseProps} />)
    fireEvent.click(screen.getByLabelText(/Increase General quantity/i))
    const btn = screen.getByRole("button", { name: /reserve my tickets/i })
    // Not natively disabled (would drop out of tab order); AT-blocked instead.
    expect(btn).not.toBeDisabled()
    expect(btn).toHaveAttribute("aria-disabled", "true")
    expect(btn).toHaveAttribute("aria-describedby")
  })
})

describe("RegistrationForm pay-now/pay-later choice (Stripe event payments)", () => {
  const paidProps = {
    ...baseProps,
    ticketTypes: [{ id: 1, name: "Adult", price: 10, capacity: null }],
  }

  it("shows the pay-now/pay-later choice only when online payment is enabled, Stripe is configured, and there is a cost", () => {
    const { rerender } = render(
      <RegistrationForm {...paidProps} onlinePaymentEnabled stripeConfigured />
    )
    fireEvent.click(screen.getByLabelText(/Increase Adult quantity/i))
    expect(screen.getByLabelText(/pay now by card/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/pay later by bank transfer/i)).toBeInTheDocument()

    rerender(<RegistrationForm {...paidProps} onlinePaymentEnabled={false} stripeConfigured />)
    fireEvent.click(screen.getByLabelText(/Increase Adult quantity/i))
    expect(screen.queryByLabelText(/pay now by card/i)).not.toBeInTheDocument()
  })

  it("hides the choice when stripe isn't configured, even if online payment is enabled", () => {
    render(<RegistrationForm {...paidProps} onlinePaymentEnabled stripeConfigured={false} />)
    fireEvent.click(screen.getByLabelText(/Increase Adult quantity/i))
    expect(screen.queryByLabelText(/pay now by card/i)).not.toBeInTheDocument()
  })

  it("hides the choice for a free event (total = 0) even when payment is enabled and configured", () => {
    render(<RegistrationForm {...baseProps} onlinePaymentEnabled stripeConfigured />)
    fireEvent.click(screen.getByLabelText(/Increase General quantity/i))
    expect(screen.queryByLabelText(/pay now by card/i)).not.toBeInTheDocument()
  })

  it("omits the choice entirely when props are not passed (defaults false)", () => {
    render(<RegistrationForm {...paidProps} />)
    fireEvent.click(screen.getByLabelText(/Increase Adult quantity/i))
    expect(screen.queryByLabelText(/pay now by card/i)).not.toBeInTheDocument()
  })
})

describe("RegistrationForm card surcharge (pass card fee)", () => {
  const surchargeProps = {
    ...baseProps,
    ticketTypes: [{ id: 1, name: "Adult", price: 50, capacity: null }],
  }

  it("shows the card fee and grossed-up total when passCardFee and card is selected", () => {
    // grossUpTotal(5000, 1.7, 30).feeCents = 117 → $1.17 fee, $51.17 total.
    render(
      <RegistrationForm {...surchargeProps} onlinePaymentEnabled stripeConfigured passCardFee cardFeePct={1.7} cardFeeFixedCents={30} />
    )
    fireEvent.click(screen.getByLabelText(/Increase Adult quantity/i))
    fireEvent.click(screen.getByLabelText(/pay now by card/i))
    expect(screen.getByText(/Card fee/i)).toBeInTheDocument()
    expect(screen.getByText("$1.17")).toBeInTheDocument()
    expect(screen.getByText("$51.17")).toBeInTheDocument()
  })

  it("shows no card fee row when passCardFee is off, even paying by card", () => {
    render(
      <RegistrationForm {...surchargeProps} onlinePaymentEnabled stripeConfigured cardFeePct={1.7} cardFeeFixedCents={30} />
    )
    fireEvent.click(screen.getByLabelText(/Increase Adult quantity/i))
    fireEvent.click(screen.getByLabelText(/pay now by card/i))
    expect(screen.queryByText(/Card fee/i)).not.toBeInTheDocument()
    expect(screen.getByText("$50.00")).toBeInTheDocument()
  })

  it("shows no card fee while pay-later (bank) is selected, even with passCardFee", () => {
    render(
      <RegistrationForm {...surchargeProps} onlinePaymentEnabled stripeConfigured passCardFee cardFeePct={1.7} cardFeeFixedCents={30} />
    )
    fireEvent.click(screen.getByLabelText(/Increase Adult quantity/i))
    // method defaults to bank — no surcharge on the bank-transfer path.
    expect(screen.queryByText(/Card fee/i)).not.toBeInTheDocument()
    expect(screen.getByText("$50.00")).toBeInTheDocument()
  })
})

describe("RegistrationForm tiered family pricing (CRM-1599)", () => {
  // Per-ticket price is irrelevant once tiered pricing is on — the total comes
  // from the headcount schedule instead.
  const tieredProps = {
    ...baseProps,
    ticketTypes: [{ id: 1, name: "Family", price: 999, capacity: null }],
    tieredPricingEnabled: true,
    familyPricingTiers: [40, 70, 90, 100],
  }

  it("shows the schedule price for the selected headcount, not the sum of ticket prices", () => {
    render(<RegistrationForm {...tieredProps} />)
    const plus = screen.getByLabelText(/Increase Family quantity/i)
    fireEvent.click(plus)
    fireEvent.click(plus)
    fireEvent.click(plus)
    // 3 attendees → tiers[2] = $90, not 3 * $999.
    expect(screen.getByText("$90.00")).toBeInTheDocument()
  })

  it("blocks submit with an inline message once headcount exceeds the tier table", () => {
    render(<RegistrationForm {...tieredProps} />)
    const plus = screen.getByLabelText(/Increase Family quantity/i)
    for (let i = 0; i < 5; i++) fireEvent.click(plus)
    expect(screen.getByText(/maximum of 4 registrants per registration/i)).toBeInTheDocument()
    const submit = screen.getByRole("button", { name: /reserve my tickets/i })
    expect(submit).toHaveAttribute("aria-disabled", "true")
  })
})

describe("RegistrationForm attendee-scoped required consent", () => {
  const consentProps = {
    ...baseProps,
    ticketTypes: [{ id: 1, name: "Adult", price: 0, capacity: null }],
    customQuestions: [
      {
        id: "q1",
        label: "Waiver",
        type: "consent" as const,
        required: true,
        scope: "attendee" as const,
        statements: ["I understand the risks"],
      },
    ],
  }

  it("keeps the attendee-question blocker when a statement box is ticked but the final agree box is not", () => {
    render(<RegistrationForm {...consentProps} />)
    fireEvent.click(screen.getByLabelText(/Increase Adult quantity/i))
    fireEvent.change(screen.getByPlaceholderText(/full name/i), { target: { value: "Jane Doe" } })
    // Index 0 = the statement checkbox, index 1 = the final "I agree" box —
    // tick only the statement, leaving consent un-accepted overall.
    fireEvent.click(screen.getAllByRole("checkbox")[0])
    expect(screen.getByText(/Complete the required attendee questions/i)).toBeInTheDocument()
  })

  it("clears the blocker once every statement and the final agree box are ticked", () => {
    render(<RegistrationForm {...consentProps} />)
    fireEvent.click(screen.getByLabelText(/Increase Adult quantity/i))
    fireEvent.change(screen.getByPlaceholderText(/full name/i), { target: { value: "Jane Doe" } })
    screen.getAllByRole("checkbox").forEach((cb) => fireEvent.click(cb))
    expect(screen.queryByText(/Complete the required attendee questions/i)).toBeNull()
  })
})

describe("RegistrationForm mobile & conversion polish", () => {
  it("gives the registrant fields autofill + keyboard hints", () => {
    render(<RegistrationForm {...baseProps} />)
    expect(screen.getByLabelText(/First name/i)).toHaveAttribute("autoComplete", "given-name")
    expect(screen.getByLabelText(/Last name/i)).toHaveAttribute("autoComplete", "family-name")
    const emailInput = screen.getByLabelText(/^Email/i)
    expect(emailInput).toHaveAttribute("autoComplete", "email")
    expect(emailInput).toHaveAttribute("inputMode", "email")
    const phoneInput = screen.getByLabelText(/Phone/i)
    expect(phoneInput).toHaveAttribute("autoComplete", "tel")
    expect(phoneInput).toHaveAttribute("inputMode", "tel")
  })

  it("keeps the total+submit footer sticky on mobile, static on desktop", () => {
    render(<RegistrationForm {...baseProps} />)
    const submit = screen.getByRole("button", { name: /reserve my tickets/i })
    const footer = submit.closest("div.mt-auto")
    expect(footer).toHaveClass("sticky", "bottom-0", "md:static")
  })

  it("gives payment-method radio rows a 44px tap target", () => {
    const paidProps = { ...baseProps, ticketTypes: [{ id: 1, name: "Adult", price: 10, capacity: null }] }
    render(<RegistrationForm {...paidProps} onlinePaymentEnabled stripeConfigured />)
    fireEvent.click(screen.getByLabelText(/Increase Adult quantity/i))
    const cardLabel = screen.getByLabelText(/pay now by card/i).closest("label")
    expect(cardLabel).toHaveClass("min-h-11")
  })
})
