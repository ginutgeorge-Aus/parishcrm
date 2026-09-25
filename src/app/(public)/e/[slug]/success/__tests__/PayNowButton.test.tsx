import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PayNowButton } from "../PayNowButton"

jest.mock("@/lib/actions/eventCheckout", () => ({ startExistingRegistrationCheckout: jest.fn() }))
import { startExistingRegistrationCheckout } from "@/lib/actions/eventCheckout"
const mStart = startExistingRegistrationCheckout as jest.Mock

// jsdom 26 (jest-environment-jsdom 30) made `window.location` non-configurable —
// Object.defineProperty/delete on it both throw, and a raw assignment silently
// no-ops (jsdom logs "Not implemented: navigation", never updating the value).
// So the redirect is asserted through the mockable `navigateTo` wrapper instead
// of `window.location.href` directly.
jest.mock("@/lib/navigate", () => ({ navigateTo: jest.fn() }))
import { navigateTo } from "@/lib/navigate"
const mNavigate = navigateTo as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

it("shows the card-fee note only when passCardFee is set", () => {
  const { rerender } = render(<PayNowButton slug="fete" publicToken="tok-42" passCardFee={false} />)
  expect(screen.queryByText(/card processing fee/i)).not.toBeInTheDocument()
  rerender(<PayNowButton slug="fete" publicToken="tok-42" passCardFee={true} />)
  expect(screen.getByText(/card processing fee/i)).toBeInTheDocument()
})

it("redirects to the Stripe URL on success", async () => {
  mStart.mockResolvedValue({ ok: true, url: "https://stripe.test/pay" })
  render(<PayNowButton slug="fete" publicToken="tok-42" passCardFee={false} />)
  await userEvent.click(screen.getByRole("button", { name: /pay now by card/i }))
  expect(mStart).toHaveBeenCalledWith("fete", "tok-42")
  expect(mNavigate).toHaveBeenCalledWith("https://stripe.test/pay")
})

it("surfaces an error message when the action fails", async () => {
  mStart.mockResolvedValue({ ok: false, status: 400, error: "Online payment unavailable" })
  render(<PayNowButton slug="fete" publicToken="tok-42" passCardFee={false} />)
  await userEvent.click(screen.getByRole("button", { name: /pay now by card/i }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Online payment unavailable")
})
