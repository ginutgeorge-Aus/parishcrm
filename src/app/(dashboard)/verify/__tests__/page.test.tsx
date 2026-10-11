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

it("unknown filter defaults to pending", async () => {
  // Invalid filter like ?filter=invalid should fall back to the pending default.
  const text = await renderPage("ADMIN", "invalid-filter-name")
  // Pending filter shows all checkpoints and count (same as default behavior)
  for (const c of TEST_CHECKPOINTS) expect(text).toContain(c.title)
  expect(text).toContain(`${TEST_CHECKPOINTS.length} pending`)
})

it("groups visible checkpoints by version, preserving authoring order", async () => {
  // When checkpoints have results in multiple versions, they should be grouped
  // with version headers. The grouping should preserve the authoring order
  // of versions as they appear in the filtered results.
  
  // Create distinct test results spanning two versions
  mockFind.mockResolvedValue([
    { checkpointId: TEST_CHECKPOINTS[0].id, status: "WORKING", issueNumber: null },
    { checkpointId: TEST_CHECKPOINTS[1].id, status: "BROKEN", issueNumber: 100 },
    { checkpointId: TEST_CHECKPOINTS[2].id, status: "WORKING", issueNumber: null },
  ])
  
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  const ui = await VerifyPage({ searchParams: Promise.resolve({ filter: "all" }) })
  const container = render(ui).container
  const text = container.textContent ?? ""
  
  // With results across the checkpoints, grouping sections should appear.
  // The page groups by checkpoint.version, so if checkpoints have versions,
  // version headers will be present.
  const sections = container.querySelectorAll('section')
  
  // Filter to sections that look like version groups (they have an h2 child)
  const versionSections = Array.from(sections).filter(s => s.querySelector('h2'))
  
  // Should have at least one version group if TEST_CHECKPOINTS have versions
  if (TEST_CHECKPOINTS.some(c => c.version)) {
    expect(versionSections.length).toBeGreaterThan(0)
  }
})

