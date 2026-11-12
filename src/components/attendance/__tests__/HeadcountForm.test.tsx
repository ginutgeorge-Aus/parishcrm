import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { HeadcountForm } from "../HeadcountForm"

jest.mock("@/lib/actions/attendance", () => ({
  saveHeadcount: jest.fn(),
  deleteHeadcount: jest.fn(),
}))

import { deleteHeadcount, saveHeadcount } from "@/lib/actions/attendance"

const save = saveHeadcount as jest.Mock
const del = deleteHeadcount as jest.Mock

const types = [
  { id: 1, name: "Sunday Service" },
  { id: 2, name: "Evening" },
]
const rows = [
  { id: 7, date: "2026-11-08", serviceTypeId: 2, serviceTypeName: "Evening", adults: 30, children: 4, notes: "wet day" },
  { id: 6, date: "2026-11-08", serviceTypeId: 1, serviceTypeName: "Sunday Service", adults: 80, children: 20, notes: null },
]

beforeEach(() => {
  jest.clearAllMocks()
  save.mockResolvedValue(undefined)
  del.mockResolvedValue(undefined)
})

describe("HeadcountForm", () => {
  it("defaults the date to today and shows a live total", async () => {
    render(<HeadcountForm serviceTypes={types} rows={[]} today="2026-11-12" />)
    expect(screen.getByLabelText("Service date")).toHaveValue("2026-11-12")
    expect(screen.getByTestId("total")).toHaveTextContent("0")
    await userEvent.click(screen.getByRole("button", { name: "Increase Adults" }))
    await userEvent.click(screen.getByRole("button", { name: "Increase Adults" }))
    await userEvent.click(screen.getByRole("button", { name: "Increase Children" }))
    expect(screen.getByTestId("total")).toHaveTextContent("3")
  })

  it("submits saveHeadcount with the entered values", async () => {
    render(<HeadcountForm serviceTypes={types} rows={[]} today="2026-11-12" />)
    await userEvent.selectOptions(screen.getByLabelText("Service"), "2")
    const adults = screen.getByLabelText("Adults")
    await userEvent.clear(adults)
    await userEvent.type(adults, "45")
    await userEvent.click(screen.getByRole("button", { name: "Increase Children" }))
    await userEvent.click(screen.getByRole("button", { name: "Save headcount" }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        date: "2026-11-12",
        serviceTypeId: 2,
        adults: 45,
        children: 1,
        notes: "",
      }),
    )
    expect(await screen.findByRole("status")).toHaveTextContent("Saved")
  })

  it("shows the action error", async () => {
    save.mockResolvedValue({ error: "Date cannot be in the future" })
    render(<HeadcountForm serviceTypes={types} rows={[]} today="2026-11-12" />)
    await userEvent.click(screen.getByRole("button", { name: "Save headcount" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Date cannot be in the future")
  })

  it("pre-fills counts when the date + service already has a row (edit mode)", async () => {
    render(<HeadcountForm serviceTypes={types} rows={rows} today="2026-11-08" />)
    // default service is the first active type (id 1) on 2026-11-08 -> row 6
    expect(screen.getByLabelText("Adults")).toHaveValue("80")
    expect(screen.getByLabelText("Children")).toHaveValue("20")
    expect(screen.getByText(/editing an existing headcount/i)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText("Service"), "2")
    expect(screen.getByLabelText("Adults")).toHaveValue("30")
    expect(screen.getByLabelText("Notes")).toHaveValue("wet day")
  })

  it("resets counts to 0 when switching to a pair with no row", async () => {
    render(<HeadcountForm serviceTypes={types} rows={rows} today="2026-11-08" />)
    const date = screen.getByLabelText("Service date")
    await userEvent.clear(date)
    await userEvent.type(date, "2026-11-01")
    expect(screen.getByLabelText("Adults")).toHaveValue("0")
    expect(screen.queryByText(/editing an existing headcount/i)).not.toBeInTheDocument()
  })

  it("shows an empty state, not a form, with no active service types", () => {
    render(<HeadcountForm serviceTypes={[]} rows={[]} today="2026-11-12" />)
    expect(screen.getByText(/no active service types/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Save headcount" })).not.toBeInTheDocument()
  })

  it("edit on a recent row loads it into the form", async () => {
    render(<HeadcountForm serviceTypes={types} rows={rows} today="2026-11-12" />)
    expect(screen.getByLabelText("Adults")).toHaveValue("0")
    await userEvent.click(screen.getAllByRole("button", { name: /^Edit Evening/ })[0])
    expect(screen.getByLabelText("Service date")).toHaveValue("2026-11-08")
    expect(screen.getByLabelText("Adults")).toHaveValue("30")
  })

  it("delete asks to confirm, then calls deleteHeadcount", async () => {
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(true)
    render(<HeadcountForm serviceTypes={types} rows={rows} today="2026-11-12" />)
    await userEvent.click(screen.getAllByRole("button", { name: /^Delete Evening/ })[0])
    expect(confirm).toHaveBeenCalled()
    await waitFor(() => expect(del).toHaveBeenCalledWith(7))
    confirm.mockRestore()
  })

  it("delete does nothing when not confirmed", async () => {
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(false)
    render(<HeadcountForm serviceTypes={types} rows={rows} today="2026-11-12" />)
    await userEvent.click(screen.getAllByRole("button", { name: /^Delete Evening/ })[0])
    expect(del).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
})
