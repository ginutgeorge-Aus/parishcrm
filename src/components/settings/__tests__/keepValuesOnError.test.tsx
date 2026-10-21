import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MembershipSettingsForm } from "../MembershipSettingsForm"
import { ChurchInfoForm } from "../ChurchInfoForm"
import { AppSettingsForm } from "../AppSettingsForm"
import { updateMembershipSettings, updateChurchInfo, upsertSetting } from "@/lib/actions/settings"

jest.mock("@/lib/actions/settings", () => ({
  updateMembershipSettings: jest.fn(),
  updateChurchInfo: jest.fn(),
  upsertSetting: jest.fn(),
  updateLetterSettings: jest.fn(),
}))

// Render the shadcn Select as a native <select> so the idle-timeout choice can
// be driven in jsdom (same pattern as BudgetForm.test.tsx).
jest.mock("@/components/ui/select", () => ({
  Select: ({ name, defaultValue, children }: any) => (
    <select name={name} defaultValue={defaultValue} aria-label="Idle timeout">{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

describe("settings forms keep typed values when the action returns an error", () => {
  it("MembershipSettingsForm keeps rejected dues and checkbox state", async () => {
    ;(updateMembershipSettings as jest.Mock).mockResolvedValue({ error: "Max 2 decimals" })
    render(<MembershipSettingsForm settings={{ parishFields: false, minDues: 80, homeAddressLabel: "", arrivalDateLabel: "" }} />)
    fireEvent.change(screen.getByLabelText("Minimum monthly dues ($)"), { target: { value: "12.345" } })
    fireEvent.click(screen.getByLabelText(/previous church/i))
    fireEvent.click(screen.getByRole("button", { name: /save membership/i }))
    expect(await screen.findByText("Max 2 decimals")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText("Minimum monthly dues ($)")).toHaveValue("12.345")
      expect(screen.getByLabelText(/previous church/i)).toBeChecked()
    })
  })

  it("ChurchInfoForm keeps rejected values", async () => {
    ;(updateChurchInfo as jest.Mock).mockResolvedValue({ error: "Invalid email" })
    render(<ChurchInfoForm churchName="Saved" churchAddress="" churchABN="" churchEmail="" churchWebsite="" />)
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "typed@example.com" } })
    fireEvent.change(screen.getByLabelText("Church name"), { target: { value: "Typed" } })
    fireEvent.click(screen.getByRole("button", { name: /save church information/i }))
    expect(await screen.findByText("Invalid email")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toHaveValue("typed@example.com")
      expect(screen.getByLabelText("Church name")).toHaveValue("Typed")
    })
  })

  it("AppSettingsForm keeps the rejected value", async () => {
    ;(upsertSetting as jest.Mock).mockResolvedValue({ error: "Invalid email address" })
    render(<AppSettingsForm ownerNotificationEmail="a@example.com" membershipSecretaryEmail="" idleTimeoutMinutes={30} cardFeePercent="1.7" cardFeeFixed="0.30" />)
    fireEvent.change(screen.getByLabelText("Notification email address"), { target: { value: "typed@example.com" } })
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0])
    expect(await screen.findByText("Invalid email address")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText("Notification email address")).toHaveValue("typed@example.com"))
  })

  it("AppSettingsForm keeps the rejected idle-timeout choice", async () => {
    ;(upsertSetting as jest.Mock).mockResolvedValue({ error: "Save failed" })
    render(<AppSettingsForm ownerNotificationEmail="" membershipSecretaryEmail="" idleTimeoutMinutes={30} cardFeePercent="1.7" cardFeeFixed="0.30" />)
    fireEvent.change(screen.getByLabelText("Idle timeout"), { target: { value: "120" } })
    const select = screen.getByLabelText("Idle timeout")
    fireEvent.click(select.closest("form")!.querySelector("button[type=submit]")!)
    expect(await screen.findByText("Save failed")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText("Idle timeout")).toHaveValue("120"))
  })

  it("MembershipSettingsForm drops typed values after a later success", async () => {
    ;(updateMembershipSettings as jest.Mock).mockResolvedValueOnce({ error: "Max 2 decimals" })
    render(<MembershipSettingsForm settings={{ parishFields: false, minDues: 80, homeAddressLabel: "", arrivalDateLabel: "" }} />)
    const dues = () => screen.getByLabelText("Minimum monthly dues ($)")
    fireEvent.change(dues(), { target: { value: "12.345" } })
    fireEvent.click(screen.getByRole("button", { name: /save membership/i }))
    expect(await screen.findByText("Max 2 decimals")).toBeInTheDocument()
    await waitFor(() => expect(dues()).toHaveValue("12.345"))

    ;(updateMembershipSettings as jest.Mock).mockResolvedValueOnce({ success: "Saved" })
    fireEvent.change(dues(), { target: { value: "99" } })
    fireEvent.click(screen.getByRole("button", { name: /save membership/i }))
    expect(await screen.findByText("Saved")).toBeInTheDocument()
    await waitFor(() => expect(dues()).toHaveValue("80"))
  })
})
