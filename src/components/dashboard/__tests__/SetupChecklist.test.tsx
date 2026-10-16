jest.mock("@/lib/setupChecklist", () => ({ getSetupChecklist: jest.fn() }))

import { render, screen } from "@testing-library/react"
import { getSetupChecklist, type SetupStep } from "@/lib/setupChecklist"
import { SetupChecklist } from "@/components/dashboard/SetupChecklist"

const mockGet = getSetupChecklist as jest.Mock

const step = (id: SetupStep["id"], done: boolean, href = `/${id}`): SetupStep => ({
  id, title: `Title ${id}`, description: `Desc ${id}`, href, done,
})

describe("SetupChecklist", () => {
  it("renders nothing when the loader returns null", async () => {
    mockGet.mockResolvedValue(null)
    const { container } = render(<>{await SetupChecklist({ role: "VIEWER" })}</>)
    expect(container).toBeEmptyDOMElement()
    expect(mockGet).toHaveBeenCalledWith("VIEWER")
  })

  it("shows progress and links only the steps still to do", async () => {
    mockGet.mockResolvedValue([step("church", true), step("people", false, "/families"), step("categories", false)])
    render(<>{await SetupChecklist({ role: "ADMIN" })}</>)
    expect(screen.getByRole("heading", { name: "Finish setting up" })).toBeInTheDocument()
    expect(screen.getByText("1 of 3 done")).toBeInTheDocument()
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1")
    expect(screen.getByRole("link", { name: /Title people/ })).toHaveAttribute("href", "/families")
    expect(screen.getByRole("link", { name: /Title categories/ })).toHaveAttribute("href", "/categories")
    expect(screen.queryByRole("link", { name: /Title church/ })).toBeNull()
  })
})
