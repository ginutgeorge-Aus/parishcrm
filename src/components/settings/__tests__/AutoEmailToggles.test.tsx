/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AutoEmailToggles } from "@/components/settings/AutoEmailToggles"
import { updateAutoEmailFlags } from "@/lib/actions/settings"

jest.mock("@/lib/actions/settings", () => ({ updateAutoEmailFlags: jest.fn() }))

const mockUpdate = updateAutoEmailFlags as jest.Mock

beforeEach(() => mockUpdate.mockReset())

describe("AutoEmailToggles", () => {
  it("renders with initial flag states", () => {
    render(<AutoEmailToggles birthday={true} anniversary={false} />)
    expect(screen.getByLabelText("Send birthday blessings automatically")).toBeChecked()
    expect(screen.getByLabelText("Send anniversary blessings automatically")).not.toBeChecked()
  })

  it("states each toggle's on/off state in text, not just the switch position", () => {
    render(<AutoEmailToggles birthday={false} anniversary={true} />)
    expect(screen.getByLabelText("Send birthday blessings automatically")).toHaveAccessibleDescription(
      "Automatic birthday emails are off.",
    )
    expect(screen.getByLabelText("Send anniversary blessings automatically")).toHaveAccessibleDescription(
      "Automatic anniversary emails are on (sent by the daily job).",
    )
    expect(screen.getByText("Off")).toBeInTheDocument()
    expect(screen.getByText("On")).toBeInTheDocument()
  })

  it("reverts toggle when server returns an error", async () => {
    mockUpdate.mockResolvedValue({ error: "Permission denied" })
    render(<AutoEmailToggles birthday={true} anniversary={false} />)
    
    const birthdayToggle = screen.getByLabelText("Send birthday blessings automatically") as HTMLInputElement
    expect(birthdayToggle).toBeChecked()
    
    fireEvent.click(birthdayToggle)
    expect(birthdayToggle).not.toBeChecked()
    
    await waitFor(() => {
      expect(screen.getByText("Permission denied")).toBeInTheDocument()
    })
    
    expect(birthdayToggle).toBeChecked()
  })

  it("shows a saved message when the server accepts the change", async () => {
    mockUpdate.mockResolvedValue({})
    render(<AutoEmailToggles birthday={false} anniversary={true} />)
    
    const anniversaryToggle = screen.getByLabelText("Send anniversary blessings automatically")
    fireEvent.click(anniversaryToggle)
    
    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeInTheDocument()
    })
  })

  it("sends only the toggled key so a stale other switch can't overwrite it", async () => {
    mockUpdate.mockResolvedValue({})
    render(<AutoEmailToggles birthday={false} anniversary={true} />)

    fireEvent.click(screen.getByLabelText("Send birthday blessings automatically"))

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument())
    const fd = mockUpdate.mock.calls[0][1] as FormData
    expect(fd.get("only")).toBe("autoBirthdayEmail")
    expect(fd.get("autoBirthdayEmail")).toBe("true")
    expect(fd.has("autoAnniversaryEmail")).toBe(false)
    expect(screen.getByLabelText("Send anniversary blessings automatically")).toBeChecked()
  })

  it("sends an explicit false when switching off", async () => {
    mockUpdate.mockResolvedValue({})
    render(<AutoEmailToggles birthday={true} anniversary={false} />)
    fireEvent.click(screen.getByLabelText("Send birthday blessings automatically"))
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument())
    expect((mockUpdate.mock.calls[0][1] as FormData).get("autoBirthdayEmail")).toBe("false")
  })

  it("resyncs both switches from the persisted flags the server returns on failure", async () => {
    mockUpdate.mockResolvedValue({ error: "Could not save", flags: { birthday: true, anniversary: true } })
    render(<AutoEmailToggles birthday={false} anniversary={false} />)
    fireEvent.click(screen.getByLabelText("Send birthday blessings automatically"))
    await screen.findByRole("alert")
    expect(screen.getByLabelText("Send birthday blessings automatically")).toBeChecked()
    expect(screen.getByLabelText("Send anniversary blessings automatically")).toBeChecked()
    expect(screen.getAllByText("On")).toHaveLength(2)
  })

  it("links the error to the switches while it is shown", async () => {
    mockUpdate.mockResolvedValue({ error: "Permission denied" })
    render(<AutoEmailToggles birthday={true} anniversary={false} />)
    const toggle = screen.getByLabelText("Send birthday blessings automatically")
    expect(toggle.getAttribute("aria-describedby")).toBe("autoBirthdayEmail-desc")
    fireEvent.click(toggle)
    await screen.findByRole("alert")
    expect(toggle.getAttribute("aria-describedby")).toBe("autoBirthdayEmail-desc auto-email-error")
    expect(toggle).toHaveAccessibleDescription(/Permission denied/)
  })

  it("disables toggles while a request is pending", async () => {
    mockUpdate.mockImplementation(() => new Promise(() => {}))
    render(<AutoEmailToggles birthday={true} anniversary={false} />)
    
    const birthdayToggle = screen.getByLabelText("Send birthday blessings automatically")
    fireEvent.click(birthdayToggle)
    
    const toggles = screen.getAllByRole("switch")
    toggles.forEach(toggle => expect(toggle).toBeDisabled())
  })

  it("does not present the optimistic state as saved while the request is pending", async () => {
    mockUpdate.mockImplementation(() => new Promise(() => {}))
    render(<AutoEmailToggles birthday={false} anniversary={false} />)
    const toggle = screen.getByLabelText("Send birthday blessings automatically")
    fireEvent.click(toggle)
    expect(toggle).toBeChecked() // switch moves optimistically
    expect(toggle).toHaveAccessibleDescription(/Saving automatic birthday email setting/)
    expect(screen.queryByText("On")).not.toBeInTheDocument()
    expect(screen.getAllByText("Off")).toHaveLength(1) // only the untouched anniversary row
    expect(screen.getByText("…")).toBeInTheDocument()
  })

  it("shows On only after the save succeeds", async () => {
    mockUpdate.mockResolvedValue({})
    render(<AutoEmailToggles birthday={false} anniversary={false} />)
    fireEvent.click(screen.getByLabelText("Send birthday blessings automatically"))
    expect(await screen.findByText("On")).toBeInTheDocument()
  })

  it("keeps the saved text and surfaces an alert when the save fails", async () => {
    mockUpdate.mockResolvedValue({ error: "Permission denied" })
    render(<AutoEmailToggles birthday={true} anniversary={false} />)
    const toggle = screen.getByLabelText("Send birthday blessings automatically")
    fireEvent.click(toggle)
    expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied")
    expect(toggle).toBeChecked()
    expect(toggle).toHaveAccessibleDescription("Automatic birthday emails are on (sent by the daily job). Permission denied")
    expect(screen.getByText("On")).toBeInTheDocument()
  })

  it("surfaces an error (no silent revert) when the action throws", async () => {
    mockUpdate.mockRejectedValue(new Error("network"))
    render(<AutoEmailToggles birthday={false} anniversary={false} />)
    const toggle = screen.getByLabelText("Send birthday blessings automatically")
    fireEvent.click(toggle)
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save")
    expect(toggle).not.toBeChecked()
  })
})
