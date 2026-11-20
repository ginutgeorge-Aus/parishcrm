import { render } from "@testing-library/react"
import FundReportPage from "../page"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("REDIRECT") }) }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/components/accounting/YearSelector", () => ({ YearSelector: () => <div /> }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { groupBy: jest.fn() },
    fund: { findMany: jest.fn() },
  },
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

beforeEach(() => {
  jest.clearAllMocks()
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.transaction.groupBy as jest.Mock).mockResolvedValue([])
  ;(prisma.fund.findMany as jest.Mock).mockResolvedValue([])
})

it("excludes the internal-transfer account from the fund groupBy (AUD-3-02)", async () => {
  render(await FundReportPage({ searchParams: Promise.resolve({}) }))
  const arg = (prisma.transaction.groupBy as jest.Mock).mock.calls[0][0]
  expect(arg.where).toMatchObject({ account: { code: { not: "XFER" } } })
})
