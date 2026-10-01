import { render, screen, fireEvent } from "@testing-library/react"
import { TotpSettings } from "@/components/account/TotpSettings"
import {
  startTotpEnrolment, confirmTotpEnrolment, disableTotp, regenerateBackupCodes,
} from "@/lib/actions/totp"

jest.mock("@/lib/actions/totp", () => ({
  startTotpEnrolment: jest.fn(),
  confirmTotpEnrolment: jest.fn(),
  cancelTotpEnrolment: jest.fn().mockResolvedValue({ success: true }),
  regenerateBackupCodes: jest.fn(),
  disableTotp: jest.fn(),
}))
const mockRefresh = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }))

const CODES = Array.from({ length: 10 }, (_, i) => `AAAA${i}-BBBBB`)

describe("TotpSettings", () => {
  beforeEach(() => jest.clearAllMocks())

  it("enrols: shows QR + key, confirms, then shows backup codes once", async () => {
    ;(startTotpEnrolment as jest.Mock).mockResolvedValue({ success: true, qrDataUrl: "data:image/png;base64,xx", manualKey: "JBSWY3DP" })
    ;(confirmTotpEnrolment as jest.Mock).mockResolvedValue({ success: true, backupCodes: CODES })
    render(<TotpSettings status={{ enabled: false, pending: false, backupCodesRemaining: 0 }} />)
    fireEvent.click(screen.getByRole("button", { name: "Set up authenticator app" }))
    expect(await screen.findByAltText("Authenticator QR code")).toBeInTheDocument()
    expect(screen.getByText("JBSWY3DP")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Code from app"), { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }))
    expect(await screen.findByText(CODES[0])).toBeInTheDocument()
    expect(confirmTotpEnrolment).toHaveBeenCalledWith("123456")
    fireEvent.click(screen.getByRole("button", { name: "I've saved these codes" }))
    expect(screen.queryByText(CODES[0])).not.toBeInTheDocument()
    expect(mockRefresh).toHaveBeenCalled()
  })

  it("shows a generic error when an action throws", async () => {
    ;(startTotpEnrolment as jest.Mock).mockRejectedValue(new Error("boom"))
    render(<TotpSettings status={{ enabled: false, pending: false, backupCodesRemaining: 0 }} />)
    fireEvent.click(screen.getByRole("button", { name: "Set up authenticator app" }))
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument()
  })

  it("shows the returned error when disable fails", async () => {
    ;(disableTotp as jest.Mock).mockResolvedValue({ error: "Invalid code" })
    render(<TotpSettings status={{ enabled: true, pending: false, backupCodesRemaining: 7 }} />)
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }))
    fireEvent.change(screen.getByLabelText("Authenticator or backup code"), { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: "Confirm turn off" }))
    expect(await screen.findByText("Invalid code")).toBeInTheDocument()
  })

  it("shows the confirm error", async () => {
    ;(startTotpEnrolment as jest.Mock).mockResolvedValue({ success: true, qrDataUrl: "data:x", manualKey: "K" })
    ;(confirmTotpEnrolment as jest.Mock).mockResolvedValue({ error: "That code didn't match. Try the current code." })
    render(<TotpSettings status={{ enabled: false, pending: false, backupCodesRemaining: 0 }} />)
    fireEvent.click(screen.getByRole("button", { name: "Set up authenticator app" }))
    fireEvent.change(await screen.findByLabelText("Code from app"), { target: { value: "000000" } })
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }))
    expect(await screen.findByText("That code didn't match. Try the current code.")).toBeInTheDocument()
  })

  it("enabled: shows remaining count, disables with a code", async () => {
    ;(disableTotp as jest.Mock).mockResolvedValue({ success: true })
    render(<TotpSettings status={{ enabled: true, pending: false, backupCodesRemaining: 7 }} />)
    expect(screen.getByText(/7 of 10 backup codes left/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }))
    fireEvent.change(screen.getByLabelText("Authenticator or backup code"), { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: "Confirm turn off" }))
    await screen.findByRole("button", { name: "Turn off" })
    expect(disableTotp).toHaveBeenCalledWith("123456")
    expect(mockRefresh).toHaveBeenCalled()
  })

  it("enabled: regenerates backup codes", async () => {
    ;(regenerateBackupCodes as jest.Mock).mockResolvedValue({ success: true, backupCodes: CODES })
    render(<TotpSettings status={{ enabled: true, pending: false, backupCodesRemaining: 2 }} />)
    fireEvent.click(screen.getByRole("button", { name: "New backup codes" }))
    fireEvent.change(screen.getByLabelText("Code from app"), { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: "Generate" }))
    expect(await screen.findByText(CODES[9])).toBeInTheDocument()
  })
})
