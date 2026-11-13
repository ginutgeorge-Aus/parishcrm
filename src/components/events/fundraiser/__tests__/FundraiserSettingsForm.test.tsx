import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { FundraiserSettingsForm } from "@/components/events/fundraiser/FundraiserSettingsForm"
import { saveFundraiser } from "@/lib/actions/fundraiser"

jest.mock("@/lib/actions/fundraiser", () => ({ saveFundraiser: jest.fn() }))

beforeEach(() => jest.clearAllMocks())

describe("FundraiserSettingsForm", () => {
  it("sends the delivery price when entered and prefills it", async () => {
    ;(saveFundraiser as jest.Mock).mockResolvedValue(undefined)
    render(<FundraiserSettingsForm eventId={5} initial={{ name: "Raffle", unitLabel: "ticket", unitPrice: "10.00", deliveryPrice: "12.00", refPrefix: null }} />)
    expect((screen.getByLabelText("Delivery price") as HTMLInputElement).value).toBe("12.00")
    fireEvent.change(screen.getByLabelText("Delivery price"), { target: { value: "15.00" } })
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }))
    await waitFor(() => expect(saveFundraiser).toHaveBeenCalledWith(5, expect.objectContaining({ unitPrice: "10.00", deliveryPrice: "15.00" })))
  })

  it("creates a fundraiser from empty fields", async () => {
    ;(saveFundraiser as jest.Mock).mockResolvedValue({ success: "ok" })
    render(<FundraiserSettingsForm eventId={5} />)
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sample Raffle" } })
    fireEvent.change(screen.getByLabelText("Unit label"), { target: { value: "ticket" } })
    fireEvent.change(screen.getByLabelText("Pickup price"), { target: { value: "10.00" } })
    fireEvent.change(screen.getByLabelText("Bank ref prefix"), { target: { value: "RAF" } })
    fireEvent.click(screen.getByRole("button", { name: "Create fundraiser" }))
    await waitFor(() => expect(saveFundraiser).toHaveBeenCalledWith(5, {
      name: "Sample Raffle", unitLabel: "ticket", unitPrice: "10.00", refPrefix: "RAF",
    }))
    expect(await screen.findByText("Saved")).toBeInTheDocument()
  })

  it("prefills initial values and shows server error", async () => {
    ;(saveFundraiser as jest.Mock).mockResolvedValue({ error: "Bad price" })
    render(<FundraiserSettingsForm eventId={5} initial={{ name: "Gala", unitLabel: "seat", unitPrice: "25.00", refPrefix: null }} />)
    expect(screen.getByLabelText("Name")).toHaveValue("Gala")
    expect(screen.getByLabelText("Bank ref prefix")).toHaveValue("")
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Bad price")
  })
})

describe("FundraiserSettingsForm prefix normalisation", () => {
  it("shows the normalised prefix after a successful save", async () => {
    ;(saveFundraiser as jest.Mock).mockResolvedValue({ success: "ok" })
    render(<FundraiserSettingsForm eventId={5} initial={{ name: "Gala", unitLabel: "seat", unitPrice: "25.00", refPrefix: null }} />)
    fireEvent.change(screen.getByLabelText("Bank ref prefix"), { target: { value: "ra-f 1" } })
    fireEvent.submit(screen.getByLabelText("Bank ref prefix").closest("form")!)
    await waitFor(() => expect(screen.getByLabelText("Bank ref prefix")).toHaveValue("RAF1"))
  })
})
