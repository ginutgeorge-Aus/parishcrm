import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { EmailTemplatesSection } from "@/components/settings/EmailTemplatesSection"
import { EmailTemplateForm } from "@/components/settings/EmailTemplateForm"
import { updateEmailTemplate, previewEmailTemplate, sendTestEmail } from "@/lib/actions/emailTemplates"
import {
  DEFAULT_EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_KEYS,
  EMAIL_TEMPLATE_LABELS,
  type EmailTemplateFields,
  type EmailTemplateKey,
} from "@/lib/emailTemplates"

jest.mock("@/lib/actions/emailTemplates", () => ({
  updateEmailTemplate: jest.fn(),
  resetEmailTemplate: jest.fn(),
  previewEmailTemplate: jest.fn(),
  sendTestEmail: jest.fn(),
}))

const templates = DEFAULT_EMAIL_TEMPLATES as Record<EmailTemplateKey, EmailTemplateFields>

beforeEach(() => {
  jest.clearAllMocks()
  ;(previewEmailTemplate as jest.Mock).mockResolvedValue({ html: "<p>rendered</p>" })
})

describe("EmailTemplatesSection", () => {
  it("keeps unsaved edits when switching tabs and back", async () => {
    const user = userEvent.setup()
    render(<EmailTemplatesSection templates={templates} />)
    const [first, second] = EMAIL_TEMPLATE_KEYS

    fireEvent.change(screen.getAllByDisplayValue(templates[first].subject)[0], {
      target: { value: "MY UNSAVED DRAFT" },
    })
    await user.click(screen.getByRole("tab", { name: EMAIL_TEMPLATE_LABELS[second] }))
    await user.click(screen.getByRole("tab", { name: EMAIL_TEMPLATE_LABELS[first] }))

    expect(screen.getByDisplayValue("MY UNSAVED DRAFT")).toBeInTheDocument()
  })
})

describe("EmailTemplateForm preview + messages", () => {
  const initial = { subject: "s", intro: "i", body: "b", signoff: "x" }

  it("renders the preview on mount without pressing Preview", async () => {
    render(<EmailTemplateForm templateKey="welcome" initial={initial} />)
    await waitFor(() =>
      expect(screen.getByTitle("Email preview")).toHaveAttribute("srcdoc", "<p>rendered</p>")
    )
    expect(previewEmailTemplate).toHaveBeenCalledWith("welcome", initial)
  })

  it("clears the stale test-send message when saving", async () => {
    ;(sendTestEmail as jest.Mock).mockResolvedValue({ success: "Test sent." })
    ;(updateEmailTemplate as jest.Mock).mockResolvedValue({ success: "Saved." })
    render(<EmailTemplateForm templateKey="welcome" initial={initial} />)

    fireEvent.click(screen.getByText("Send test to me"))
    expect(await screen.findByText("Test sent.")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Save"))
    await waitFor(() => expect(screen.queryByText("Test sent.")).toBeNull())
  })
})
