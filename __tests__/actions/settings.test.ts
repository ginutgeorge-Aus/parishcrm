/** @jest-environment node */

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    person: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) },
  },
}))
jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  unstable_cache: (fn: unknown) => fn,
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }))

import { upsertSetting, getIdleTimeoutMinutes, updateChurchInfo, updatePettyCashCustodian } from "@/lib/actions/settings"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath, revalidateTag } from "next/cache"
import { logAudit } from "@/lib/audit"

const mockAuth = auth as jest.Mock
const mockUpsert = prisma.appSetting.upsert as jest.Mock
const mockFindUnique = prisma.appSetting.findUnique as jest.Mock
const mockRevalidate = revalidatePath as jest.Mock
const mockRevalidateTag = revalidateTag as jest.Mock
const mockLogAudit = logAudit as jest.Mock

function makeFormData(key: string, value: string) {
  const fd = new FormData()
  fd.append("key", key)
  fd.append("value", value)
  return fd
}

describe("upsertSetting", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns error for unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    const result = await upsertSetting(undefined, makeFormData("ownerNotificationEmail", "a@b.com"))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("returns error for PASTOR", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await upsertSetting(undefined, makeFormData("ownerNotificationEmail", "a@b.com"))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("returns error for VIEWER", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "VIEWER" } })
    const result = await upsertSetting(undefined, makeFormData("ownerNotificationEmail", "a@b.com"))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("returns error and does not upsert when key is not in allowlist", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await upsertSetting(undefined, makeFormData("injectedKey", "evil"))
    expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }))
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("calls prisma upsert with correct args for valid key", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    await upsertSetting(undefined, makeFormData("ownerNotificationEmail", "owner@church.com"))
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { key: "ownerNotificationEmail" },
      create: { key: "ownerNotificationEmail", value: "owner@church.com" },
      update: { value: "owner@church.com" },
    })
  })

  it("returns success for valid key", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await upsertSetting(undefined, makeFormData("ownerNotificationEmail", "owner@church.com"))
    expect(result).toEqual(expect.objectContaining({ success: expect.any(String) }))
  })

  it("calls revalidatePath('/settings') on success", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    await upsertSetting(undefined, makeFormData("ownerNotificationEmail", "owner@church.com"))
    expect(mockRevalidate).toHaveBeenCalledWith("/settings")
  })

  it("accepts empty string value (clearing a setting)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await upsertSetting(undefined, makeFormData("ownerNotificationEmail", ""))
    expect(result).toEqual(expect.objectContaining({ success: expect.any(String) }))
  })

  it("returns error for AUDITOR", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "AUDITOR" } })
    const result = await upsertSetting(undefined, makeFormData("ownerNotificationEmail", "a@b.com"))
    expect(result).toEqual({ error: "Unauthorized" })
  })

  it("accepts SESSION_IDLE_TIMEOUT_MINUTES with valid option", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await upsertSetting(undefined, makeFormData("SESSION_IDLE_TIMEOUT_MINUTES", "30"))
    expect(result).toEqual(expect.objectContaining({ success: expect.any(String) }))
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "SESSION_IDLE_TIMEOUT_MINUTES" } }))
  })

  it("accepts SESSION_IDLE_TIMEOUT_MINUTES boundary values 15 and 120", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    for (const v of ["15", "120"]) {
      jest.clearAllMocks()
      const result = await upsertSetting(undefined, makeFormData("SESSION_IDLE_TIMEOUT_MINUTES", v))
      expect(result).toEqual(expect.objectContaining({ success: expect.any(String) }))
    }
  })

  it("rejects SESSION_IDLE_TIMEOUT_MINUTES with invalid value", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await upsertSetting(undefined, makeFormData("SESSION_IDLE_TIMEOUT_MINUTES", "45"))
    expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }))
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("rejects SESSION_IDLE_TIMEOUT_MINUTES with empty string", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await upsertSetting(undefined, makeFormData("SESSION_IDLE_TIMEOUT_MINUTES", ""))
    expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }))
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("rejects a non-email ownerNotificationEmail", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const result = await upsertSetting(undefined, makeFormData("ownerNotificationEmail", "not-an-email"))
    expect(result).toEqual({ error: "Invalid email address" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("accepts a blank ownerNotificationEmail (clears the setting)", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const result = await upsertSetting(undefined, makeFormData("ownerNotificationEmail", ""))
    expect(result).toEqual({ success: "Settings saved" })
  })

  it("rejects a non-email churchEmail via the generic path", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const result = await upsertSetting(undefined, makeFormData("churchEmail", "nope"))
    expect(result).toEqual({ error: "Invalid email address" })
  })

  it("accepts a valid membershipSecretaryEmail", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const result = await upsertSetting(undefined, makeFormData("membershipSecretaryEmail", "sec@church.com"))
    expect(result).toEqual({ success: "Settings saved" })
  })

  it("rejects a non-email membershipSecretaryEmail", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const result = await upsertSetting(undefined, makeFormData("membershipSecretaryEmail", "nope"))
    expect(result).toEqual({ error: "Invalid email address" })
  })

  it("audits the key only — never the raw value", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    await upsertSetting(undefined, makeFormData("ownerNotificationEmail", "owner@example.com"))
    expect(mockLogAudit).toHaveBeenCalledWith(1, "SETTING_UPDATED", "AppSetting", undefined, { key: "ownerNotificationEmail" })
  })
})

