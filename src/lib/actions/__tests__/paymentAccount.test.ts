/** @jest-environment node */

jest.mock("@/lib/featureFlags")
import {
  createPaymentAccount,
  renamePaymentAccount,
  setDefaultAccount,
  setAccountActive,
} from "../paymentAccount"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), logAuditTx: jest.fn() }))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    paymentAccount: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { logAuditTx } from "@/lib/audit"
import { AUDIT_FAILED_ERROR } from "@/lib/auditGuard"

const mockAuth = auth as jest.Mock

/** Distinct transaction client: writes must go through `tx`, reads outside the transaction through `prisma`. */
const tx = {
  paymentAccount: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
}

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.append(k, v)
  return f
}

function mockRole(role: string): void {
  mockAuth.mockResolvedValue({ user: { role, id: "1" } })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRole("ADMIN")
  ;(prisma.$transaction as jest.Mock).mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
})

describe("audit atomicity", () => {
  it("returns AUDIT_FAILED_ERROR (mutation rolled back) when the audit write fails", async () => {
    ;(tx.paymentAccount.create as jest.Mock).mockResolvedValue({ id: 5 })
    ;(tx.paymentAccount.update as jest.Mock).mockResolvedValue({ id: 1 })
    ;(prisma.paymentAccount.findUnique as jest.Mock).mockResolvedValue({ id: 2, kind: "BANK", isActive: true, isDefault: false })
    for (const run of [
      () => createPaymentAccount(undefined, fd({ name: "ANZ", kind: "BANK" })),
      () => renamePaymentAccount(1, undefined, fd({ name: "New" })),
      () => setDefaultAccount(2),
      () => setAccountActive(2, false),
    ]) {
      ;(logAuditTx as jest.Mock).mockRejectedValueOnce(new Error("audit down"))
      expect(await run()).toEqual({ error: AUDIT_FAILED_ERROR })
    }
  })
})

describe("createPaymentAccount", () => {
  it("rejects creating a second active cash account", async () => {
    ;(prisma.paymentAccount.findFirst as jest.Mock).mockResolvedValue({ id: 1 }) // existing active CASH
    const res = await createPaymentAccount(undefined, fd({ name: "Cash 2", kind: "CASH" }))
    expect(res).toEqual({ error: "Only one active cash account is allowed" })
    expect(tx.paymentAccount.create).not.toHaveBeenCalled()
  })

  it("creates a bank account and audits", async () => {
    ;(tx.paymentAccount.create as jest.Mock).mockResolvedValue({ id: 5 })
    const res = await createPaymentAccount(undefined, fd({ name: "ANZ Church", kind: "BANK" }))
    expect(res).toEqual({ success: "Account added" })
    expect(tx.paymentAccount.create).toHaveBeenCalledWith({
      data: { name: "ANZ Church", kind: "BANK" },
    })
    expect(logAuditTx).toHaveBeenCalledWith(tx, 1, "SETTING_UPDATED", "PaymentAccount", 5, {
      name: "ANZ Church",
      kind: "BANK",
    })
  })

  it("blocks non-accounting roles", async () => {
    mockRole("VIEWER")
    const res = await createPaymentAccount(undefined, fd({ name: "Cash 2", kind: "CASH" }))
    expect(res).toEqual({ error: "Unauthorized" })
    expect(tx.paymentAccount.create).not.toHaveBeenCalled()
  })

  it("blocks PASTOR — payment-account management is ADMIN-only, matching the settings page", async () => {
    mockRole("PASTOR")
    const res = await createPaymentAccount(undefined, fd({ name: "Cash 2", kind: "CASH" }))
    expect(res).toEqual({ error: "Unauthorized" })
    expect(tx.paymentAccount.create).not.toHaveBeenCalled()
  })

  it("rejects an invalid kind", async () => {
    const res = await createPaymentAccount(undefined, fd({ name: "X", kind: "WALLET" }))
    expect(res).toEqual({ error: expect.any(String) })
    expect(tx.paymentAccount.create).not.toHaveBeenCalled()
  })
})

