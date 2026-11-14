import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const push = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, back: jest.fn() }) }))

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

describe("SacramentForm", () => {
  it("create: shows the spouse field only for a marriage and posts the person", async () => {
    const action = jest.fn().mockResolvedValue(undefined)
    const { container } = render(<SacramentForm personId={8} action={action} />)
    expect(screen.queryByLabelText("Spouse name")).toBeNull()
    expect(container.querySelector('input[name="personId"]')).toHaveValue("8")
    await userEvent.selectOptions(screen.getByLabelText("Sacrament"), "MARRIAGE")
    expect(screen.getByLabelText("Spouse name")).toBeRequired()
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
    expect(screen.queryByLabelText("Spouse name")).toBeNull()
    expect(screen.getByText(/Sam Other/)).toBeInTheDocument()
  })

  it("opens the new entry after a successful create", async () => {
    const action = jest.fn().mockResolvedValue({ id: 41, registerNo: "BAP-2026-014" })
    render(<SacramentForm personId={8} action={action} />)
    await userEvent.type(screen.getByLabelText("Place"), "St Mark")
    await userEvent.type(screen.getByLabelText("Date"), "2026-03-01")
    await userEvent.click(screen.getByRole("button", { name: "Add to register" }))
    await screen.findByRole("button", { name: "Add to register" })
    expect(push).toHaveBeenCalledWith("/sacraments/41")
  })
})