function churchForm(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return fd
}

const upsertedKeys = () =>
  mockUpsert.mock.calls.map((c) => c[0].where.key as string)

describe("updateChurchInfo", () => {
  beforeEach(() => jest.clearAllMocks())

  it("rejects non-admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    const result = await updateChurchInfo(
      undefined,
      churchForm({ churchName: "Example Church", churchAddress: "1 St", churchABN: "12 345 678 901" })
    )
    expect(result).toEqual({ error: "Unauthorized" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("writes only allowlisted church keys", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    await updateChurchInfo(
      undefined,
      churchForm({ churchName: "Example Church", churchAddress: "1 St", churchABN: "12 345 678 901" })
    )
    const allowed = new Set(["churchName", "churchAddress", "churchABN", "churchEmail"])
    expect(upsertedKeys().every((k) => allowed.has(k))).toBe(true)
  })

  it("upserts churchEmail when a valid email is provided", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    await updateChurchInfo(
      undefined,
      churchForm({ churchName: "Example Church", churchAddress: "1 St", churchABN: "12 345 678 901", churchEmail: "office@example.com" })
    )
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { key: "churchEmail" },
      create: { key: "churchEmail", value: "office@example.com" },
      update: { value: "office@example.com" },
    })
  })

  it("rejects an invalid churchEmail and writes nothing", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "ADMIN" } })
    const result = await updateChurchInfo(
      undefined,
      churchForm({ churchName: "Example Church", churchAddress: "1 St", churchABN: "12 345 678 901", churchEmail: "not-an-email" })
    )
    expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }))
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("audits the keys actually written, including churchEmail", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    await updateChurchInfo(
      undefined,
      churchForm({ churchName: "Example Church", churchAddress: "1 St", churchABN: "12 345 678 901", churchEmail: "office@example.com" })
    )
    expect(mockLogAudit).toHaveBeenCalledWith(
      1,
      "SETTING_UPDATED",
      "AppSetting",
      undefined,
      { keys: expect.arrayContaining(["churchName", "churchAddress", "churchABN", "churchEmail"]) }
    )
  })

  it("busts the church-settings cache tag on success", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    await updateChurchInfo(
      undefined,
      churchForm({ churchName: "Example Church", churchAddress: "1 St", churchABN: "12 345 678 901" })
    )
    expect(mockRevalidateTag).toHaveBeenCalledWith("church-settings", "max")
    expect(mockRevalidate).toHaveBeenCalledWith("/settings")
  })

  it("does not bust the cache when not admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "999", role: "PASTOR" } })
    await updateChurchInfo(
      undefined,
      churchForm({ churchName: "Example Church", churchAddress: "1 St", churchABN: "12 345 678 901" })
    )
    expect(mockRevalidateTag).not.toHaveBeenCalled()
  })
})

