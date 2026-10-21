/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { FeaturesForm } from "@/components/settings/FeaturesForm"
import { saveFeatures } from "@/lib/actions/features"
import { FEATURES } from "@/lib/features"
import { UnsavedChangesProvider, useUnsavedChanges } from "@/components/settings/unsavedChanges"

jest.mock("@/lib/actions/features", () => ({ saveFeatures: jest.fn() }))

const mockSave = saveFeatures as jest.Mock

beforeEach(() => mockSave.mockReset())

describe("FeaturesForm", () => {
  it("renders without React key warnings (with a positive control)", () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => undefined)
    const warned = () => err.mock.calls.flat().join(" ").includes('unique "key"')
    try {
      // Fresh module registry per render (own React + renderer): React logs a
      // missing-key warning once per instance, so test order cannot make either
      // assertion pass vacuously.
      const renderFresh = (build: (React: typeof import("react")) => React.ReactElement) =>
        jest.isolateModules(() => {
          const react = require("react") as typeof import("react")
          const { createRoot } = require("react-dom/client") as typeof import("react-dom/client")
          const { flushSync } = require("react-dom") as typeof import("react-dom")
          // Detached container + own root: nothing leaks into the document other tests query.
          const root = createRoot(document.createElement("div"))
          flushSync(() => root.render(build(react)))
          flushSync(() => root.unmount())
        })
      // Control: a deliberately key-less list MUST trigger the warning in this setup.
      renderFresh((R) => R.createElement("ul", null, [1, 2].map((n) => R.createElement("li", null, n))))
      expect(warned()).toBe(true)
      err.mockClear()
      renderFresh((R) => {
        const { FeaturesForm: Form } = require("@/components/settings/FeaturesForm") as typeof import("@/components/settings/FeaturesForm")
        return R.createElement(Form, { initial: {} })
      })
      expect(warned()).toBe(false)
    } finally {
      err.mockRestore()
    }
  })

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

  it("shows a retry message when the save request itself fails", async () => {
    mockSave.mockRejectedValue(new Error("network down"))
    render(<FeaturesForm initial={{}} />)
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(screen.getByText("Could not save features. Please try again.")).toBeInTheDocument())
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
  })

  it("links the blocking reason and public-link warning to their switch", () => {
    render(<FeaturesForm initial={{}} />)
    fireEvent.click(screen.getByLabelText("Accounting"))
    expect(screen.getByLabelText("Budget")).toHaveAccessibleDescription(expect.stringContaining("Needs Accounting"))
    fireEvent.click(screen.getByLabelText("Events"))
    const warning = screen.getByText(/registration links will stop working/)
    expect(warning).toHaveAttribute("role", "status")
    expect(screen.getByLabelText("Events")).toHaveAccessibleDescription(expect.stringContaining("registration links will stop working"))
  })

  it("shows the welcome banner only when welcome", () => {
    const { rerender } = render(<FeaturesForm initial={{}} />)
    expect(screen.queryByText(/Pick what your church needs/)).not.toBeInTheDocument()
    rerender(<FeaturesForm initial={{}} welcome />)
    expect(screen.getByText(/Pick what your church needs/)).toBeInTheDocument()
  })

  it("is clean on mount, dirty after a change, clean again when reverted", () => {
    let hasUnsaved = () => true
    function Probe() {
      hasUnsaved = useUnsavedChanges().hasUnsaved
      return null
    }
    render(<UnsavedChangesProvider><Probe /><FeaturesForm initial={{ budget: false }} /></UnsavedChangesProvider>)
    expect(hasUnsaved()).toBe(false)
    fireEvent.click(screen.getByLabelText("Accounting"))
    expect(hasUnsaved()).toBe(true)
    fireEvent.click(screen.getByLabelText("Accounting"))
    expect(hasUnsaved()).toBe(false)
  })
})
