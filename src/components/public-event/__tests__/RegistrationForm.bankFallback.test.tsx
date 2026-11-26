/** @jest-environment node */
import { renderToStaticMarkup } from "react-dom/server"
import { RegistrationForm } from "../RegistrationForm"

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }))

const props = {
  slug: "s",
  ticketTypes: [{ id: 1, name: "Adult", price: 10, capacity: 10 }],
  soldCounts: {},
  customQuestions: [],
  allSoldOut: false,
  formToken: "t",
}

describe("RegistrationForm bank fallback", () => {
  it("promises bank details when the event has them (default)", () => {
    const html = renderToStaticMarkup(<RegistrationForm {...props} />)
    expect(html).toContain("Bank transfer details shown on next page")
  })
  it("blank bank, no card: office-will-send, no bank promise", () => {
    const html = renderToStaticMarkup(<RegistrationForm {...props} hasBankDetails={false} />)
    expect(html).not.toContain("Bank transfer details")
    expect(html).toContain("The church office will send you payment details.")
  })
  it("blank bank, card on: no bank wording and no office-will-send promise", () => {
    const html = renderToStaticMarkup(
      <RegistrationForm {...props} hasBankDetails={false} onlinePaymentEnabled stripeConfigured />,
    )
    expect(html).not.toContain("ank transfer")
    expect(html).not.toContain("The church office will send you payment details.")
  })
})
