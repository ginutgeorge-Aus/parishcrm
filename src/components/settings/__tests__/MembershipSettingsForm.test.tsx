import { render, screen } from "@testing-library/react"
import { MembershipSettingsForm } from "../MembershipSettingsForm"

jest.mock("@/lib/actions/settings", () => ({ updateMembershipSettings: jest.fn() }))

describe("MembershipSettingsForm", () => {
  it("reflects saved settings", () => {
    render(<MembershipSettingsForm settings={{ parishFields: true, minDues: 80, homeAddressLabel: "Address in India", arrivalDateLabel: "" }} />)
    expect(screen.getByLabelText(/previous church/i)).toBeChecked()
    expect(screen.getByLabelText("Minimum monthly dues ($)")).toHaveValue("80")
    expect(screen.getByLabelText(/home-country address/i)).toHaveValue("Address in India")
    expect(screen.getByLabelText(/arrival date/i)).toHaveValue("")
  })
  it("renders generic defaults unchecked and blank", () => {
    render(<MembershipSettingsForm settings={{ parishFields: false, minDues: null, homeAddressLabel: "", arrivalDateLabel: "" }} />)
    expect(screen.getByLabelText(/previous church/i)).not.toBeChecked()
    expect(screen.getByLabelText("Minimum monthly dues ($)")).toHaveValue("")
  })
})
