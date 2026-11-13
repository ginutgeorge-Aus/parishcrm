/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AddEntryDialog } from "@/components/events/fundraiser/AddEntryDialog"
import { addEntry } from "@/lib/actions/fundraiser"

jest.mock("@/lib/actions/fundraiser", () => ({ addEntry: jest.fn() }))

const families = [{ id: 7, name: "Example Family" }, { id: 8, name: "Sample Family" }]

/** Render the dialog and open it. */
function openDialog() {
  render(<AddEntryDialog fundraiserId={3} families={families} />)
  fireEvent.click(screen.getByRole("button", { name: "Add entry" }))
}

/** The in-dialog submit button (the trigger is hidden while the dialog is open). */
const submitBtn = () => screen.getByRole("button", { name: /^(Add entry|Adding\.\.\.)$/ })

beforeEach(() => jest.clearAllMocks())

describe("AddEntryDialog", () => {
  it("renders closed until the trigger is clicked", () => {
    render(<AddEntryDialog fundraiserId={3} families={families} />)
    expect(screen.queryByLabelText("Family")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }))
    expect(screen.getByLabelText("Family")).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Example Family" })).toBeInTheDocument()
  })

  it("submits a member entry and closes", async () => {
    ;(addEntry as jest.Mock).mockResolvedValue({ success: "ok" })
    openDialog()
    fireEvent.change(screen.getByLabelText("Family"), { target: { value: "8" } })
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "4" } })
    fireEvent.submit(screen.getByLabelText("Family").closest("form")!)
    await waitFor(() => expect(addEntry).toHaveBeenCalledWith(3, { familyId: 8, quantity: "4" }))
    await waitFor(() => expect(screen.queryByLabelText("Family")).toBeNull())
  })

  it("sends undefined familyId when none selected", async () => {
    ;(addEntry as jest.Mock).mockResolvedValue({ error: "Select a family" })
    openDialog()
    fireEvent.submit(screen.getByLabelText("Family").closest("form")!)
    await waitFor(() => expect(addEntry).toHaveBeenCalledWith(3, { familyId: undefined, quantity: "1" }))
  })

  it("submits an outside buyer", async () => {
    ;(addEntry as jest.Mock).mockResolvedValue(undefined)
    openDialog()
    fireEvent.click(screen.getByRole("button", { name: "Outside buyer" }))
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sample Buyer" } })
    fireEvent.change(screen.getByLabelText("Email (optional)"), { target: { value: "buyer@example.com" } })
    fireEvent.change(screen.getByLabelText("Phone (optional)"), { target: { value: "0400000000" } })
    fireEvent.click(submitBtn())
    await waitFor(() => expect(addEntry).toHaveBeenCalledWith(3, {
      outsideName: "Sample Buyer", outsideEmail: "buyer@example.com", outsidePhone: "0400000000", quantity: "1",
    }))
  })

  it("shows server error and keeps dialog open", async () => {
    ;(addEntry as jest.Mock).mockResolvedValue({ error: "Family already has an entry" })
    openDialog()
    fireEvent.change(screen.getByLabelText("Family"), { target: { value: "7" } })
    fireEvent.submit(screen.getByLabelText("Family").closest("form")!)
    expect(await screen.findByRole("alert")).toHaveTextContent("Family already has an entry")
    expect(screen.getByLabelText("Family")).toBeInTheDocument()
  })

  it("switches back to member mode", () => {
    openDialog()
    fireEvent.click(screen.getByRole("button", { name: "Outside buyer" }))
    expect(screen.queryByLabelText("Family")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Member" }))
    expect(screen.getByLabelText("Family")).toBeInTheDocument()
  })

  it("closes on Escape without submitting", async () => {
    openDialog()
    fireEvent.keyDown(screen.getByLabelText("Family"), { key: "Escape" })
    await waitFor(() => expect(screen.queryByLabelText("Family")).toBeNull())
    expect(addEntry).not.toHaveBeenCalled()
  })
})

describe("AddEntryDialog thrown action", () => {
  it("shows a generic error when the action throws", async () => {
    ;(addEntry as jest.Mock).mockRejectedValue(new Error("boom"))
    openDialog()
    fireEvent.change(screen.getByLabelText("Family"), { target: { value: "8" } })
    fireEvent.submit(screen.getByLabelText("Family").closest("form")!)
    expect(await screen.findByText("Could not add the entry. Please try again.")).toBeInTheDocument()
  })

  it("hides the Pickup/Delivery select without a delivery price", () => {
    openDialog()
    expect(screen.queryByLabelText("Pickup or delivery")).toBeNull()
  })

  it("shows the select with a delivery price and sends delivery", async () => {
    ;(addEntry as jest.Mock).mockResolvedValue(undefined)
    render(<AddEntryDialog fundraiserId={3} families={families} hasDelivery />)
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }))
    expect((screen.getByLabelText("Pickup or delivery") as HTMLSelectElement).value).toBe("pickup")
    fireEvent.change(screen.getByLabelText("Family"), { target: { value: "8" } })
    fireEvent.change(screen.getByLabelText("Pickup or delivery"), { target: { value: "delivery" } })
    fireEvent.submit(screen.getByLabelText("Family").closest("form")!)
    await waitFor(() => expect(addEntry).toHaveBeenCalledWith(3, { familyId: 8, quantity: "1", delivery: true }))
  })
})
