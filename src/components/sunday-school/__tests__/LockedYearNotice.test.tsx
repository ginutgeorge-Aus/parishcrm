import { render, screen, fireEvent } from "@testing-library/react"

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))
jest.mock("@/lib/actions/sundaySchool", () => ({ unlockSundaySchoolYear: jest.fn() }))

import { LockedYearNotice } from "@/components/sunday-school/LockedYearNotice"
import { unlockSundaySchoolYear } from "@/lib/actions/sundaySchool"

describe("LockedYearNotice", () => {
  it("shows only the badge to non-admins", () => {
    render(<LockedYearNotice year={2026} canUnlock={false} />)
    expect(screen.getByText("Locked (rolled over)")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Unlock year" })).toBeNull()
  })
  it("shows an Unlock year button to admins, behind a confirm dialog", async () => {
    ;(unlockSundaySchoolYear as jest.Mock).mockResolvedValue({ success: "ok" })
    render(<LockedYearNotice year={2026} canUnlock />)
    fireEvent.click(screen.getByRole("button", { name: "Unlock year" }))
    expect(await screen.findByRole("heading", { name: "Unlock 2026?" })).toBeInTheDocument()
    expect(unlockSundaySchoolYear).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole("button", { name: "Unlock" }))
    expect(unlockSundaySchoolYear).toHaveBeenCalledWith(2026)
  })
})
