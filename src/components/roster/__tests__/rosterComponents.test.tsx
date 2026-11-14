import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const refresh = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: jest.fn() }), unstable_rethrow: jest.fn() }))
jest.mock("@/lib/actions/roster", () => ({
  assignToRosterSlot: jest.fn(),
  suggestRosterAssignees: jest.fn(),
  unassignRosterAssignment: jest.fn(),
  addRosterSlot: jest.fn(),
}))
jest.mock("@/lib/actions/personUnavailability", () => ({ addPersonUnavailability: jest.fn(), removePersonUnavailability: jest.fn() }))
jest.mock("@/lib/actions/rosterFeed", () => ({ rotateRosterFeedToken: jest.fn() }))

import { SlotCell } from "@/components/roster/SlotCell"
import { AddSlotForm } from "@/components/roster/AddSlotForm"
import { PersonRosterCard } from "@/components/roster/PersonRosterCard"
import * as roster from "@/lib/actions/roster"
import * as unavail from "@/lib/actions/personUnavailability"
import * as feed from "@/lib/actions/rosterFeed"

const r = roster as unknown as Record<string, jest.Mock>
const u = unavail as unknown as Record<string, jest.Mock>
const f = feed as unknown as Record<string, jest.Mock>

beforeEach(() => jest.clearAllMocks())

describe("SlotCell", () => {
  const people = [{ id: 11, name: "Ann Lee", status: "CONFIRMED" as const }]

  it("loads conflict-free suggestions on focus and assigns the pick", async () => {
    r.suggestRosterAssignees.mockResolvedValue({ suggestions: [
      { personId: 7, firstName: "Bo", lastName: "Kim", lastServedYMD: null },
      { personId: 8, firstName: "Cy", lastName: "Ng", lastServedYMD: "2026-11-01" },
    ] })
    r.assignToRosterSlot.mockResolvedValue({ success: "Person rostered" })
    render(<SlotCell slotId={5} assignments={people} open={1} />)
    expect(screen.getByText("Confirmed")).toBeInTheDocument()
    const select = screen.getByLabelText("Assign a person")
    await userEvent.click(select)
    await screen.findByRole("option", { name: "Bo Kim (never served)" })
    expect(screen.getByRole("option", { name: "Cy Ng (last 2026-11-01)" })).toBeInTheDocument()
    await userEvent.selectOptions(select, "8")
    await waitFor(() => expect(r.assignToRosterSlot).toHaveBeenCalledWith(5, 8))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("shows the action error and does not refresh", async () => {
    r.suggestRosterAssignees.mockResolvedValue({ suggestions: [{ personId: 7, firstName: "Bo", lastName: "Kim", lastServedYMD: null }] })
    r.assignToRosterSlot.mockResolvedValue({ error: "This slot is already full" })
    render(<SlotCell slotId={5} assignments={[]} open={1} />)
    await userEvent.click(screen.getByLabelText("Assign a person"))
    await screen.findByRole("option", { name: /Bo Kim/ })
    await userEvent.selectOptions(screen.getByLabelText("Assign a person"), "7")
    expect(await screen.findByText("This slot is already full")).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it("hides the dropdown when the slot is full and removes a person", async () => {
    r.unassignRosterAssignment.mockResolvedValue({ success: "Person removed from the roster" })
    render(<SlotCell slotId={5} assignments={people} open={0} />)
    expect(screen.queryByLabelText("Assign a person")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Remove Ann Lee" }))
    await waitFor(() => expect(r.unassignRosterAssignment).toHaveBeenCalledWith(11))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it("says so when nobody is available", async () => {
    r.suggestRosterAssignees.mockResolvedValue({ suggestions: [] })
    render(<SlotCell slotId={5} assignments={[]} open={2} />)
    await userEvent.click(screen.getByLabelText("Assign a person"))
    expect(await screen.findByRole("option", { name: "No one available" })).toBeInTheDocument()
  })
})

describe("AddSlotForm", () => {
  it("renders nothing without addable roles", () => {
    const { container } = render(<AddSlotForm serviceId={2} roles={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("adds the chosen role with its default count", async () => {
    r.addRosterSlot.mockResolvedValue({ success: "Slot added" })
    render(<AddSlotForm serviceId={2} roles={[{ id: 4, name: "Usher", defaultCount: 2 }]} />)
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText("Role to add"), "4")
    await userEvent.click(screen.getByRole("button", { name: "Add" }))
    await waitFor(() => expect(r.addRosterSlot).toHaveBeenCalledWith(2, 4, 2))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })
})

describe("PersonRosterCard", () => {
  const rows = [{ id: 31, from: "2026-12-06", to: "2026-12-13" }]

  it("lists ranges, removes one, and adds a new one via the action", async () => {
    u.removePersonUnavailability.mockResolvedValue({ success: "Unavailable dates removed" })
    u.addPersonUnavailability.mockResolvedValue({ success: "Saved. Warning: already rostered at X" })
    render(<PersonRosterCard personId={7} rows={rows} hasFeed={false} />)
    expect(screen.getByText("2026-12-06 to 2026-12-13")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Remove" }))
    await waitFor(() => expect(u.removePersonUnavailability).toHaveBeenCalledWith(31))

    await userEvent.type(screen.getByLabelText("From"), "2026-12-20")
    await userEvent.click(screen.getByRole("button", { name: "Add" }))
    await waitFor(() => expect(u.addPersonUnavailability).toHaveBeenCalled())
    expect(u.addPersonUnavailability.mock.calls[0][0]).toBe(7)
    expect((u.addPersonUnavailability.mock.calls[0][2] as FormData).get("from")).toBe("2026-12-20")
    expect(await screen.findByText(/Warning: already rostered/)).toBeInTheDocument()
  })

  it("shows the new calendar link once, or the error", async () => {
    f.rotateRosterFeedToken.mockResolvedValueOnce({ url: "https://app.example.com/api/roster/feed/tok" })
    render(<PersonRosterCard personId={7} rows={[]} hasFeed />)
    expect(screen.getByText("No unavailable dates recorded.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Create new link" }))
    expect(await screen.findByDisplayValue("https://app.example.com/api/roster/feed/tok")).toBeInTheDocument()
    f.rotateRosterFeedToken.mockResolvedValueOnce({ error: "Unauthorized" })
    await userEvent.click(screen.getByRole("button", { name: "Create new link" }))
    expect(await screen.findByText("Unauthorized")).toBeInTheDocument()
    expect(screen.queryByDisplayValue(/api\/roster\/feed/)).not.toBeInTheDocument()
  })
})
