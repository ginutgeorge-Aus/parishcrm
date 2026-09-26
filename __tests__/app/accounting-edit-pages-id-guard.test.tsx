// Route-id guard for the admin accounting edit pages: a non-digit / out-of-range
// id must 404 before Prisma, and a valid id with no row must also 404.
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findUnique: jest.fn().mockResolvedValue(null) },
    accountGroup: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    fund: { findUnique: jest.fn().mockResolvedValue(null) },
  },
}))
jest.mock("@/lib/actions/account", () => ({ updateAccount: jest.fn() }))
jest.mock("@/lib/actions/accountGroup", () => ({ updateAccountGroup: jest.fn() }))
jest.mock("@/lib/actions/fund", () => ({ updateFund: jest.fn() }))
jest.mock("@/components/accounting/AccountForm", () => ({ AccountForm: () => null }))
jest.mock("@/components/accounting/AccountGroupForm", () => ({ AccountGroupForm: () => null }))
jest.mock("@/components/accounting/FundForm", () => ({ FundForm: () => null }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import EditAccountPage from "@/app/(dashboard)/accounting/accounts/[id]/edit/page"
import EditAccountGroupPage from "@/app/(dashboard)/accounting/accounts/groups/[id]/edit/page"
import EditFundPage from "@/app/(dashboard)/accounting/settings/funds/[id]/edit/page"

const mockAuth = auth as unknown as jest.Mock
const db = prisma as unknown as Record<string, { findUnique: jest.Mock }>

const pages = [
  ["account", EditAccountPage, "account"],
  ["account group", EditAccountGroupPage, "accountGroup"],
  ["fund", EditFundPage, "fund"],
] as const

const call = (Page: (p: { params: Promise<{ id: string }> }) => Promise<unknown>, id: string) =>
  Page({ params: Promise.resolve({ id }) })

describe.each(pages)("edit %s page id guard", (_name, Page, model) => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  })

  it.each(["abc", "0", "12abc", "2147483648"])("404s on invalid id %p without querying", async (id) => {
    await expect(call(Page, id)).rejects.toThrow("NOT_FOUND")
    expect(db[model].findUnique).not.toHaveBeenCalled()
  })

  it("404s when the row does not exist", async () => {
    await expect(call(Page, "5")).rejects.toThrow("NOT_FOUND")
    expect(db[model].findUnique).toHaveBeenCalledWith({ where: { id: 5 } })
  })
})
