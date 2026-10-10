/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react"

const push = jest.fn()
const back = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ push, back }), unstable_rethrow: jest.fn() }))
// TeachersPanel reuses the badge from PersonClearances, which imports its own actions.
jest.mock("@/lib/actions/clearance", () => ({}))
jest.mock("@/lib/actions/sundaySchool", () => ({
  addTeacher: jest.fn(),
  removeTeacher: jest.fn(),
  archiveClass: jest.fn(),
  rolloverYear: jest.fn(),
}))

import { TeachersPanel } from "@/components/sunday-school/TeachersPanel"
import { RolloverButton } from "@/components/sunday-school/RolloverButton"
import { ArchiveClassButton } from "@/components/sunday-school/ArchiveClassButton"
import { ClassForm } from "@/components/sunday-school/ClassForm"
import { addTeacher, removeTeacher, archiveClass, rolloverYear } from "@/lib/actions/sundaySchool"

/** Open the confirm dialog via its trigger, then press the dialog's confirm button. */
async function confirm(trigger: string | RegExp, confirmLabel: string) {
  fireEvent.click(screen.getByRole("button", { name: trigger }))
  const dialog = await screen.findByRole("alertdialog")
  const btn = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === confirmLabel)!
  await act(async () => { fireEvent.click(btn) })
}

beforeEach(() => jest.clearAllMocks())

describe("TeachersPanel", () => {
  const teachers = [{ id: 2, name: "Jane Sample", wwcc: "EXPIRED" as const }]
  const candidates = [{ id: 5, name: "Sam Teacher" }]

  it("shows each teacher's WWCC status", () => {
    render(<TeachersPanel classId={1} teachers={teachers} candidates={candidates} readOnly />)
    expect(screen.getByRole("link", { name: "Jane Sample" })).toHaveAttribute("href", "/people/2")
    expect(screen.getByText("Expired")).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("adds the chosen teacher and surfaces an error", async () => {
    ;(addTeacher as jest.Mock).mockResolvedValueOnce({ error: "Tag this person as a Sunday school teacher first" })
    render(<TeachersPanel classId={1} teachers={[]} candidates={candidates} readOnly={false} />)
    expect(screen.getByText("No teacher yet.")).toBeInTheDocument()
    const add = screen.getByRole("button", { name: "Add teacher" })
    expect(add).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Add teacher"), { target: { value: "5" } })
    fireEvent.click(add)
    await waitFor(() => expect(addTeacher).toHaveBeenCalledWith(1, 5))
    expect(await screen.findByRole("alert")).toHaveTextContent("Tag this person")
  })

  it("explains the tag rule when there are no candidates", () => {
    render(<TeachersPanel classId={1} teachers={teachers} candidates={[]} readOnly={false} />)
    expect(screen.getByText(/can be added — tag them on their profile/)).toBeInTheDocument()
  })

  it("removes a teacher after confirming", async () => {
    render(<TeachersPanel classId={1} teachers={teachers} candidates={[]} readOnly={false} />)
    await confirm("Remove Jane Sample", "Remove")
    expect(removeTeacher).toHaveBeenCalledWith(1, 2)
  })
})

describe("RolloverButton", () => {
  it("rolls over and opens next year carrying the summary", async () => {
    ;(rolloverYear as jest.Mock).mockResolvedValue({ success: "Created 2 classes for 2027; moved 1 child; 0 need placing by hand" })
    render(<RolloverButton fromYear={2026} classCount={2} />)
    await confirm("Roll over to 2027", "Roll over")
    expect(rolloverYear).toHaveBeenCalledWith(2026)
    expect(push).toHaveBeenCalledWith(
      `/sunday-school?year=2027&rolled=${encodeURIComponent("Created 2 classes for 2027; moved 1 child; 0 need placing by hand")}`,
    )
  })

  it("keeps the dialog open with the refusal message", async () => {
    ;(rolloverYear as jest.Mock).mockResolvedValue({ error: "2027 already has classes — roll over is one-time" })
    render(<RolloverButton fromYear={2026} classCount={2} />)
    await confirm("Roll over to 2027", "Roll over")
    expect(screen.getByRole("alert")).toHaveTextContent("one-time")
    expect(push).not.toHaveBeenCalled()
  })
})

describe("ArchiveClassButton", () => {
  it("archives then returns to that year's list", async () => {
    ;(archiveClass as jest.Mock).mockResolvedValue(undefined)
    render(<ArchiveClassButton classId={4} year={2026} />)
    await confirm("Archive class", "Archive")
    expect(archiveClass).toHaveBeenCalledWith(4)
    expect(push).toHaveBeenCalledWith("/sunday-school?year=2026")
  })

  it("stays put on an error", async () => {
    ;(archiveClass as jest.Mock).mockResolvedValue({ error: "Class not found" })
    render(<ArchiveClassButton classId={4} year={2026} />)
    await confirm("Archive class", "Archive")
    expect(push).not.toHaveBeenCalled()
  })
})

describe("ClassForm", () => {
  it("prefills an existing class and shows the fixed year", () => {
    render(<ClassForm action={jest.fn()} year={2026} cls={{ name: "Kindy", level: 0, location: "Hall" }} />)
    expect(screen.getByText("School year 2026")).toBeInTheDocument()
    expect(screen.getByLabelText("Class name")).toHaveValue("Kindy")
    expect(screen.getByLabelText("Location (optional)")).toHaveValue("Hall")
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument()
  })

  it("shows the action's error and cancels back", async () => {
    const action = jest.fn().mockResolvedValue({ error: "Class name is required" })
    render(<ClassForm action={action} year={2026} />)
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(back).toHaveBeenCalled()
    await act(async () => { fireEvent.submit(screen.getByRole("button", { name: "Create class" }).closest("form")!) })
    expect(await screen.findByRole("alert")).toHaveTextContent("Class name is required")
  })
})
