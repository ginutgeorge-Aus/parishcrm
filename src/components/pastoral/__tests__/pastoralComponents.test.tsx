import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

jest.mock("@/lib/actions/followUp", () => ({
  setFollowUpStatus: jest.fn(),
  deleteFollowUpTask: jest.fn(),
  createFollowUpTask: jest.fn(),
  listFollowUpTasks: jest.fn(),
}))
jest.mock("@/lib/actions/prayerRequest", () => ({ setPrayerRequestStatus: jest.fn(), createPrayerRequest: jest.fn() }))
jest.mock("@/lib/pastoralQueries", () => ({ listAssignableUsers: jest.fn().mockResolvedValue([{ id: 5, name: "Pat" }]) }))

import { createFollowUpTask, deleteFollowUpTask, listFollowUpTasks, setFollowUpStatus, type FollowUpTaskView } from "@/lib/actions/followUp"
import { createPrayerRequest, setPrayerRequestStatus, type PrayerRequestView } from "@/lib/actions/prayerRequest"
import { FollowUpCard } from "../FollowUpCard"
import { FollowUpForm } from "../FollowUpForm"
import { FollowUpList } from "../FollowUpList"
import { PrayerRequestForm } from "../PrayerRequestForm"
import { PrayerRequestList } from "../PrayerRequestList"

const task = (over: Partial<FollowUpTaskView> = {}): FollowUpTaskView => ({
  id: 1,
  title: "Visit after surgery",
  notes: null,
  status: "OPEN",
  dueDate: "2026-11-20",
  overdue: false,
  personId: 9,
  personName: "Sam Demo",
  familyId: null,
  familyName: null,
  assigneeId: 5,
  assigneeName: "Pat",
  completedAt: null,
  createdAt: new Date("2026-11-01"),
  updatedAt: new Date("2026-11-01"),
  ...over,
})

const prayer = (over: Partial<PrayerRequestView> = {}): PrayerRequestView => ({
  id: 3,
  source: "STAFF",
  status: "ACTIVE",
  request: "Healing for my mother",
  requesterName: "Sam",
  requesterEmail: null,
  requesterPhone: null,
  personId: null,
  personName: null,
  shareConsent: false,
  shareConsentAt: null,
  createdAt: new Date("2026-11-01T00:00:00Z"),
  updatedAt: new Date("2026-11-01T00:00:00Z"),
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(setFollowUpStatus as jest.Mock).mockResolvedValue({ success: "ok" })
  ;(setPrayerRequestStatus as jest.Mock).mockResolvedValue({ success: "ok" })
})

describe("FollowUpList", () => {
  it("shows an empty message", () => {
    render(<FollowUpList tasks={[]} canManage />)
    expect(screen.getByText("No follow-ups.")).toBeInTheDocument()
  })

  it("renders target link, due date, assignee and overdue badge", () => {
    render(<FollowUpList tasks={[task({ overdue: true })]} canManage={false} showTarget />)
    expect(screen.getByRole("link", { name: "Sam Demo" })).toHaveAttribute("href", "/people/9")
    expect(screen.getByText(/Due 2026-11-20/)).toHaveTextContent("Assigned to Pat")
    expect(screen.getByText("Overdue")).toBeInTheDocument()
  })

  it("an assignee (canManage false) can mark done but not delete", async () => {
    render(<FollowUpList tasks={[task()]} canManage={false} />)
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }))
    await waitFor(() => expect(setFollowUpStatus).toHaveBeenCalledWith(1, "DONE"))
  })

  it("Start moves OPEN to IN_PROGRESS; a closed task offers Reopen", async () => {
    const { rerender } = render(<FollowUpList tasks={[task()]} canManage />)
    fireEvent.click(screen.getByRole("button", { name: "Start" }))
    await waitFor(() => expect(setFollowUpStatus).toHaveBeenCalledWith(1, "IN_PROGRESS"))
    rerender(<FollowUpList tasks={[task({ status: "DONE" })]} canManage />)
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }))
    await waitFor(() => expect(setFollowUpStatus).toHaveBeenCalledWith(1, "OPEN"))
  })

  it("shows the action error", async () => {
    ;(setFollowUpStatus as jest.Mock).mockResolvedValue({ error: "Not found" })
    render(<FollowUpList tasks={[task()]} canManage />)
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Not found")
  })

  it("managers get a confirmed delete", async () => {
    ;(deleteFollowUpTask as jest.Mock).mockResolvedValue({ success: "Task deleted" })
    render(<FollowUpList tasks={[task()]} canManage />)
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(deleteFollowUpTask).toHaveBeenCalledWith(1))
  })
})

