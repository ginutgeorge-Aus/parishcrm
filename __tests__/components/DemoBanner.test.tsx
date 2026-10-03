import { render, screen } from "@testing-library/react"
import { DemoBanner } from "@/components/DemoBanner"
import { DemoNotice } from "@/components/DemoNotice"

describe("demo banner + notice", () => {
  afterEach(() => { delete process.env.DEMO_MODE })

  it("render nothing when demo is off", () => {
    const { container } = render(<><DemoBanner /><DemoNotice /></>)
    expect(container).toBeEmptyDOMElement()
  })

  it("render copy when demo is on", () => {
    process.env.DEMO_MODE = "true"
    render(<><DemoBanner /><DemoNotice /></>)
    expect(screen.getByRole("status")).toHaveTextContent("Live demo — shared sandbox, resets nightly. Don't enter real data.")
    expect(screen.getByText(/Changes on this page are disabled in the live demo/)).toBeInTheDocument()
  })
})
