import { render, screen, fireEvent, act, within } from "@testing-library/react"
import { RollList } from "@/components/sunday-school/RollList"

jest.mock("@/lib/actions/sundaySchoolAttendance", () => ({
  setAttendance: jest.fn().mockResolvedValue(undefined),
  markUnmarkedPresent: jest.fn().mockResolvedValue({ success: "Marked 1 present" }),
}))
const push = jest.fn()
const refresh = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }))
import { setAttendance, markUnmarkedPresent } from "@/lib/actions/sundaySchoolAttendance"

const rows = [
  { personId: 1, name: "Amy Adams", status: null, enrolled: true },
  { personId: 2, name: "Ben Brown", status: "ABSENT" as const, enrolled: true },
]
const props = { classId: 4, date: "2026-10-11", today: "2026-10-11", rows, readOnly: false, dateHrefBase: "/sunday-school/4/roll" }
const group = (name: string) => screen.getByRole("group", { name: `Attendance for ${name}` })
const btn = (name: string, label: string) => within(group(name)).getByRole("button", { name: label })

beforeEach(() => jest.clearAllMocks())

it("shows live counts", () => {
  render(<RollList {...props} />)
  expect(screen.getByText("0 present · 0 late · 1 absent · 1 not marked")).toBeInTheDocument()
})

it("marks optimistically, then clears on a second tap", async () => {
  render(<RollList {...props} />)
  await act(async () => { fireEvent.click(btn("Amy Adams", "Present")) })
  expect(btn("Amy Adams", "Present")).toHaveAttribute("aria-pressed", "true")
  expect(setAttendance).toHaveBeenCalledWith(4, "2026-10-11", 1, "PRESENT")
  expect(screen.getByText("1 present · 0 late · 1 absent · 0 not marked")).toBeInTheDocument()
  await act(async () => { fireEvent.click(btn("Amy Adams", "Present")) })
  expect(setAttendance).toHaveBeenLastCalledWith(4, "2026-10-11", 1, null)
  expect(btn("Amy Adams", "Present")).toHaveAttribute("aria-pressed", "false")
  expect(refresh).not.toHaveBeenCalled()
})

it("reverts and shows the error when the server refuses", async () => {
  ;(setAttendance as jest.Mock).mockResolvedValueOnce({ error: "Unauthorized" })
  render(<RollList {...props} />)
  await act(async () => { fireEvent.click(btn("Ben Brown", "Late")) })
  expect(btn("Ben Brown", "Absent")).toHaveAttribute("aria-pressed", "true")
  expect(btn("Ben Brown", "Late")).toHaveAttribute("aria-pressed", "false")
  expect(screen.getByText("Unauthorized")).toBeInTheDocument()
  // Resync: rows refreshed mid-request would make the reverted status stale.
  expect(refresh).toHaveBeenCalled()
})

it("reverts when the action throws", async () => {
  ;(setAttendance as jest.Mock).mockRejectedValueOnce(new Error("network"))
  render(<RollList {...props} />)
  await act(async () => { fireEvent.click(btn("Amy Adams", "Late")) })
  expect(btn("Amy Adams", "Late")).toHaveAttribute("aria-pressed", "false")
  expect(screen.getByRole("alert")).toBeInTheDocument()
  expect(refresh).toHaveBeenCalled()
})

it("Mark unmarked present fills only unmarked rows", async () => {
  render(<RollList {...props} />)
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Mark unmarked present" })) })
  expect(markUnmarkedPresent).toHaveBeenCalledWith(4, "2026-10-11")
  expect(btn("Amy Adams", "Present")).toHaveAttribute("aria-pressed", "true")
  expect(btn("Ben Brown", "Absent")).toHaveAttribute("aria-pressed", "true")
  expect(refresh).toHaveBeenCalled()
})

it("read only: no enabled buttons, no bulk action", () => {
  render(<RollList {...props} readOnly />)
  expect(screen.queryByRole("button", { name: "Mark unmarked present" })).not.toBeInTheDocument()
  expect(screen.queryByRole("group", { name: /Attendance for/ })).not.toBeInTheDocument()
  expect(screen.getByText("Absent")).toBeInTheDocument()
  expect(screen.getByText("Not marked")).toBeInTheDocument()
})

