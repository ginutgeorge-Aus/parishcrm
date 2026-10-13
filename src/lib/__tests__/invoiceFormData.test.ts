import { loadInvoiceFormData } from "@/lib/invoiceFormData"
import { prisma } from "@/lib/prisma"

jest.mock("@/lib/prisma", () => ({
  prisma: {
    person: { findMany: jest.fn(async () => [{ id: 5, firstName: "Alex", lastName: "Example" }]) },
    customer: { findMany: jest.fn(async () => [{ id: 3, name: "Example Scouts" }]) },
    account: { findMany: jest.fn(async () => [{ id: 4, code: "4001", name: "Hall hire" }]) },
    fund: { findMany: jest.fn(async () => [{ id: 2, name: "General" }]) },
  },
}))
jest.mock("@/lib/invoiceSettings", () => ({ getInvoiceSettings: jest.fn(async () => ({ gstRegistered: true, paymentDetails: "" })) }))

it("loads recipients (customers first), income accounts, funds and the GST flag", async () => {
  expect(await loadInvoiceFormData()).toEqual({
    recipients: [
      { kind: "customer", id: 3, name: "Example Scouts" },
      { kind: "person", id: 5, name: "Alex Example" },
    ],
    accounts: [{ id: 4, name: "4001 Hall hire" }],
    funds: [{ id: 2, name: "General" }],
    gstEnabled: true,
  })
  expect(prisma.account.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { type: "INCOME", isActive: true } }))
  expect(prisma.person.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { archivedAt: null } }))
})
