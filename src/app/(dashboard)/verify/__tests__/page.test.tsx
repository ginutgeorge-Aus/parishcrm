import { render } from "@testing-library/react"
import VerifyPage from "../page"
import { TEST_CHECKPOINTS } from "@/lib/testCheckpoints"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("REDIRECT") }) }))
jest.mock("@/lib/prisma", () => ({
  prisma: { checkpointResult: { findMany: jest.fn() } },
}))
// CheckpointRow is a client component using actions; stub it to plain markup.
jest.mock("@/components/settings/CheckpointRow", () => ({
  CheckpointRow: ({ checkpoint, status }: { checkpoint: { title: string }; status: string }) => (
    <div data-status={status}>{checkpoint.title}</div>
  ),
}))

import { redirect } from "next/navigation"

const mockAuth = auth as jest.Mock
const mockFind = prisma.checkpointResult.findMany as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockFind.mockResolvedValue([])
})

async function renderPage(role: string, filter?: string) {
  mockAuth.mockResolvedValue({ user: { id: "1", role } })
  const ui = await VerifyPage({ searchParams: Promise.resolve(filter ? { filter } : {}) })
  return render(ui).container.textContent ?? ""
}

it("redirects non-admin", async () => {
  mockAuth.mockResolvedValue({ user: { id: "2", role: "PASTOR" } })
  await expect(
    VerifyPage({ searchParams: Promise.resolve({}) }),
  ).rejects.toThrow("REDIRECT")
  expect(redirect).toHaveBeenCalledWith("/")
})

it("renders all checkpoint titles for admin (default pending filter, none tested)", async () => {
  const text = await renderPage("ADMIN")
  for (const c of TEST_CHECKPOINTS) expect(text).toContain(c.title)
})

it("shows the pending count", async () => {
  const text = await renderPage("ADMIN")
  expect(text).toContain(`${TEST_CHECKPOINTS.length} pending`)
})

it("working filter hides untested checkpoints", async () => {
  // No results stored → nothing is WORKING → working filter shows empty state.
  const text = await renderPage("ADMIN", "working")
  expect(text).toContain("Nothing here")
})
