/** @jest-environment node */
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