it("search filters by name", () => {
  render(<RollList {...props} />)
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "be" } })
  expect(screen.queryByText("Amy Adams")).not.toBeInTheDocument()
  expect(screen.getByText("Ben Brown")).toBeInTheDocument()
})

it("changing the date navigates", () => {
  render(<RollList {...props} />)
  fireEvent.change(screen.getByLabelText("Roll date"), { target: { value: "2026-10-04" } })
  expect(push).toHaveBeenCalledWith("/sunday-school/4/roll?date=2026-10-04")
})

it("ignores a partially typed year", () => {
  render(<RollList {...props} />)
  fireEvent.change(screen.getByLabelText("Roll date"), { target: { value: "0002-10-04" } })
  expect(push).not.toHaveBeenCalled()
})

it("tags a marked child who is no longer enrolled", () => {
  render(<RollList {...props} rows={[{ personId: 3, name: "Cal Cole", status: "PRESENT", enrolled: false }]} />)
  expect(screen.getByText("not enrolled")).toBeInTheDocument()
})

it("won't clear a mark for a child who has left the class", async () => {
  render(<RollList {...props} rows={[{ personId: 3, name: "Cal Cole", status: "PRESENT", enrolled: false }]} />)
  await act(async () => { fireEvent.click(btn("Cal Cole", "Present")) })
  expect(setAttendance).not.toHaveBeenCalled()
  expect(btn("Cal Cole", "Present")).toHaveAttribute("aria-pressed", "true")
})

it("locks the date picker while a mark is saving", async () => {
  let resolve!: (v: undefined) => void
  ;(setAttendance as jest.Mock).mockReturnValueOnce(new Promise((r) => { resolve = r }))
  render(<RollList {...props} />)
  await act(async () => { fireEvent.click(btn("Amy Adams", "Present")) })
  expect(screen.getByLabelText("Roll date")).toBeDisabled()
  await act(async () => { resolve(undefined) })
  expect(screen.getByLabelText("Roll date")).not.toBeDisabled()
})

it("a new date's roll never inherits another date's marks", () => {
  const { rerender } = render(<RollList {...props} />)
  fireEvent.click(btn("Amy Adams", "Late"))
  rerender(<RollList {...props} date="2026-10-04" rows={[{ ...rows[0] }, rows[1]]} />)
  expect(btn("Amy Adams", "Late")).toHaveAttribute("aria-pressed", "false")
})

it("a late failure doesn't revert onto a newly shown date", async () => {
  let resolve!: (v: { error: string }) => void
  ;(setAttendance as jest.Mock).mockReturnValueOnce(new Promise((r) => { resolve = r }))
  const { rerender } = render(<RollList {...props} />)
  await act(async () => { fireEvent.click(btn("Ben Brown", "Late")) })
  // Back/Forward: new date's roll, where Ben is Present.
  rerender(<RollList {...props} date="2026-10-04" rows={[rows[0], { ...rows[1], status: "PRESENT" }]} />)
  await act(async () => { resolve({ error: "Unauthorized" }) })
  expect(btn("Ben Brown", "Present")).toHaveAttribute("aria-pressed", "true")
  expect(btn("Ben Brown", "Absent")).toHaveAttribute("aria-pressed", "false")
})

it("a late bulk success doesn't mark rows on a newly shown date", async () => {
  let resolve!: (v: { success: string }) => void
  ;(markUnmarkedPresent as jest.Mock).mockReturnValueOnce(new Promise((r) => { resolve = r }))
  const { rerender } = render(<RollList {...props} />)
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Mark unmarked present" })) })
  // Back/Forward: new date's roll, where Amy is still unmarked.
  rerender(<RollList {...props} date="2026-10-04" rows={[{ ...rows[0] }, rows[1]]} />)
  await act(async () => { resolve({ success: "Marked 1 present" }) })
  expect(btn("Amy Adams", "Present")).toHaveAttribute("aria-pressed", "false")
})
