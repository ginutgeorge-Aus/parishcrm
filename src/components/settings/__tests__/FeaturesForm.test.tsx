/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { FeaturesForm } from "@/components/settings/FeaturesForm"
import { saveFeatures } from "@/lib/actions/features"
import { FEATURES } from "@/lib/features"

jest.mock("@/lib/actions/features", () => ({ saveFeatures: jest.fn() }))

const mockSave = saveFeatures as jest.Mock

beforeEach(() => mockSave.mockReset())

describe("FeaturesForm", () => {
  it("renders every feature with defaults applied", () => {
    render(<FeaturesForm initial={{ events: false }} />)
    for (const f of FEATURES) expect(screen.getByLabelText(f.label)).toBeInTheDocument()
    expect(screen.getByLabelText("Events")).not.toBeChecked()
    expect(screen.getByLabelText("Budget")).toBeChecked()
  })

  it("turning Accounting off disables its children", () => {
    render(<FeaturesForm initial={{}} />)
    expect(screen.getByLabelText("Budget")).toBeEnabled()
    fireEvent.click(screen.getByLabelText("Accounting"))
    expect(screen.getByLabelText("Budget")).toBeDisabled()
    expect(screen.getAllByText("Needs Accounting").length).toBeGreaterThan(0)
  })

  it("turning Membership forms off disables dues", () => {
    render(<FeaturesForm initial={{}} />)
    fireEvent.click(screen.getByLabelText("Membership forms"))
    expect(screen.getByLabelText("Subscription dues")).toBeDisabled()
    expect(screen.getByText("Needs Membership forms")).toBeInTheDocument()
  })

  it("warns when a feature with public links is turned off", () => {
    render(<FeaturesForm initial={{}} />)
    expect(screen.queryByText(/registration links will stop working/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("Events"))
    expect(screen.getByText(/registration links will stop working/)).toBeInTheDocument()
  })

  it("Save sends the full state and shows the result", async () => {
    mockSave.mockResolvedValue({ success: "Features saved" })
    render(<FeaturesForm initial={{}} />)
    fireEvent.click(screen.getByLabelText("Events"))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(screen.getByText("Features saved")).toBeInTheDocument())
    const sent = mockSave.mock.calls[0][0]
    expect(sent.events).toBe(false)
    expect(sent.budget).toBe(true)
    expect(Object.keys(sent)).toHaveLength(FEATURES.length)
  })

  it("shows the welcome banner only when welcome", () => {
    const { rerender } = render(<FeaturesForm initial={{}} />)
    expect(screen.queryByText(/Pick what your church needs/)).not.toBeInTheDocument()
    rerender(<FeaturesForm initial={{}} welcome />)
    expect(screen.getByText(/Pick what your church needs/)).toBeInTheDocument()
  })
})
