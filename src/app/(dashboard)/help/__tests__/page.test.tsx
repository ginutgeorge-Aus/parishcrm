import { render } from "@testing-library/react"
import HelpPage from "../page"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("REDIRECT") }) }))

import { auth } from "@/auth"

const mockAuth = auth as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

async function renderFor(role: string) {
  mockAuth.mockResolvedValue({ user: { id: "1", role } })
  const ui = await HelpPage()
  return render(ui).container.textContent ?? ""
}

// People & Families section is gated on canEdit (ADMIN | PASTOR | OFFICE_ADMIN);
// Accounting section is gated on canViewAccounting (ADMIN | PASTOR | AUDITOR | OFFICE_ADMIN).
// Login + Feedback + Events headings are always shown.
const CASES: Array<{ role: string; people: boolean; accounting: boolean }> = [
  { role: "ADMIN", people: true, accounting: true },
  { role: "PASTOR", people: true, accounting: true },
  { role: "OFFICE_ADMIN", people: true, accounting: true },
  { role: "AUDITOR", people: false, accounting: true },
  { role: "VIEWER", people: false, accounting: false },
]

it.each(CASES)(
  "$role: people=$people accounting=$accounting; always shows Login/Feedback/Events",
  async ({ role, people, accounting }) => {
    const text = await renderFor(role)

    expect(text).toContain("Login")
    expect(text).toContain("Feedback")
    expect(text).toContain("Events")

    if (people) expect(text).toContain("People")
    else expect(text).not.toContain("People")

    if (accounting) expect(text).toContain("Accounting")
    else expect(text).not.toContain("Accounting")
  },
)
