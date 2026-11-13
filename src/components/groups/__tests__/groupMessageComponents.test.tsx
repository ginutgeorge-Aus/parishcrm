/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

jest.mock("@/lib/groupRecipients", () => ({
  selectRecipients: jest.fn(),
  SKIP_REASON_LABELS: { NO_EMAIL: "No email address", NO_CONSENT: "Opted out of email", BAD_EMAIL: "Email address unreadable" },
}))
jest.mock("@/lib/groupMessageHistory", () => ({
  loadGroupMessageHistory: jest.fn(),
  STATUS_LABELS: { PENDING: "Queued", SENT: "Sent", FAILED: "Failed", UNKNOWN: "Unconfirmed" },
}))
jest.mock("@/lib/actions/groupMessage", () => ({ sendGroupMessage: jest.fn() }))

import { GroupMessageForm } from "@/components/groups/GroupMessageForm"
import { GroupComposeView, GroupHistoryView } from "@/components/groups/GroupMessageViews"
import { selectRecipients } from "@/lib/groupRecipients"
import { loadGroupMessageHistory } from "@/lib/groupMessageHistory"

beforeEach(() => jest.clearAllMocks())

describe("GroupMessageForm", () => {
  it("keeps the draft and shows the error when the action fails", async () => {
    const action = jest.fn().mockResolvedValue({ error: "Nope" })
    render(<GroupMessageForm action={action} canSend />)
    await userEvent.type(screen.getByLabelText("Subject"), "Hello")
    await userEvent.type(screen.getByLabelText("Message"), "Body text")
    await userEvent.click(screen.getByRole("button", { name: "Send email" }))
    expect(await screen.findByText("Nope")).toBeInTheDocument()
    expect(action).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText("Subject")).toHaveValue("Hello")
    expect(screen.getByLabelText("Message")).toHaveValue("Body text")
  })

  it("aria-disables send with a visible reason when nobody can receive, and blocks the click", async () => {
    const action = jest.fn()
    render(<GroupMessageForm action={action} canSend={false} />)
    const btn = screen.getByRole("button", { name: "Send email" })
    expect(btn).toHaveAttribute("aria-disabled", "true")
    expect(btn).not.toBeDisabled()
    expect(btn).toHaveAccessibleDescription(/every member is opted out or has no address/)
    await userEvent.type(screen.getByLabelText("Subject"), "Hello")
    await userEvent.type(screen.getByLabelText("Message"), "Body")
    await userEvent.click(btn)
    expect(action).not.toHaveBeenCalled()
  })
})

describe("GroupComposeView", () => {
  it("lists skipped members with reasons and singular wording", async () => {
    ;(selectRecipients as jest.Mock).mockResolvedValue({
      recipients: [{ personId: 1 }],
      skipped: [{ personId: 2, name: "Bob Ng", reason: "NO_CONSENT" }],
    })
    render(await GroupComposeView({ groupId: 4, historyHref: "/groups/4/messages" }))
    expect(screen.getByText("This email will go to 1 member.")).toBeInTheDocument()
    expect(screen.getByText("1 will not receive it:")).toBeInTheDocument()
    expect(screen.getByText("Bob Ng")).toBeInTheDocument()
    expect(screen.getByText("Opted out of email")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Sent messages" })).toHaveAttribute("href", "/groups/4/messages")
  })

  it("plural wording and no skipped block", async () => {
    ;(selectRecipients as jest.Mock).mockResolvedValue({ recipients: [{ personId: 1 }, { personId: 2 }], skipped: [] })
    render(await GroupComposeView({ groupId: 4, historyHref: "/h" }))
    expect(screen.getByText("This email will go to 2 members.")).toBeInTheDocument()
    expect(screen.queryByText(/will not receive it/)).toBeNull()
  })
})

describe("GroupHistoryView", () => {
  it("shows the empty state", async () => {
    ;(loadGroupMessageHistory as jest.Mock).mockResolvedValue({ messages: [], nextBefore: null })
    render(await GroupHistoryView({ groupId: 4, composeHref: "/groups/4/message" }))
    expect(screen.getByText("No messages sent yet.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "New message" })).toHaveAttribute("href", "/groups/4/message")
  })

  it("renders messages with tallies, labels and unknown-status fallbacks", async () => {
    ;(loadGroupMessageHistory as jest.Mock).mockResolvedValue({ nextBefore: 2, messages: [
      {
        id: 1, subject: "Hi all", body: "Line", createdAt: new Date("2026-11-13T00:00:00Z"), sentBy: "Pat",
        counts: { SENT: 1, WEIRD: 1 },
        recipients: [
          { personId: 1, name: "Ann Lee", status: "SENT" },
          { personId: 2, name: "Bob Ng", status: "WEIRD" },
        ],
      },
      { id: 2, subject: "Empty", body: "x", createdAt: new Date("2026-11-12T00:00:00Z"), sentBy: "Pat", counts: {}, recipients: [] },
    ] })
    render(await GroupHistoryView({ groupId: 4, composeHref: "/c", historyHref: "/h", before: 9 }))
    expect(loadGroupMessageHistory).toHaveBeenCalledWith(4, 9)
    expect(screen.getByRole("link", { name: "Older messages" })).toHaveAttribute("href", "/h?before=2")
    expect(screen.getByText("Hi all")).toBeInTheDocument()
    expect(screen.getByText(/1 sent, 1 weird/)).toBeInTheDocument()
    expect(screen.getByText(/no recipients/)).toBeInTheDocument()
    expect(screen.getByText("Ann Lee")).toBeInTheDocument()
    expect(screen.getByText("WEIRD")).toBeInTheDocument()
  })
})