describe("getIdleTimeoutMinutes", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns the default and never reads the DB when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null)
    expect(await getIdleTimeoutMinutes()).toBe(60)
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it("returns 60 when no setting exists", async () => {
    mockFindUnique.mockResolvedValue(null)
    expect(await getIdleTimeoutMinutes()).toBe(60)
  })

  it("returns parsed value when setting exists", async () => {
    mockFindUnique.mockResolvedValue({ key: "SESSION_IDLE_TIMEOUT_MINUTES", value: "30" })
    expect(await getIdleTimeoutMinutes()).toBe(30)
  })

  it("falls back to 60 for out-of-range value", async () => {
    mockFindUnique.mockResolvedValue({ key: "SESSION_IDLE_TIMEOUT_MINUTES", value: "999" })
    expect(await getIdleTimeoutMinutes()).toBe(60)
  })

  it("falls back to 60 for non-numeric value", async () => {
    mockFindUnique.mockResolvedValue({ key: "SESSION_IDLE_TIMEOUT_MINUTES", value: "bad" })
    expect(await getIdleTimeoutMinutes()).toBe(60)
  })

  it("falls back to 60 when DB throws", async () => {
    mockFindUnique.mockRejectedValue(new Error("db down"))
    expect(await getIdleTimeoutMinutes()).toBe(60)
  })

  it("returns correct value for boundary options 15 and 120", async () => {
    for (const [v, n] of [["15", 15], ["120", 120]] as [string, number][]) {
      mockFindUnique.mockResolvedValue({ key: "SESSION_IDLE_TIMEOUT_MINUTES", value: v })
      expect(await getIdleTimeoutMinutes()).toBe(n)
    }
  })
})

describe("updatePettyCashCustodian", () => {
  beforeEach(() => jest.clearAllMocks())

  function fd(custodianId: string) {
    const f = new FormData()
    f.set("custodianId", custodianId)
    return f
  }

  it("rejects non-admins", async () => {
    mockAuth.mockResolvedValue({ user: { role: "PASTOR", id: "1" } })
    const res = await updatePettyCashCustodian(undefined, fd("5"))
    expect(res).toEqual({ error: "Unauthorized" })
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
  })

  it("saves a valid existing person id", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue({ id: 5 })
    const res = await updatePettyCashCustodian(undefined, fd("5"))
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "pettyCashDefaultCustodianId" } })
    )
    expect(res).toEqual({ success: expect.any(String) })
  })

  it("clears the setting when custodianId is blank", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const res = await updatePettyCashCustodian(undefined, fd(""))
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "pettyCashDefaultCustodianId" }, create: { key: "pettyCashDefaultCustodianId", value: "" } })
    )
    expect(res).toEqual({ success: expect.any(String) })
  })

  it("rejects a person id that does not exist", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue(null)
    const res = await updatePettyCashCustodian(undefined, fd("999"))
    expect(res).toEqual({ error: "Selected person not found" })
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
  })

  it("rejects an archived person id", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    // findFirst scoped to archivedAt: null — an archived person resolves to
    // null, same as a nonexistent one.
    ;(prisma.person.findFirst as jest.Mock).mockResolvedValue(null)
    const res = await updatePettyCashCustodian(undefined, fd("5"))
    expect(res).toEqual({ error: "Selected person not found" })
    expect(prisma.person.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5, archivedAt: null } })
    )
    expect(prisma.appSetting.upsert).not.toHaveBeenCalled()
  })

  it("rejects a non-numeric id", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
    const res = await updatePettyCashCustodian(undefined, fd("abc"))
    expect(res).toEqual({ error: "Invalid custodian" })
  })
})
