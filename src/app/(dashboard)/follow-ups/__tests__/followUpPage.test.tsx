import { render } from "@testing-library/react"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))
jest.mock("@/lib/actions/followUp", () => ({ listFollowUpTasks: jest.fn() }))
jest.mock("@/lib/pastoralQueries", () => ({ listAssignableUsers: jest.fn() }))
jest.mock("@/components/pastoral/FollowUpList", () => ({
  FollowUpList: (p: { tasks: { id: number }[]; canManage: boolean }) => (
    <div data-testid="list">{`tasks:${p.tasks.map((t) => t.id).join(",")} manage:${p.canManage}`}</div>
  ),
}))

import { auth } from "@/auth"
import { listFollowUpTasks } from "@/lib/actions/followUp"
import { listAssignableUsers } from "@/lib/pastoralQueries"
import FollowUpsPage from "../page"

const as = (role: string | undefined) =>
  (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "1", role } } : null)
const run = async (sp: Record<string, string> = {}) => render(await FollowUpsPage({ searchParams: Promise.resolve(sp) }))

beforeEach(() => {
  jest.clearAllMocks()
  ;(listFollowUpTasks as jest.Mock).mockResolvedValue({
    tasks: [
      { id: 1, assigneeId: 5 },
      { id: 2, assigneeId: null },
    ],
  })
  ;(listAssignableUsers as jest.Mock).mockResolvedValue([{ id: 5, name: "Pat" }])
})

describe("/follow-ups page", () => {
  it.each(["ADMIN", "PASTOR"])("%s sees every task and the assignee filters", async (role) => {
    as(role)
    const { getByTestId, getByRole } = await run()
    expect(getByTestId("list")).toHaveTextContent("tasks:1,2 manage:true")
    expect(getByRole("group", { name: "Assignee" })).toBeInTheDocument()
    expect(listFollowUpTasks).toHaveBeenCalledWith({ statuses: ["OPEN", "IN_PROGRESS"] })
  })

  it("OFFICE_ADMIN (assignee) gets the list without manage or assignee filters", async () => {
    as("OFFICE_ADMIN")
    const { getByTestId, queryByRole } = await run()
    expect(getByTestId("list")).toHaveTextContent("manage:false")
    expect(queryByRole("group", { name: "Assignee" })).toBeNull()
    expect(listAssignableUsers).not.toHaveBeenCalled()
  })

  it("OFFICE_ADMIN ignores a stale ?assignee= (no chips to clear it) and status links drop it", async () => {
    as("OFFICE_ADMIN")
    const { getByRole } = await run({ assignee: "12" })
    expect(listFollowUpTasks).toHaveBeenCalledWith({ statuses: ["OPEN", "IN_PROGRESS"] })
    expect(getByRole("link", { name: "All" })).toHaveAttribute("href", "/follow-ups?status=all")
  })

  it.each(["VIEWER", "AUDITOR", "EVENT_ORGANISER", "TEACHER"])("redirects %s home before reading", async (role) => {
    as(role)
    await expect(run()).rejects.toThrow("REDIRECT:/")
    expect(listFollowUpTasks).not.toHaveBeenCalled()
  })

  it("redirects a signed-out visitor to login", async () => {
    as(undefined)
    await expect(run()).rejects.toThrow("REDIRECT:/login")
  })

  it("passes the status filter and unassigned/assignee filters into the query", async () => {
    as("ADMIN")
    await run({ status: "done", assignee: "unassigned" })
    expect(listFollowUpTasks).toHaveBeenCalledWith({ statuses: ["DONE", "CANCELLED"], assigneeId: null })
    await run({ assignee: "5" })
    expect(listFollowUpTasks).toHaveBeenLastCalledWith({ statuses: ["OPEN", "IN_PROGRESS"], assigneeId: 5 })
  })

  it("passes mine to the action", async () => {
    as("PASTOR")
    await run({ status: "all", assignee: "mine" })
    expect(listFollowUpTasks).toHaveBeenCalledWith({ statuses: undefined, mine: true })
  })

  it("honours the bell link ?assignee=mine: open tasks, Mine chip active", async () => {
    as("ADMIN")
    const { getByRole } = await run({ assignee: "mine" })
    expect(listFollowUpTasks).toHaveBeenCalledWith({ statuses: ["OPEN", "IN_PROGRESS"], mine: true })
    expect(getByRole("link", { name: "Mine" })).toHaveAttribute("aria-current", "true")
  })

  it("honours the bell link ?due=1: passes due, keeps it on chip links, chip toggles it off", async () => {
    as("ADMIN")
    const { getByRole } = await run({ assignee: "mine", due: "1" })
    expect(listFollowUpTasks).toHaveBeenCalledWith({ statuses: ["OPEN", "IN_PROGRESS"], mine: true, due: true })
    expect(getByRole("link", { name: "All" })).toHaveAttribute("href", "/follow-ups?status=all&assignee=mine&due=1")
    const chip = getByRole("link", { name: "Due today or earlier" })
    expect(chip).toHaveAttribute("aria-current", "true")
    expect(chip).toHaveAttribute("href", "/follow-ups?assignee=mine")
  })

  it("hints that the list is capped only when rows were dropped", async () => {
    as("ADMIN")
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: i + 1, assigneeId: null }))
    ;(listFollowUpTasks as jest.Mock).mockResolvedValue({ tasks: rows, truncated: false })
    const { queryByText, unmount } = await run()
    expect(queryByText(/Showing the first/)).toBeNull()
    unmount()
    ;(listFollowUpTasks as jest.Mock).mockResolvedValue({ tasks: rows, truncated: true })
    const { getByRole } = await run()
    expect(getByRole("status")).toHaveTextContent("Showing the first 500. Narrow the filters to see the rest.")
  })
})
