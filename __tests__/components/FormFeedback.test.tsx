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

  it("merges a custom className", () => {
    render(<FormFeedback state={{ error: "x" }} className="mt-4" />)
    expect(screen.getByRole("alert").className).toContain("mt-4")
  })

  it("puts the id on the error line so inputs can wire aria-describedby", () => {
    render(<FormFeedback state={{ error: "Invalid email or password" }} id="login-error" />)
    expect(screen.getByRole("alert")).toHaveAttribute("id", "login-error")
  })
})
