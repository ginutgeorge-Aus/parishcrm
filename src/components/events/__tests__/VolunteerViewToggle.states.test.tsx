import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { setVolunteerView } from "@/lib/actions/eventAccess"
import { VolunteerViewToggle } from "@/components/events/VolunteerViewToggle"

jest.mock("@/lib/actions/eventAccess", () => ({
  setVolunteerView: jest.fn(),
  regenerateVolunteerToken: jest.fn(),
}))

const mockSet = setVolunteerView as jest.Mock

describe("VolunteerViewToggle states", () => {
  beforeEach(() => jest.clearAllMocks())

  it("off: shows Turn on and no link", () => {
    render(<VolunteerViewToggle eventId={1} slug="picnic" initialEnabled={false} />)
    expect(screen.getByRole("button", { name: "Turn on" })).toBeInTheDocument()
    expect(screen.queryByDisplayValue(/\/crew\//)).not.toBeInTheDocument()
  })

  it("on at load: explains the link is shown only when created and offers Regenerate", () => {
    render(<VolunteerViewToggle eventId={1} slug="picnic" initialEnabled />)
    expect(screen.getByRole("button", { name: "Turn off" })).toBeInTheDocument()
    expect(screen.getByText(/shown only when created/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument()
  })

  it("turning on reveals the link once with Copy", async () => {
    mockSet.mockResolvedValue({ token: "tok123" })
    render(<VolunteerViewToggle eventId={1} slug="picnic" initialEnabled={false} />)
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }))
    const input = await screen.findByDisplayValue(/\/e\/picnic\/crew\/tok123$/)
    expect(input).toHaveAttribute("readonly")
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Turn off" })).toBeInTheDocument()
  })

  it("turning off clears the enabled state", async () => {
    mockSet.mockResolvedValue({ token: null })
    render(<VolunteerViewToggle eventId={1} slug="picnic" initialEnabled />)
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }))
    expect(await screen.findByRole("button", { name: "Turn on" })).toBeInTheDocument()
    expect(mockSet).toHaveBeenCalledWith(1, false)
  })

  it("shows an action error in an alert", async () => {
    mockSet.mockResolvedValue({ error: "Not allowed" })
    render(<VolunteerViewToggle eventId={1} slug="picnic" initialEnabled={false} />)
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed")
    expect(screen.getByRole("button", { name: "Turn on" })).toBeInTheDocument()
  })

  it("shows a generic error when the action throws", async () => {
    mockSet.mockRejectedValue(new Error("boom"))
    render(<VolunteerViewToggle eventId={1} slug="picnic" initialEnabled={false} />)
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }))
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not update volunteer view"))
  })
})