describe("renamePaymentAccount", () => {
  it("renames an account", async () => {
    ;(tx.paymentAccount.update as jest.Mock).mockResolvedValue({ id: 1 })
    const res = await renamePaymentAccount(1, undefined, fd({ name: "New Name" }))
    expect(res).toEqual({ success: "Renamed" })
    expect(tx.paymentAccount.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { name: "New Name" },
    })
    expect(logAuditTx).toHaveBeenCalledWith(tx, 1, "SETTING_UPDATED", "PaymentAccount", 1, {
      name: "New Name",
    })
  })

  it("blocks non-accounting roles", async () => {
    mockRole("AUDITOR")
    const res = await renamePaymentAccount(1, undefined, fd({ name: "New Name" }))
    expect(res).toEqual({ error: "Unauthorized" })
    expect(tx.paymentAccount.update).not.toHaveBeenCalled()
  })
})

describe("setDefaultAccount", () => {
  it("rejects making a cash account the default", async () => {
    ;(prisma.paymentAccount.findUnique as jest.Mock).mockResolvedValue({ id: 3, kind: "CASH", isActive: true })
    const res = await setDefaultAccount(3)
    expect(res).toEqual({ error: "The default account must be a bank account" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("rejects setting an inactive bank account as default", async () => {
    ;(prisma.paymentAccount.findUnique as jest.Mock).mockResolvedValue({ id: 2, kind: "BANK", isActive: false })
    const res = await setDefaultAccount(2)
    expect(res).toEqual({ error: "Activate the account before making it the default" })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("sets the default in a single transaction, unsetting the prior default", async () => {
    ;(prisma.paymentAccount.findUnique as jest.Mock).mockResolvedValue({ id: 2, kind: "BANK", isActive: true })
    const res = await setDefaultAccount(2)
    expect(res).toEqual({ success: "Default set" })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.paymentAccount.updateMany).toHaveBeenCalledWith({ where: { isDefault: true }, data: { isDefault: false } })
    expect(tx.paymentAccount.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { isDefault: true } })
    expect(logAuditTx).toHaveBeenCalledWith(tx, 1, "SETTING_UPDATED", "PaymentAccount", 2, {
      isDefault: true,
    })
  })

  it("blocks non-accounting roles", async () => {
    mockRole("VIEWER")
    const res = await setDefaultAccount(1)
    expect(res).toEqual({ error: "Unauthorized" })
  })
})

describe("setAccountActive", () => {
  it("rejects deactivating the only active cash account", async () => {
    ;(prisma.paymentAccount.findUnique as jest.Mock).mockResolvedValue({
      id: 3,
      kind: "CASH",
      isActive: true,
      isDefault: false,
    })
    ;(prisma.paymentAccount.count as jest.Mock).mockResolvedValue(1) // only one active CASH
    const res = await setAccountActive(3, false)
    expect(res).toEqual({ error: "Cannot deactivate the only active cash account" })
    expect(tx.paymentAccount.update).not.toHaveBeenCalled()
  })

  it("rejects deactivating the current default account", async () => {
    ;(prisma.paymentAccount.findUnique as jest.Mock).mockResolvedValue({
      id: 1,
      kind: "BANK",
      isActive: true,
      isDefault: true,
    })
    const res = await setAccountActive(1, false)
    expect(res).toEqual({ error: "Reassign the default account before deactivating this one" })
    expect(tx.paymentAccount.update).not.toHaveBeenCalled()
  })

  it("rejects activating a cash account when an active cash account already exists", async () => {
    ;(prisma.paymentAccount.findUnique as jest.Mock).mockResolvedValue({
      id: 4,
      kind: "CASH",
      isActive: false,
      isDefault: false,
    })
    ;(prisma.paymentAccount.count as jest.Mock).mockResolvedValue(1)
    const res = await setAccountActive(4, true)
    expect(res).toEqual({ error: "Only one active cash account is allowed" })
    expect(tx.paymentAccount.update).not.toHaveBeenCalled()
  })

  it("deactivates a non-default bank account", async () => {
    ;(prisma.paymentAccount.findUnique as jest.Mock).mockResolvedValue({
      id: 2,
      kind: "BANK",
      isActive: true,
      isDefault: false,
    })
    ;(tx.paymentAccount.update as jest.Mock).mockResolvedValue({ id: 2 })
    const res = await setAccountActive(2, false)
    expect(res).toEqual({ success: "Deactivated" })
    expect(logAuditTx).toHaveBeenCalledWith(tx, 1, "SETTING_UPDATED", "PaymentAccount", 2, {
      isActive: false,
    })
  })

  it("blocks non-accounting roles", async () => {
    mockRole("VIEWER")
    const res = await setAccountActive(1, false)
    expect(res).toEqual({ error: "Unauthorized" })
  })
})
