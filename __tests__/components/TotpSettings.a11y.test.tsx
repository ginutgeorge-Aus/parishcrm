import { render, screen, fireEvent, act } from "@testing-library/react"
import { TotpSettings } from "@/components/account/TotpSettings"
import { regenerateBackupCodes } from "@/lib/actions/totp"

jest.mock("@/lib/actions/totp", () => ({
  startTotpEnrolment: jest.fn(),
  confirmTotpEnrolment: jest.fn(),
  cancelTotpEnrolment: jest.fn().mockResolvedValue({ success: true }),
  regenerateBackupCodes: jest.fn(),
  disableTotp: jest.fn(),
}))
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }))

const CODES = Array.from({ length: 10 }, (_, i) => `AAAA${i}-BBBBB`)
const enabled = { enabled: true, backupCodesRemaining: 2 }

/** Renders the settings and advances to the backup-codes screen. */
async function showCodes() {
  ;(regenerateBackupCodes as jest.Mock).mockResolvedValue({ success: true, backupCodes: CODES })
  render(<TotpSettings status={enabled} />)
  fireEvent.click(screen.getByRole("button", { name: "New backup codes" }))
  fireEvent.change(screen.getByLabelText("Code from app"), { target: { value: "123456" } })
  fireEvent.click(screen.getByRole("button", { name: "Generate" }))
  await screen.findByText(CODES[0])
}

describe("TotpSettings accessibility", () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard")
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "clipboard", original)
    else delete (navigator as unknown as Record<string, unknown>).clipboard
  })

  it("moves focus to the first input of the newly shown form", () => {
    render(<TotpSettings status={enabled} />)
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }))
    expect(screen.getByLabelText("Authenticator or backup code")).toHaveFocus()
  })

  it("announces Copied in a status region on success", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    await showCodes()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy" })) })
    expect(writeText).toHaveBeenCalledWith(CODES.join("\n"))
    expect(screen.getByRole("status")).toHaveTextContent("Copied")
  })

  it("shows an error when the clipboard rejects", async () => {
    const writeText = jest.fn().mockRejectedValue(new Error("denied"))
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    await showCodes()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy" })) })
    expect(screen.getByRole("status")).toHaveTextContent(/could not copy/i)
  })

  it("shows an error when the clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true })
    await showCodes()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy" })) })
    expect(screen.getByRole("status")).toHaveTextContent(/could not copy/i)
  })
})
