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

  it("keeps both flags in sync when only one is changed", async () => {
    mockUpdate.mockResolvedValue({})
    render(<AutoEmailToggles birthday={false} anniversary={false} />)
    
    const birthdayToggle = screen.getByLabelText("Send birthday blessings automatically")
    fireEvent.click(birthdayToggle)
    
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument())
    
    const anniversaryToggle = screen.getByLabelText("Send anniversary blessings automatically")
    expect(anniversaryToggle).not.toBeChecked()
  })

  it("disables toggles while a request is pending", async () => {
    mockUpdate.mockImplementation(() => new Promise(() => {}))
    render(<AutoEmailToggles birthday={true} anniversary={false} />)
    
    const birthdayToggle = screen.getByLabelText("Send birthday blessings automatically")
    fireEvent.click(birthdayToggle)
    
    const toggles = screen.getAllByRole("switch")
    toggles.forEach(toggle => expect(toggle).toBeDisabled())
  })
})
