jest.mock("@/lib/featureFlags")
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { upsert: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/receiptSettings", () => ({
  readReceiptSettings: jest.fn(async () => ({ numberPrefix: "RCPT" })),
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { readReceiptSettings } from "@/lib/receiptSettings"
import { logAuditTx } from "@/lib/audit"
import { AUDIT_FAILED_ERROR } from "@/lib/auditGuard"
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
  // Returns the effective settings re-read after the write, so the form can adopt them.
  expect(r).toEqual({ ok: true, settings: { numberPrefix: "RCPT" } })
  expect(prisma.appSetting.upsert).toHaveBeenCalledTimes(2)
  expect(logAuditTx).toHaveBeenCalledWith(prisma, 1, "RECEIPT_SETTINGS_UPDATED", "AppSetting", undefined, {
    keys: ["receiptNumberPrefix", "receiptDocumentTitle"],
  })
})

it("returns AUDIT_FAILED_ERROR when the in-transaction audit write fails (update and reset)", async () => {
  asRole("ADMIN")
  ;(logAuditTx as jest.Mock).mockRejectedValueOnce(new Error("audit down"))
  expect(await updateReceiptSettings({ receiptNumberPrefix: "RCPT" })).toEqual({ error: AUDIT_FAILED_ERROR })
  ;(logAuditTx as jest.Mock).mockRejectedValueOnce(new Error("audit down"))
  expect(await resetReceiptSettings()).toEqual({ error: AUDIT_FAILED_ERROR })
})

it("omits settings (never reports defaults as saved) when the post-save read fails", async () => {
  asRole("ADMIN")
  ;(readReceiptSettings as jest.Mock).mockRejectedValueOnce(new Error("db down"))
  const r = await updateReceiptSettings({ receiptNumberPrefix: "RCPT" })
  expect(r).toEqual({ ok: true })
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
  expect(logAuditTx).toHaveBeenCalledWith(prisma, 1, "RECEIPT_SETTINGS_RESET", "AppSetting", undefined, { keys: expect.any(Array) })
  expect(prisma.appSetting.deleteMany).toHaveBeenCalledWith({
    where: { key: { in: expect.arrayContaining(["receiptLegalText", "receiptNumberPrefix"]) } },
  })
})
