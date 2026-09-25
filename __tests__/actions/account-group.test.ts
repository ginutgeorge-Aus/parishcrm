/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    accountGroup: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    account: {
      count: jest.fn(),
    },
    // deleteAccountGroup runs count + delete in one Serializable tx:
    // run the callback against a tx client proxying the same mocks.
    $transaction: jest.fn((fn: (tx: unknown) => unknown) =>
      fn({ account: prisma.account, accountGroup: prisma.accountGroup })
    ),
  }
  return { prisma }
})
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  createAccountGroup,
  updateAccountGroup,
  deleteAccountGroup,
} from "@/lib/actions/accountGroup"

const mockSession = auth as jest.Mock
const mockCreate = prisma.accountGroup.create as jest.Mock
const mockUpdate = prisma.accountGroup.update as jest.Mock
const mockDelete = prisma.accountGroup.delete as jest.Mock
const mockFindUnique = prisma.accountGroup.findUnique as jest.Mock
const mockAccountCount = prisma.account.count as jest.Mock
const mockRevalidate = revalidatePath as jest.Mock
const mockRedirect = redirect as unknown as jest.Mock

function fd(fields: Record<string, string>) {
  const f = new FormData()
  Object.entries(fields).forEach(([k, v]) => f.set(k, v))
  return f
}

const validGroup = { name: "Regular Income", type: "INCOME", sortOrder: "1" }

beforeEach(() => jest.clearAllMocks())

describe("createAccountGroup", () => {
  it("blocks PASTOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await createAccountGroup(undefined, fd(validGroup))
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("blocks VIEWER", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await createAccountGroup(undefined, fd(validGroup))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("returns validation error for missing name", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await createAccountGroup(undefined, fd({ ...validGroup, name: "" }))
    expect(result).toEqual({ error: "Name is required" })
  })

  it("returns error for duplicate name+type", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 5, name: "Regular Income", type: "INCOME", sortOrder: 0 })
    const result = await createAccountGroup(undefined, fd(validGroup))
    expect(result).toEqual({ error: "A group with this name already exists for this type" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("creates group and redirects for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue(null)
    await createAccountGroup(undefined, fd(validGroup))
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Regular Income", type: "INCOME", sortOrder: 1 }),
    })
    expect(mockRevalidate).toHaveBeenCalledWith("/accounting/accounts/groups")
    expect(mockRedirect).toHaveBeenCalledWith("/accounting/accounts/groups")
  })

  it("maps a concurrent-create P2002 to the friendly duplicate error", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue(null) // TOCTOU: pre-check passes, race loses at insert
    mockCreate.mockRejectedValue({ code: "P2002" })
    const result = await createAccountGroup(undefined, fd(validGroup))
    expect(result).toEqual({ error: "A group with this name already exists for this type" })
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})

describe("updateAccountGroup", () => {
  it("blocks PASTOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await updateAccountGroup(1, undefined, fd(validGroup))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("rejects invalid id before any DB call", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await updateAccountGroup(-1, undefined, fd(validGroup))
    expect(result).toEqual({ error: "Invalid ID" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("returns error when group not found", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue(null)
    const result = await updateAccountGroup(99, undefined, fd(validGroup))
    expect(result).toEqual({ error: "Group not found" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("updates group and redirects for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1, name: "Old", type: "INCOME", sortOrder: 0 })
    await updateAccountGroup(1, undefined, fd({ ...validGroup, name: "Updated" }))
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ name: "Updated" }),
    })
    expect(mockRedirect).toHaveBeenCalledWith("/accounting/accounts/groups")
  })

  it("blocks a type change while accounts are assigned to the group", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1, name: "Regular Income", type: "INCOME", sortOrder: 0 })
    mockAccountCount.mockResolvedValue(3)
    const result = await updateAccountGroup(1, undefined, fd({ ...validGroup, type: "EXPENSE" }))
    expect(result).toEqual({ error: "Cannot change group type while accounts are assigned to it" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("allows a type change when no accounts are assigned", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique.mockResolvedValue({ id: 1, name: "Regular Income", type: "INCOME", sortOrder: 0 })
    mockAccountCount.mockResolvedValue(0)
    await updateAccountGroup(1, undefined, fd({ ...validGroup, type: "EXPENSE" }))
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ type: "EXPENSE" }),
    })
    expect(mockRedirect).toHaveBeenCalledWith("/accounting/accounts/groups")
  })

  it("maps a concurrent-rename P2002 to the friendly duplicate error", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockFindUnique
      .mockResolvedValueOnce({ id: 1, name: "Old", type: "INCOME", sortOrder: 0 }) // existing row
      .mockResolvedValueOnce(null) // duplicate pre-check passes
    mockUpdate.mockRejectedValue({ code: "P2002" })
    const result = await updateAccountGroup(1, undefined, fd({ ...validGroup, name: "Updated" }))
    expect(result).toEqual({ error: "A group with this name already exists for this type" })
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})

describe("deleteAccountGroup", () => {
  it("blocks PASTOR", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await deleteAccountGroup(1)
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("rejects invalid id before any DB call", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await deleteAccountGroup(2147483648)
    expect(result).toEqual({ error: "Invalid ID" })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("returns error when accounts exist in group", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountCount.mockResolvedValue(3)
    const result = await deleteAccountGroup(1)
    expect(result).toEqual({ error: "Reassign or delete accounts in this group first." })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("deletes group and revalidates for ADMIN", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountCount.mockResolvedValue(0)
    await deleteAccountGroup(1)
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 1 } })
    expect(mockRevalidate).toHaveBeenCalledWith("/accounting/accounts/groups")
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it("runs the count + delete inside one Serializable transaction", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    mockAccountCount.mockResolvedValue(0)
    await deleteAccountGroup(1)
    const mockTransaction = (prisma as unknown as { $transaction: jest.Mock }).$transaction
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTransaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" })
  })

  it("surfaces the safe 'reassign first' message on a P2034 write conflict", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    ;(prisma as unknown as { $transaction: jest.Mock }).$transaction.mockRejectedValueOnce(
      Object.assign(new Error("write conflict"), { code: "P2034" })
    )
    const result = await deleteAccountGroup(1)
    expect(result).toEqual({ error: "Reassign or delete accounts in this group first." })
  })

  it("rethrows a non-P2034 DB error", async () => {
    mockSession.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    ;(prisma as unknown as { $transaction: jest.Mock }).$transaction.mockRejectedValueOnce(
      new Error("boom")
    )
    await expect(deleteAccountGroup(1)).rejects.toThrow("boom")
  })
})
