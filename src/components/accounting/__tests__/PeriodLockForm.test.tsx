import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { PeriodLockForm } from "@/components/accounting/PeriodLockForm"
import { setAccountingLockDate } from "@/lib/actions/accountingSettings"

jest.mock("@/lib/actions/accountingSettings", () => ({ setAccountingLockDate: jest.fn() }))

beforeEach(() => jest.clearAllMocks())

it("does not lock on the first click; confirm names the date; saves after confirming", async () => {
  ;(setAccountingLockDate as jest.Mock).mockResolvedValue({ success: "Saved" })
  render(<PeriodLockForm currentLockDate={null} />)
  fireEvent.change(screen.getByLabelText("Lock date"), { target: { value: "2026-06-30" } })
  fireEvent.click(screen.getByRole("button", { name: "Save" }))
  const dialog = await screen.findByRole("alertdialog")
  expect(dialog).toHaveTextContent("30 Jun 2026")
  expect(setAccountingLockDate).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole("button", { name: "Lock" }))
  await waitFor(() => expect(setAccountingLockDate).toHaveBeenCalledTimes(1))
  const fd = (setAccountingLockDate as jest.Mock).mock.calls[0][1] as FormData
  expect(fd.get("date")).toBe("2026-06-30")
})

it("clearing the lock saves at once with no confirm", async () => {
  ;(setAccountingLockDate as jest.Mock).mockResolvedValue({ success: "Saved" })
  render(<PeriodLockForm currentLockDate="2026-06-30" />)
  fireEvent.change(screen.getByLabelText("Lock date"), { target: { value: "" } })
  fireEvent.click(screen.getByRole("button", { name: "Save" }))
  await waitFor(() => expect(setAccountingLockDate).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole("alertdialog")).toBeNull()
})
