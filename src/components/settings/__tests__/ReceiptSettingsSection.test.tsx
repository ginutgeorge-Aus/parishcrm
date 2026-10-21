import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { ReceiptSettingsSection } from "@/components/settings/ReceiptSettingsSection"
import {
  updateReceiptSettings,
  resetReceiptSettings,
} from "@/lib/actions/receiptSettings"
import { DEFAULT_RECEIPT_SETTINGS } from "@/lib/receiptSettingsShared"

jest.mock("@/lib/actions/receiptSettings", () => ({
  updateReceiptSettings: jest.fn(),
  resetReceiptSettings: jest.fn(),
}))

// receiptSettings.ts (Task 1) bundles the pure ReceiptSettings type/defaults
// together with the prisma-backed getReceiptSettings() in one module. This
// component only needs the type/defaults, but importing the module still
// pulls in @/lib/prisma's real pg adapter chain, which jsdom can't load
// (no TextEncoder). Mock prisma so that import resolves harmlessly.
jest.mock("@/lib/prisma", () => ({ prisma: {} }))

describe("ReceiptSettingsSection", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(updateReceiptSettings as jest.Mock).mockResolvedValue({ ok: true, settings: DEFAULT_RECEIPT_SETTINGS })
    ;(resetReceiptSettings as jest.Mock).mockResolvedValue({ ok: true })
  })

  it("renders current values and saves edited fields", async () => {
    render(<ReceiptSettingsSection settings={DEFAULT_RECEIPT_SETTINGS} />)
    const prefix = screen.getByLabelText(/receipt number prefix/i) as HTMLInputElement
    expect(prefix.value).toBe("DGR")

    fireEvent.change(prefix, { target: { value: "RCPT" } })
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))

    await waitFor(() =>
      expect(updateReceiptSettings).toHaveBeenCalledWith(
        expect.objectContaining({ receiptNumberPrefix: "RCPT" })
      )
    )
  })

  it("shows a success message after saving", async () => {
    render(<ReceiptSettingsSection settings={DEFAULT_RECEIPT_SETTINGS} />)
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/saved/i))
  })

  it("shows the default and stays clean after saving a blank field", async () => {
    render(<ReceiptSettingsSection settings={DEFAULT_RECEIPT_SETTINGS} />)
    const prefix = screen.getByLabelText(/receipt number prefix/i) as HTMLInputElement
    fireEvent.change(prefix, { target: { value: "" } })
    const dirtyEvent = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(dirtyEvent)
    expect(dirtyEvent.defaultPrevented).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))
    await waitFor(() => expect(prefix.value).toBe(DEFAULT_RECEIPT_SETTINGS.numberPrefix))
    const cleanEvent = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(cleanEvent)
    expect(cleanEvent.defaultPrevented).toBe(false)
  })

  it("keeps the typed values when the save returns no settings", async () => {
    ;(updateReceiptSettings as jest.Mock).mockResolvedValue({ ok: true })
    render(<ReceiptSettingsSection settings={DEFAULT_RECEIPT_SETTINGS} />)
    const prefix = screen.getByLabelText(/receipt number prefix/i) as HTMLInputElement
    fireEvent.change(prefix, { target: { value: "RCPT" } })
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/saved/i))
    expect(prefix.value).toBe("RCPT")
  })

  it("shows the error message when save fails", async () => {
    ;(updateReceiptSettings as jest.Mock).mockResolvedValue({ error: "Not authorised" })
    render(<ReceiptSettingsSection settings={DEFAULT_RECEIPT_SETTINGS} />)
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/not authorised/i))
  })

  it("shows the {churchName} and {from}/{to} variable hints", () => {
    render(<ReceiptSettingsSection settings={DEFAULT_RECEIPT_SETTINGS} />)
    expect(screen.getByText("Vars: {churchName}")).toBeInTheDocument()
    expect(screen.getByText("Vars: {from} {to}")).toBeInTheDocument()
  })

  it("applies the server length limits to each field", () => {
    render(<ReceiptSettingsSection settings={DEFAULT_RECEIPT_SETTINGS} />)

    expect(screen.getByLabelText(/receipt number prefix/i)).toHaveAttribute("maxlength", "20")
    expect(screen.getByLabelText(/receipt heading/i)).toHaveAttribute("maxlength", "120")
    expect(screen.getByLabelText(/total label/i)).toHaveAttribute("maxlength", "120")
    expect(screen.getByLabelText(/covered-period sentence/i)).toHaveAttribute("maxlength", "400")
    expect(screen.getByLabelText(/legal text/i)).toHaveAttribute("maxlength", "4000")
  })

  it("asks for confirmation before resetting, and Cancel resets nothing", async () => {
    render(<ReceiptSettingsSection settings={DEFAULT_RECEIPT_SETTINGS} />)
    fireEvent.click(screen.getByRole("button", { name: /reset all to defaults/i }))
    const dialog = await screen.findByRole("alertdialog")
    expect(resetReceiptSettings).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }))
    expect(resetReceiptSettings).not.toHaveBeenCalled()
  })

  it("resets all fields to defaults after confirming", async () => {
    const edited = { ...DEFAULT_RECEIPT_SETTINGS, numberPrefix: "RCPT" }
    render(<ReceiptSettingsSection settings={edited} />)
    const prefix = screen.getByLabelText(/receipt number prefix/i) as HTMLInputElement
    expect(prefix.value).toBe("RCPT")

    fireEvent.click(screen.getByRole("button", { name: /reset all to defaults/i }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: /^reset$/i }))

    await waitFor(() => expect(resetReceiptSettings).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(prefix.value).toBe(DEFAULT_RECEIPT_SETTINGS.numberPrefix))
  })

  it("adopts revalidated settings (blank saved as default) so the form is clean", () => {
    const { rerender } = render(<ReceiptSettingsSection settings={DEFAULT_RECEIPT_SETTINGS} />)
    const prefix = screen.getByLabelText(/receipt number prefix/i) as HTMLInputElement
    fireEvent.change(prefix, { target: { value: "" } })
    expect(prefix.value).toBe("")
    rerender(<ReceiptSettingsSection settings={{ ...DEFAULT_RECEIPT_SETTINGS }} />)
    expect(prefix.value).toBe("")
    rerender(<ReceiptSettingsSection settings={{ ...DEFAULT_RECEIPT_SETTINGS, numberPrefix: "NEW" }} />)
    expect(prefix.value).toBe("NEW")
  })
})
