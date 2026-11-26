/** @jest-environment node */
// AUD-1-11: settings readers must not answer low-privilege roles (e.g. a Sunday-school teacher).
jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: { appSetting: { findMany: jest.fn(), findUnique: jest.fn() } } }))

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { DEFAULT_BIRTHDAY_TEMPLATE } from "@/lib/birthdayTemplate"
import { DEFAULT_ANNIVERSARY_TEMPLATE } from "@/lib/anniversaryTemplate"
import {
  getAnniversaryTemplate,
  getAutoEmailFlags,
  getBirthdayTemplate,
  getPettyCashDefaultCustodianId,
} from "@/lib/actions/settings"

const as = (role: string) => (auth as jest.Mock).mockResolvedValue({ user: { id: "5", role } })

beforeEach(() => {
  jest.clearAllMocks()
  ;(prisma.appSetting.findMany as jest.Mock).mockResolvedValue([
    { key: "birthdayEmailSubject", value: "CONFIGURED" },
    { key: "autoBirthdayEmail", value: "true" },
  ])
  ;(prisma.appSetting.findUnique as jest.Mock).mockResolvedValue({ key: "pettyCashDefaultCustodianId", value: "42" })
})

describe("template and flag readers", () => {
  it.each(["TEACHER", "VIEWER", "AUDITOR", "EVENT_ORGANISER"])("%s gets defaults, no DB read", async (role) => {
    as(role)
    await expect(getBirthdayTemplate()).resolves.toEqual(DEFAULT_BIRTHDAY_TEMPLATE)
    await expect(getAnniversaryTemplate()).resolves.toEqual(DEFAULT_ANNIVERSARY_TEMPLATE)
    await expect(getAutoEmailFlags()).resolves.toEqual({ birthday: false, anniversary: false })
    expect(prisma.appSetting.findMany).not.toHaveBeenCalled()
  })

  it("OFFICE_ADMIN (canEdit) still reads the configured template", async () => {
    as("OFFICE_ADMIN")
    await expect(getBirthdayTemplate()).resolves.toEqual(expect.objectContaining({ subject: "CONFIGURED" }))
  })
})

describe("getPettyCashDefaultCustodianId", () => {
  it.each(["TEACHER", "VIEWER", "EVENT_ORGANISER"])("%s gets null, no DB read", async (role) => {
    as(role)
    await expect(getPettyCashDefaultCustodianId()).resolves.toBeNull()
    expect(prisma.appSetting.findUnique).not.toHaveBeenCalled()
  })

  it.each(["ADMIN", "PASTOR", "AUDITOR"])("%s reads the custodian id", async (role) => {
    as(role)
    await expect(getPettyCashDefaultCustodianId()).resolves.toBe(42)
  })
})
