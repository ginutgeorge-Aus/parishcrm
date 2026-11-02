import { render, screen } from "@testing-library/react"
import { FormFeedback } from "@/components/ui/FormFeedback"

describe("FormFeedback", () => {
  it("announces errors via role=alert with the destructive token", () => {
    render(<FormFeedback state={{ error: "Invalid email or password" }} />)
    const el = screen.getByRole("alert")
    expect(el).toHaveTextContent("Invalid email or password")
    expect(el.className).toContain("text-destructive")
  })

  it("announces success politely via role=status with the income token", () => {
    render(<FormFeedback state={{ success: "Saved" }} />)
    const el = screen.getByRole("status")
    expect(el).toHaveTextContent("Saved")
    expect(el).toHaveAttribute("aria-live", "polite")
    expect(el.className).toContain("text-income")
  })

  it("renders a warning as a destructive-styled alert alongside success", () => {
    render(<FormFeedback state={{ success: "Saved", warning: "Heads up" }} />)
    const el = screen.getByRole("alert")
    expect(el).toHaveTextContent("Heads up")
    expect(el.className).toContain("text-destructive")
    expect(screen.getByRole("status")).toHaveTextContent("Saved")
  })

  it("renders both the error and the warning when both are present", () => {
    render(<FormFeedback state={{ error: "Bad", warning: "Heads up" }} />)
    const alerts = screen.getAllByRole("alert")
    expect(alerts).toHaveLength(2)
    expect(alerts[0]).toHaveTextContent("Bad")
    expect(alerts[1]).toHaveTextContent("Heads up")
  })

  it("renders nothing when there is no message", () => {
    const { container } = render(<FormFeedback state={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders nothing for empty-string messages", () => {
    const { container } = render(<FormFeedback state={{ error: "" }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("prefers the error message when both are present", () => {
    render(<FormFeedback state={{ error: "Bad", success: "Good" }} />)
    expect(screen.getByRole("alert")).toHaveTextContent("Bad")
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("puts a custom className once on the outer wrapper, not on each line", () => {
    const { container } = render(<FormFeedback state={{ error: "x", warning: "w" }} className="mt-4" />)
    expect(container.firstElementChild?.className).toContain("mt-4")
    for (const el of screen.getAllByRole("alert")) expect(el.className).not.toContain("mt-4")
  })

  it("gives only the warning block the width, border and padding", () => {
    render(<FormFeedback state={{ error: "x", warning: "w" }} />)
    const [err, warn] = screen.getAllByRole("alert")
    expect(err.className).not.toContain("border")
    expect(warn.className).toContain("w-full")
    expect(warn.className).toContain("border")
    expect(warn.className).toContain("p-2")
  })

  it("puts the id on the error line so inputs can wire aria-describedby", () => {
    render(<FormFeedback state={{ error: "Invalid email or password" }} id="login-error" />)
    expect(screen.getByRole("alert")).toHaveAttribute("id", "login-error")
  })
})
