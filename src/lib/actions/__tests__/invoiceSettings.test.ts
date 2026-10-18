jest.mock("@/lib/featureFlags")
import { updateInvoiceSettings } from "@/lib/actions/invoiceSettings"
import { getInvoiceSettings } from "@/lib/invoiceSettings"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn(() => null) }))
jest.mock("@/lib/prisma", () => ({
  prisma: { appSetting: { findMany: jest.fn(), upsert: jest.fn() }, $transaction: jest.fn() },
}))

const mockAuth = auth as jest.Mock
beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (ops: unknown[]) => ops)
})

describe("getInvoiceSettings", () => {
  it("defaults when nothing is stored", async () => {
    ;(prisma.appSetting.findMany as jest.Mock).mockResolvedValue([])
    expect(await getInvoiceSettings()).toEqual({ gstRegistered: false, paymentDetails: "" })
  })
  it("reads stored values", async () => {
    ;(prisma.appSetting.findMany as jest.Mock).mockResolvedValue([
      { key: "invoiceGstRegistered", value: "true" }, { key: "invoicePaymentDetails", value: "BSB 000-000" },
    ])
    expect(await getInvoiceSettings()).toEqual({ gstRegistered: true, paymentDetails: "BSB 000-000" })
  })
})

describe("updateInvoiceSettings", () => {
  it.each(["PASTOR", "OFFICE_ADMIN", "AUDITOR", "VIEWER"])("rejects %s", async (role) => {
    mockAuth.mockResolvedValue({ user: { id: "1", role } })
    expect(await updateInvoiceSettings({ gstRegistered: true, paymentDetails: "" })).toEqual({ error: "Unauthorized" })
  })
  it("upserts both keys and audits", async () => {
    expect(await updateInvoiceSettings({ gstRegistered: true, paymentDetails: "BSB 000-000" })).toEqual({ ok: true })
    expect(prisma.appSetting.upsert).toHaveBeenCalledTimes(2)
    expect(logAudit).toHaveBeenCalledWith(1, "INVOICE_SETTINGS_UPDATED", "AppSetting", undefined, { gstRegistered: true })
  })
  it("rejects over-long payment details", async () => {
    expect(await updateInvoiceSettings({ gstRegistered: false, paymentDetails: "x".repeat(1001) }))
      .toEqual({ error: "Payment details must be 1000 characters or fewer" })
  })
})
