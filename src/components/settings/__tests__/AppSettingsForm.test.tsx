/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react"
import { AppSettingsForm } from "../AppSettingsForm"
import { upsertSetting } from "@/lib/actions/settings"

jest.mock("@/lib/actions/settings", () => ({ upsertSetting: jest.fn() }))

const props = {
  ownerNotificationEmail: "",
  membershipSecretaryEmail: "",
  idleTimeoutMinutes: 60,
  cardFeePercent: "1.7",
  cardFeeFixed: "0.30",
  showMembership: false,
  showCardFee: false,
}

describe("AppSettingsForm aria-describedby", () => {
  it("links the description automatically", () => {
    render(<AppSettingsForm {...props} />)
    expect(screen.getByLabelText("Notification email address")).toHaveAccessibleDescription(/Receives failed-login alerts/)
  })

  it("adds the save error to the description once it fails", async () => {
    ;(upsertSetting as jest.Mock).mockResolvedValueOnce({ error: "Enter a valid email" })
    render(<AppSettingsForm {...props} />)
    const input = screen.getByLabelText("Notification email address")
    expect(input.getAttribute("aria-describedby")).toBe("owner-email-desc")

    fireEvent.change(input, { target: { value: "bad" } })
    fireEvent.submit(input.closest("form")!)
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Enter a valid email")
    expect(alert.id).toBe("owner-email-error")
    expect(input.getAttribute("aria-describedby")).toBe("owner-email-desc owner-email-error")
    expect(input).toHaveAccessibleDescription(/Enter a valid email/)
  })
})
