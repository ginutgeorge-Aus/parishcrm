import { act, render, screen, fireEvent, waitFor } from "@testing-library/react"
import { EmailTemplateForm } from "@/components/settings/EmailTemplateForm"
import { previewEmailTemplate, resetEmailTemplate } from "@/lib/actions/emailTemplates"
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates"

jest.mock("@/lib/actions/emailTemplates", () => ({
  updateEmailTemplate: jest.fn(),
  resetEmailTemplate: jest.fn(),
  previewEmailTemplate: jest.fn(),
  sendTestEmail: jest.fn(),
}))

describe("EmailTemplateForm", () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it.each([
    ["Preview", "before"],
    ["Preview", "after"],
    ["Reset to default", "before"],
    ["Reset to default", "after"],
  ])("ignores the mount preview after %s starts, resolving %s its response", async (button, timing) => {
    let resolveMount!: (value: { html: string }) => void
    const mountPreview = new Promise<{ html: string }>((resolve) => { resolveMount = resolve })
    let resolveAction!: () => void
    const actionReady = new Promise<void>((resolve) => { resolveAction = resolve })
    ;(previewEmailTemplate as jest.Mock)
      .mockReturnValueOnce(mountPreview)
      .mockImplementationOnce(async () => {
        await actionReady
        return { html: "<p>New preview</p>" }
      })
    ;(resetEmailTemplate as jest.Mock).mockImplementationOnce(async () => {
      await actionReady
      return { success: "Reset to default." }
    })
    render(<EmailTemplateForm templateKey="welcome" initial={{ subject: "draft", intro: "", body: "", signoff: "" }} />)
    fireEvent.change(screen.getByDisplayValue("draft"), { target: { value: "edited" } })
    fireEvent.click(screen.getByRole("button", { name: button }))

    if (timing === "before") {
      await act(async () => { resolveMount({ html: "<p>Stale mount preview</p>" }) })
      expect(screen.getByTitle("Email preview")).toHaveAttribute("srcdoc", "")
    }
    await act(async () => { resolveAction() })
    if (timing === "after") {
      await act(async () => { resolveMount({ html: "<p>Stale mount preview</p>" }) })
    }

    expect(screen.getByTitle("Email preview")).toHaveAttribute(
      "srcdoc", button === "Preview" ? "<p>New preview</p>" : ""
    )
    expect(screen.getByDisplayValue(button === "Preview" ? "edited" : DEFAULT_EMAIL_TEMPLATES.welcome.subject)).toBeInTheDocument()
  })

  it("hides the Body field for the receipt template", () => {
    render(<EmailTemplateForm templateKey="receipt" initial={{ subject: "s", intro: "", body: "", signoff: "x" }} />)
    expect(screen.queryByText("Body")).toBeNull()
    expect(screen.getByText("Sign-off / footer")).toBeInTheDocument()
  })
  it("shows the Body field for the welcome template", () => {
    render(<EmailTemplateForm templateKey="welcome" initial={{ subject: "s", intro: "", body: "b", signoff: "" }} />)
    expect(screen.getByText("Body")).toBeInTheDocument()
  })
  it("shows variable chips for the template", () => {
    render(<EmailTemplateForm templateKey="welcome" initial={{ subject: "s", intro: "", body: "", signoff: "" }} />)
    expect(screen.getByText("{name}")).toBeInTheDocument()
    expect(screen.getByText("{churchName}")).toBeInTheDocument()
  })

  // Before the fix, Reset persisted defaults server-side but left the controlled
  // fields showing the prior draft, so a later Save wrote the stale draft back.
  it("replaces the on-screen draft with defaults after a successful reset", async () => {
    ;(resetEmailTemplate as jest.Mock).mockResolvedValue({ success: "Reset to default." })
    render(<EmailTemplateForm templateKey="welcome" initial={{ subject: "MY OLD DRAFT", intro: "x", body: "b", signoff: "s" }} />)
    expect(screen.getByDisplayValue("MY OLD DRAFT")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Reset to default"))

    await waitFor(() =>
      expect(screen.getByDisplayValue(DEFAULT_EMAIL_TEMPLATES.welcome.subject)).toBeInTheDocument()
    )
    expect(screen.queryByDisplayValue("MY OLD DRAFT")).toBeNull()
  })
})
