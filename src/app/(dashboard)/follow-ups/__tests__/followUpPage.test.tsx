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
})
