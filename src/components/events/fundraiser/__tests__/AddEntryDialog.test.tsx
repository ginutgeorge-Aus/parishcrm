/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import { AddEntryDialog } from "@/components/events/fundraiser/AddEntryDialog"
import { addEntry, searchFundraiserFamilies } from "@/lib/actions/fundraiser"

jest.mock("@/lib/actions/fundraiser", () => ({ addEntry: jest.fn(), searchFundraiserFamilies: jest.fn() }))

const families = [{ id: 7, name: "Example Family" }, { id: 8, name: "Sample Family" }]
const search = searchFundraiserFamilies as jest.Mock

/** Render the dialog and open it. */
function openDialog() {
  render(<AddEntryDialog fundraiserId={3} />)
  fireEvent.click(screen.getByRole("button", { name: "Add entry" }))
}

/** The in-dialog submit button (the trigger is hidden while the dialog is open). */
const submitBtn = () => screen.getByRole("button", { name: /^(Add entry|Adding\.\.\.)$/ })
/** The dialog's form. */
const theForm = () => submitBtn().closest("form")!

/**
 * Type into the family search and pick a result.
 * @param query - Text typed into the search box.
 * @param name - Result to click.
 */
async function pickFamily(query: string, name: string) {
  fireEvent.change(screen.getByLabelText("Family"), { target: { value: query } })
  fireEvent.click(await screen.findByRole("button", { name }))
}

beforeEach(() => {
  jest.clearAllMocks()
  search.mockResolvedValue({ families })
})

describe("AddEntryDialog", () => {
  it("renders closed until the trigger is clicked, and loads no family list up front", () => {
    render(<AddEntryDialog fundraiserId={3} />)
    expect(screen.queryByLabelText("Family")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }))
    expect(screen.getByLabelText("Family")).toBeInTheDocument()
    expect(search).not.toHaveBeenCalled()
  })

  it("does not search for fewer than 2 characters", async () => {
    openDialog()
    fireEvent.change(screen.getByLabelText("Family"), { target: { value: "S" } })
    await act(() => new Promise((r) => setTimeout(r, 400)))
    expect(search).not.toHaveBeenCalled()
  })

  it("searches the server as the user types and submits the picked family", async () => {
    ;(addEntry as jest.Mock).mockResolvedValue(undefined)
    openDialog()
    await pickFamily("Sam", "Sample Family")
    expect(search).toHaveBeenCalledWith(3, "Sam")
    // The label still points at a real control once a family is picked.
    expect(screen.getByLabelText("Family")).toHaveValue("Sample Family")
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "4" } })
    fireEvent.submit(theForm())
    await waitFor(() => expect(addEntry).toHaveBeenCalledWith(3, { familyId: 8, quantity: "4" }))
    await waitFor(() => expect(screen.queryByLabelText("Quantity")).toBeNull())
  })

  it("ignores an out-of-order (stale) search response", async () => {
    let resolveOld: (v: unknown) => void = () => {}
    search
      .mockImplementationOnce(() => new Promise((r) => { resolveOld = r }))
      .mockResolvedValueOnce({ families: [{ id: 8, name: "Sample Family" }] })
    openDialog()
    fireEvent.change(screen.getByLabelText("Family"), { target: { value: "Ex" } })
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByLabelText("Family"), { target: { value: "Sam" } })
    expect(await screen.findByRole("button", { name: "Sample Family" })).toBeInTheDocument()
    await act(async () => { resolveOld({ families: [{ id: 7, name: "Example Family" }] }) })
    expect(screen.queryByRole("button", { name: "Example Family" })).toBeNull()
  })

  it("shows a refine hint when the result cap is reached", async () => {
    search.mockResolvedValue({ families: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Fam ${i + 1}` })) })
    openDialog()
    fireEvent.change(screen.getByLabelText("Family"), { target: { value: "Fam" } })
    expect(await screen.findByText(/Showing the first 20 matches/)).toBeInTheDocument()
  })

  it("shows a no-match message", async () => {
    search.mockResolvedValue({ families: [] })
    openDialog()
    fireEvent.change(screen.getByLabelText("Family"), { target: { value: "Zz" } })
    expect(await screen.findByText(/No matching family/)).toBeInTheDocument()
  })

  it("shows a search error when the search action throws", async () => {
    search.mockRejectedValue(new Error("boom"))
    openDialog()
    fireEvent.change(screen.getByLabelText("Family"), { target: { value: "Sam" } })
    expect(await screen.findByText("Search failed. Please try again.")).toBeInTheDocument()
  })

  it("Enter in the search box does not submit the form", () => {
    openDialog()
    const input = screen.getByLabelText("Family")
    fireEvent.change(input, { target: { value: "Sam" } })
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    input.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(addEntry).not.toHaveBeenCalled()
  })

  it("a pending search cannot repopulate results after a pick", async () => {
    let resolveSlow: (v: unknown) => void = () => {}
    search
      .mockResolvedValueOnce({ families })
      .mockImplementationOnce(() => new Promise((r) => { resolveSlow = r }))
    openDialog()
    await pickFamily("Sam", "Sample Family")
    fireEvent.click(screen.getByRole("button", { name: "Change" }))
    // Type again (search in flight), then pick from the still-shown old list.
    fireEvent.change(screen.getByLabelText("Family"), { target: { value: "Exa" } })
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole("button", { name: "Example Family" }))
    await act(async () => { resolveSlow({ families: [{ id: 9, name: "Late Family" }] }) })
    expect(screen.getByLabelText("Family")).toHaveValue("Example Family")
    // Re-opening the search must not show the late response either.
    fireEvent.click(screen.getByRole("button", { name: "Change" }))
    expect(screen.queryByRole("button", { name: "Late Family" })).toBeNull()
  })

  it("lets the user change the picked family", async () => {
    openDialog()
    await pickFamily("Sam", "Sample Family")
    fireEvent.click(screen.getByRole("button", { name: "Change" }))
    expect(screen.getByLabelText("Family")).toBeInTheDocument()
  })

  it("asks for a family instead of submitting when none is picked", async () => {
    openDialog()
    fireEvent.submit(theForm())
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a family")
    expect(addEntry).not.toHaveBeenCalled()
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
    ;(addEntry as jest.Mock).mockResolvedValue({ error: "Already on this fundraiser" })
    openDialog()
    await pickFamily("Ex", "Example Family")
    fireEvent.submit(theForm())
    expect(await screen.findByRole("alert")).toHaveTextContent("Already on this fundraiser")
    expect(screen.getByLabelText("Quantity")).toBeInTheDocument()
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
    await pickFamily("Sam", "Sample Family")
    fireEvent.submit(theForm())
    expect(await screen.findByText("Could not add the entry. Please try again.")).toBeInTheDocument()
  })
})
