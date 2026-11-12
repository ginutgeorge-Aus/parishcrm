import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PayRemainingButton } from "../PayRemainingButton"
import { startFundraiserCheckout } from "@/lib/actions/eventCheckout"
import { navigateTo } from "@/lib/navigate"

jest.mock("@/lib/actions/eventCheckout", () => ({ startFundraiserCheckout: jest.fn() }))
jest.mock("@/lib/navigate", () => ({ navigateTo: jest.fn() }))

beforeEach(() => jest.clearAllMocks())

describe("PayRemainingButton", () => {
  it("redirects to checkout on success and shows the fee label", async () => {
    ;(startFundraiserCheckout as jest.Mock).mockResolvedValue({ ok: true, url: "https://checkout.example.com/s" })
    render(<PayRemainingButton publicToken="tok123" feeLabel="$1.20" />)
    expect(screen.getByText("A card processing fee of $1.20 applies.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Pay remaining by card" }))
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith("https://checkout.example.com/s"))
    expect(startFundraiserCheckout).toHaveBeenCalledWith("tok123")
  })

  it("shows the error and no fee note when checkout fails", async () => {
    ;(startFundraiserCheckout as jest.Mock).mockResolvedValue({ ok: false, error: "Nothing owing" })
    render(<PayRemainingButton publicToken="tok123" feeLabel={null} />)
    expect(screen.queryByText(/processing fee/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Pay remaining by card" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing owing")
    expect(navigateTo).not.toHaveBeenCalled()
  })
})
