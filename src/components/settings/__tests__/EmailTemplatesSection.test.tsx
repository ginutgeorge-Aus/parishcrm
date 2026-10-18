import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { EmailTemplatesSection } from "@/components/settings/EmailTemplatesSection"
import { EmailTemplateForm } from "@/components/settings/EmailTemplateForm"
import { updateEmailTemplate, previewEmailTemplate, sendTestEmail } from "@/lib/actions/emailTemplates"
import {
  DEFAULT_EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_KEYS,
  EMAIL_TEMPLATE_LABELS,
  visibleEmailTemplateKeys,
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

  it("previews only the visible tab, then each tab once when first opened", async () => {
    const user = userEvent.setup()
    render(<EmailTemplatesSection templates={templates} />)
    const [first, second] = EMAIL_TEMPLATE_KEYS
    await waitFor(() => expect(previewEmailTemplate).toHaveBeenCalledTimes(1))
    expect(previewEmailTemplate).toHaveBeenCalledWith(first, templates[first])

    await user.click(screen.getByRole("tab", { name: EMAIL_TEMPLATE_LABELS[second] }))
    await user.click(screen.getByRole("tab", { name: EMAIL_TEMPLATE_LABELS[first] }))
    await user.click(screen.getByRole("tab", { name: EMAIL_TEMPLATE_LABELS[second] }))
    expect(previewEmailTemplate).toHaveBeenCalledTimes(2)
    expect(previewEmailTemplate).toHaveBeenLastCalledWith(second, templates[second])
  })
})

describe("feature-owned templates", () => {
  it("shows only the given keys as tabs", () => {
    render(<EmailTemplatesSection templates={templates} keys={["welcome", "receipt"]} />)
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      EMAIL_TEMPLATE_LABELS.welcome, EMAIL_TEMPLATE_LABELS.receipt,
    ])
  })

  it("visibleEmailTemplateKeys drops templates whose feature is off and keeps core ones", () => {
    expect(visibleEmailTemplateKeys(new Set())).toEqual(["welcome"])
    expect(visibleEmailTemplateKeys(new Set(["receipts", "familyUpdates", "dgrReceipts"]))).toEqual([...EMAIL_TEMPLATE_KEYS])
    expect(visibleEmailTemplateKeys(new Set(["dgrReceipts"]))).toEqual(["welcome", "dgrReceipt"])
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

    // The message can commit before the transition's pending flag clears, so wait
    // for Save to re-enable; clicking a disabled submit is a no-op.
    const save = screen.getByRole("button", { name: "Save" })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)
    await waitFor(() => expect(screen.queryByText("Test sent.")).toBeNull())
  })
})