describe("FollowUpForm", () => {
  it("creates a task on the person and clears the form", async () => {
    ;(createFollowUpTask as jest.Mock).mockResolvedValue({ id: 4 })
    render(<FollowUpForm target={{ personId: 9 }} assignees={[{ id: 5, name: "Pat" }]} />)
    expect(screen.getByRole("button", { name: "Add follow-up" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Follow-up"), { target: { value: "Call them" } })
    fireEvent.change(screen.getByLabelText("Assign to"), { target: { value: "5" } })
    fireEvent.change(screen.getByLabelText("Due date (optional)"), { target: { value: "2026-12-01" } })
    fireEvent.click(screen.getByRole("button", { name: "Add follow-up" }))
    await waitFor(() =>
      expect(createFollowUpTask).toHaveBeenCalledWith({ personId: 9, title: "Call them", notes: null, assigneeId: 5, dueDate: "2026-12-01" }),
    )
    expect(await screen.findByText("Follow-up added")).toBeInTheDocument()
    expect(screen.getByLabelText("Follow-up")).toHaveValue("")
  })

  it("shows the server error and keeps the input", async () => {
    ;(createFollowUpTask as jest.Mock).mockResolvedValue({ error: "Choose a staff member with edit access." })
    render(<FollowUpForm target={{ familyId: 2 }} assignees={[]} />)
    fireEvent.change(screen.getByLabelText("Follow-up"), { target: { value: "Visit" } })
    fireEvent.click(screen.getByRole("button", { name: "Add follow-up" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a staff member")
    expect(screen.getByLabelText("Follow-up")).toHaveValue("Visit")
    expect(createFollowUpTask).toHaveBeenCalledWith(expect.objectContaining({ familyId: 2 }))
  })
})

describe("FollowUpCard", () => {
  it("manager sees tasks and the add form", async () => {
    ;(listFollowUpTasks as jest.Mock).mockResolvedValue({ tasks: [task()] })
    render(await FollowUpCard({ target: { personId: 9 }, role: "PASTOR" }))
    expect(listFollowUpTasks).toHaveBeenCalledWith({ personId: 9 })
    expect(screen.getByText("Visit after surgery")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add follow-up" })).toBeInTheDocument()
  })

  it("an assignee sees tasks but no add form", async () => {
    ;(listFollowUpTasks as jest.Mock).mockResolvedValue({ tasks: [task()] })
    render(await FollowUpCard({ target: { familyId: 2 }, role: "OFFICE_ADMIN" }))
    expect(screen.getByText("Visit after surgery")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add follow-up" })).toBeNull()
  })

  it("renders nothing when the action refuses", async () => {
    ;(listFollowUpTasks as jest.Mock).mockResolvedValue({ error: "Unauthorized" })
    expect(await FollowUpCard({ target: { personId: 9 }, role: "VIEWER" })).toBeNull()
  })
})

describe("PrayerRequestList", () => {
  it("marks source and consent, shows contact", () => {
    render(<PrayerRequestList requests={[prayer({ source: "PUBLIC_FORM", shareConsent: true, requesterEmail: "s@x.com" })]} />)
    expect(screen.getByText("Public form")).toBeInTheDocument()
    expect(screen.getByText("OK to share")).toBeInTheDocument()
    expect(screen.getByText(/Sam · s@x.com/)).toBeInTheDocument()
  })

  it("a private staff request shows Private and no Public form badge", () => {
    render(<PrayerRequestList requests={[prayer()]} />)
    expect(screen.getByText("Private")).toBeInTheDocument()
    expect(screen.queryByText("Public form")).toBeNull()
  })

  it("Archive, Mark answered and Restore call the status action", async () => {
    const { rerender } = render(<PrayerRequestList requests={[prayer()]} />)
    fireEvent.click(screen.getByRole("button", { name: "Archive" }))
    await waitFor(() => expect(setPrayerRequestStatus).toHaveBeenCalledWith(3, "ARCHIVED"))
    fireEvent.click(screen.getByRole("button", { name: "Mark answered" }))
    await waitFor(() => expect(setPrayerRequestStatus).toHaveBeenCalledWith(3, "ANSWERED"))
    rerender(<PrayerRequestList requests={[prayer({ status: "ARCHIVED" })]} />)
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Restore" }))
    await waitFor(() => expect(setPrayerRequestStatus).toHaveBeenCalledWith(3, "ACTIVE"))
  })

  it("says so when empty", () => {
    render(<PrayerRequestList requests={[]} />)
    expect(screen.getByText("No prayer requests.")).toBeInTheDocument()
  })
})

describe("PrayerRequestForm", () => {
  it("submits with consent and clears", async () => {
    ;(createPrayerRequest as jest.Mock).mockResolvedValue({ id: 1 })
    render(<PrayerRequestForm />)
    fireEvent.change(screen.getByLabelText("Prayer request"), { target: { value: "Peace" } })
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Add prayer request" }))
    await waitFor(() =>
      expect(createPrayerRequest).toHaveBeenCalledWith({ request: "Peace", requesterName: null, requesterEmail: null, requesterPhone: null, shareConsent: true }),
    )
    expect(await screen.findByText("Prayer request added")).toBeInTheDocument()
    expect(screen.getByLabelText("Prayer request")).toHaveValue("")
  })
})
