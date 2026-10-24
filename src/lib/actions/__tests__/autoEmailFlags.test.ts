/** @jest-environment node */
jest.mock("@/lib/featureFlags")
import { getAutoEmailFlags, updateAutoEmailFlags } from "@/lib/actions/settings"

jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock("@/auth", () => ({ auth: jest.fn(async () => ({ user: { id: "1", role: "ADMIN" } })) }))
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findMany: jest.fn(), upsert: jest.fn() } } }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => {}) }))

import { prisma } from "@/lib/prisma"

beforeEach(() => jest.clearAllMocks())

test("defaults both flags off when unset", async () => {
  ;(prisma.appSetting.findMany as jest.Mock).mockResolvedValue([])
  await expect(getAutoEmailFlags()).resolves.toEqual({ birthday: false, anniversary: false })
})

test("reads only 'true' as on, per key", async () => {
  ;(prisma.appSetting.findMany as jest.Mock).mockResolvedValue([
    { key: "autoBirthdayEmail", value: "true" },
    { key: "autoAnniversaryEmail", value: "false" },
  ])
  await expect(getAutoEmailFlags()).resolves.toEqual({ birthday: true, anniversary: false })
})

test("update writes true/false for both keys (absent checkbox ⇒ false) + audits", async () => {
  ;(prisma.appSetting.upsert as jest.Mock).mockResolvedValue({})
  const fd = new FormData()
  fd.set("autoBirthdayEmail", "true") // anniversary omitted → off
  const res = await updateAutoEmailFlags(undefined, fd)
  expect(res).toHaveProperty("success")
  const byKey = Object.fromEntries(
    (prisma.appSetting.upsert as jest.Mock).mock.calls.map((c) => [c[0].where.key, c[0].update.value]),
  )
  expect(byKey).toEqual({ autoBirthdayEmail: "true", autoAnniversaryEmail: "false" })
})

test("only=<key> writes just that key (stale other toggle can't be clobbered)", async () => {
  ;(prisma.appSetting.upsert as jest.Mock).mockResolvedValue({})
  const fd = new FormData()
  fd.set("only", "autoAnniversaryEmail")
  fd.set("autoAnniversaryEmail", "true")
  const res = await updateAutoEmailFlags(undefined, fd)
  expect(res).toHaveProperty("success")
  const calls = (prisma.appSetting.upsert as jest.Mock).mock.calls
  expect(calls).toHaveLength(1)
  expect(calls[0][0].where.key).toBe("autoAnniversaryEmail")
  expect(calls[0][0].update.value).toBe("true")
})

test("a failed write returns the persisted flags so the UI can resync", async () => {
  ;(prisma.appSetting.upsert as jest.Mock).mockRejectedValue(new Error("db"))
  ;(prisma.appSetting.findMany as jest.Mock).mockResolvedValue([{ key: "autoBirthdayEmail", value: "true" }])
  const fd = new FormData()
  fd.set("autoBirthdayEmail", "true")
  fd.set("autoAnniversaryEmail", "true")
  await expect(updateAutoEmailFlags(undefined, fd)).resolves.toEqual({
    error: "Could not save the automatic email setting",
    flags: { birthday: true, anniversary: false },
  })
})

test("a failed write with an unreadable store still returns the error", async () => {
  ;(prisma.appSetting.upsert as jest.Mock).mockRejectedValue(new Error("db"))
  ;(prisma.appSetting.findMany as jest.Mock).mockRejectedValue(new Error("db"))
  const res = await updateAutoEmailFlags(undefined, new FormData())
  expect(res).toMatchObject({ error: expect.any(String), flags: undefined })
})

test("a failed write waits for the other upsert before reading back", async () => {
  let release!: () => void
  const slow = new Promise((r) => (release = () => r({})))
  ;(prisma.appSetting.upsert as jest.Mock).mockRejectedValueOnce(new Error("db")).mockReturnValueOnce(slow)
  ;(prisma.appSetting.findMany as jest.Mock).mockResolvedValue([])
  const fd = new FormData()
  fd.set("autoBirthdayEmail", "true")
  fd.set("autoAnniversaryEmail", "true")
  const pending = updateAutoEmailFlags(undefined, fd)
  await new Promise((r) => setImmediate(r))
  expect(prisma.appSetting.findMany).not.toHaveBeenCalled()
  release()
  await expect(pending).resolves.toHaveProperty("error")
  expect(prisma.appSetting.findMany).toHaveBeenCalledTimes(1)
})
