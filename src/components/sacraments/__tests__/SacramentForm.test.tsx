import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const push = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, back: jest.fn() }) }))

const searchSacramentPeople = jest.fn()
jest.mock("@/lib/actions/sacrament", () => ({ searchSacramentPeople: (q: string) => searchSacramentPeople(q) }))

import { SacramentForm, type SacramentFormValues } from "@/components/sacraments/SacramentForm"

const RECORD: SacramentFormValues = {
  type: "BAPTISM",
  registerNo: "BAP-2026-003",
  date: "2026-03-01",
  place: "St Mark",
  ministerName: null,
  spouse: null,
  spouseName: null,
  godparents: "Jane Roe",
  notes: null,
  updatedAt: "2026-03-02T00:00:00.000Z",
}

beforeEach(() => jest.clearAllMocks())

describe("SacramentForm", () => {
  it("create: shows the spouse field only for a marriage and posts the person", async () => {
    const action = jest.fn().mockResolvedValue(undefined)
    const { container } = render(<SacramentForm personId={8} action={action} />)
    expect(screen.queryByLabelText("Spouse name")).toBeNull()
    expect(container.querySelector('input[name="personId"]')).toHaveValue("8")
    await userEvent.selectOptions(screen.getByLabelText("Sacrament"), "MARRIAGE")
    expect(screen.getByLabelText(/spouse is not in the CRM/)).toBeInTheDocument()
    expect(screen.getByLabelText("Search for the spouse")).toBeInTheDocument()
  })

  it("edit: the rite is read-only and updatedAt rides along", () => {
    const { container } = render(<SacramentForm record={RECORD} action={jest.fn()} />)
    expect(screen.queryByLabelText("Sacrament")).toBeNull()
    expect(screen.getByText(/BAP-2026-003/)).toBeInTheDocument()
    expect(container.querySelector('input[name="updatedAt"]')).toHaveValue(RECORD.updatedAt)
    expect(screen.getByLabelText(/Godparents/)).toHaveValue("Jane Roe")
  })

  it("edit: a linked CRM spouse is kept as a hidden id, not a typed name", () => {
    const { container } = render(
      <SacramentForm
        record={{ ...RECORD, type: "MARRIAGE", spouse: { id: 12, firstName: "Sam", lastName: "Other" } }}
        action={jest.fn()}
      />,
    )
    expect(container.querySelector('input[name="spouseId"]')).toHaveValue("12")
    expect(screen.queryByLabelText(/spouse is not in the CRM/)).toBeNull()
    expect(screen.getByText(/Sam Other/)).toBeInTheDocument()
  })

  it("edit: Change drops the linked spouse so another can be picked", async () => {
    const { container } = render(
      <SacramentForm
        record={{ ...RECORD, type: "MARRIAGE", spouse: { id: 12, firstName: "Sam", lastName: "Other" } }}
        action={jest.fn()}
      />,
    )
    await userEvent.click(screen.getByRole("button", { name: "Change" }))
    expect(container.querySelector('input[name="spouseId"]')).toBeNull()
    expect(screen.getByLabelText("Search for the spouse")).toBeInTheDocument()
  })

  it("picking a member from the search sets spouseId and submits it without a typed name", async () => {
    searchSacramentPeople.mockResolvedValue([{ id: 31, name: "Sam Other", familyName: "Other Family" }])
    const action = jest.fn().mockResolvedValue({ error: "stop" })
    render(<SacramentForm personId={8} defaultType="MARRIAGE" action={action} />)
    await userEvent.type(screen.getByLabelText("Search for the spouse"), "sam{enter}")
    expect(searchSacramentPeople).toHaveBeenCalledWith("sam")
    await userEvent.click(await screen.findByRole("button", { name: /Sam Other/ }))
    await userEvent.type(screen.getByLabelText("Place"), "St Mark")
    await userEvent.type(screen.getByLabelText("Date"), "2026-03-01")
    await userEvent.click(screen.getByRole("button", { name: "Add to register" }))
    await screen.findByText("stop")
    const fd = action.mock.calls[0][1] as FormData
    expect(fd.get("spouseId")).toBe("31")
    expect(fd.get("spouseName")).toBeNull()
  })

  it("keeps what was typed when the save fails", async () => {
    const action = jest.fn().mockResolvedValue({ error: "The date cannot be in the future." })
    render(<SacramentForm personId={8} action={action} />)
    await userEvent.type(screen.getByLabelText("Place"), "St Mark")
    await userEvent.type(screen.getByLabelText("Date"), "2026-03-01")
    await userEvent.type(screen.getByLabelText(/Godparents/), "Jane Roe")
    await userEvent.type(screen.getByLabelText(/Notes/), "keep me")
    await userEvent.click(screen.getByRole("button", { name: "Add to register" }))
    await screen.findByText("The date cannot be in the future.")
    expect(screen.getByLabelText("Place")).toHaveValue("St Mark")
    expect(screen.getByLabelText("Date")).toHaveValue("2026-03-01")
    expect(screen.getByLabelText(/Godparents/)).toHaveValue("Jane Roe")
    expect(screen.getByLabelText(/Notes/)).toHaveValue("keep me")
  })

  it("opens the new entry after a successful create", async () => {
    const action = jest.fn().mockResolvedValue({ id: 41, registerNo: "BAP-2026-014" })
    render(<SacramentForm personId={8} action={action} />)
    await userEvent.type(screen.getByLabelText("Place"), "St Mark")
    await userEvent.type(screen.getByLabelText("Date"), "2026-03-01")
    await userEvent.click(screen.getByRole("button", { name: "Add to register" }))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sacraments/41"))
    // Stays disabled after a successful create: a double click must not number a second entry.
    expect(screen.getByRole("button", { name: "Add to register" })).toBeDisabled()
    expect(action).toHaveBeenCalledTimes(1)
  })
})
