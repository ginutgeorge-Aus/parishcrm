jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { upsert: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import {
  updateReceiptSettings,
  resetReceiptSettings,
} from "@/lib/actions/receiptSettings"

const asRole = (role: string | null) =>
  (auth as jest.Mock).mockResolvedValue(role ? { user: { id: "1", role } } : null)

beforeEach(() => {
  jest.clearAllMocks()
  ;(prisma.$transaction as jest.Mock).mockImplementation(
    async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)
  )
})

it("rejects non-admins", async () => {
  asRole("PASTOR")
  expect(await updateReceiptSettings({ receiptNumberPrefix: "X" })).toEqual({ error: expect.any(String) })
  expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
})

it("rejects an unknown key (allowlist)", async () => {
  asRole("ADMIN")
  const r = await updateReceiptSettings({ churchABN: "hacked" } as Record<string, string>)
  expect(r).toHaveProperty("error")
  expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
})

it("rejects an over-long legal text", async () => {
  asRole("ADMIN")
  const r = await updateReceiptSettings({ receiptLegalText: "x".repeat(4001) })
  expect(r).toHaveProperty("error")
})

it("upserts allowlisted keys for an admin", async () => {
  asRole("ADMIN")
  const r = await updateReceiptSettings({ receiptNumberPrefix: "RCPT", receiptDocumentTitle: "TAX RECEIPT" })
  expect(r).toEqual({ ok: true })
  expect(prisma.appSetting.upsert).toHaveBeenCalledTimes(2)
})

it("updates multiple settings in one transaction", async () => {
  asRole("ADMIN")

  await updateReceiptSettings({
    receiptNumberPrefix: "RCPT",
    receiptDocumentTitle: "TAX RECEIPT",
  })

  expect(prisma.$transaction).toHaveBeenCalledTimes(1)
})

it("resets all receipt settings in one delete", async () => {
  asRole("ADMIN")
  const r = await resetReceiptSettings()

  expect(r).toEqual({ ok: true })
  expect(prisma.appSetting.deleteMany).toHaveBeenCalledTimes(1)
  expect(prisma.appSetting.deleteMany).toHaveBeenCalledWith({
    where: { key: { in: expect.arrayContaining(["receiptLegalText", "receiptNumberPrefix"]) } },
  })
})
