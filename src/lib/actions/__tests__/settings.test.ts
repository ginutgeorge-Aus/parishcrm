/** @jest-environment node */
import { upsertSetting, updateMembershipSettings, updateLetterSettings } from "@/lib/actions/settings"
import { updateTag } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { upsert: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  },
}))

const mockAuth = auth as jest.Mock
const mockUpsert = prisma.appSetting.upsert as jest.Mock

function fd(key: string, value: string): FormData {
  const f = new FormData()
  f.set("key", key)
  f.set("value", value)
  return f
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN", name: "Admin" } })
  mockUpsert.mockResolvedValue({})
})

describe("upsertSetting — membershipSecretaryEmail (multi-recipient)", () => {
  it("accepts a single address", async () => {
    const res = await upsertSetting(undefined, fd("membershipSecretaryEmail", "secretary@example.org"))
    expect(res).toEqual({ success: "Settings saved" })
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: "secretary@example.org" } }),
    )
  })

  it("accepts a comma-separated list and normalises spacing", async () => {
    const res = await upsertSetting(
      undefined,
      fd("membershipSecretaryEmail", "secretary@example.org ,  admin@example.org"),
    )
    expect(res).toEqual({ success: "Settings saved" })
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: "secretary@example.org, admin@example.org" } }),
    )
  })

  it("rejects the list when any address is invalid", async () => {
    const res = await upsertSetting(undefined, fd("membershipSecretaryEmail", "secretary@example.org, not-an-email"))
    expect(res).toEqual({ error: "Invalid email address" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("rejects more than 10 recipients", async () => {
    const list = Array.from({ length: 11 }, (_, i) => `p${i}@example.org`).join(", ")
    const res = await upsertSetting(undefined, fd("membershipSecretaryEmail", list))
    expect(res).toEqual({ error: "Invalid email address" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("allows blank to clear the setting", async () => {
    const res = await upsertSetting(undefined, fd("membershipSecretaryEmail", ""))
    expect(res).toEqual({ success: "Settings saved" })
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: "" } }))
  })

  it("still validates single-address keys strictly (no comma lists)", async () => {
    const res = await upsertSetting(undefined, fd("ownerNotificationEmail", "a@x.com, b@y.com"))
    expect(res).toEqual({ error: "Invalid email address" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

describe("upsertSetting — church-info keys enforce the same bounds as ChurchInfoSchema", () => {
  it("rejects a blank churchName", async () => {
    const res = await upsertSetting(undefined, fd("churchName", ""))
    expect(res).toEqual({ error: expect.stringContaining("required") })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("rejects a churchName over 200 chars", async () => {
    const res = await upsertSetting(undefined, fd("churchName", "x".repeat(201)))
    expect(res).toEqual({ error: expect.any(String) })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("accepts a valid churchName", async () => {
    const res = await upsertSetting(undefined, fd("churchName", "Example Church's"))
    expect(res).toEqual({ success: "Settings saved" })
    expect(mockUpsert).toHaveBeenCalled()
  })

  it("rejects a churchAddress over 500 chars", async () => {
    const res = await upsertSetting(undefined, fd("churchAddress", "x".repeat(501)))
    expect(res).toEqual({ error: expect.any(String) })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("rejects a churchABN over 20 chars", async () => {
    const res = await upsertSetting(undefined, fd("churchABN", "1".repeat(21)))
    expect(res).toEqual({ error: expect.any(String) })
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

describe("updateMembershipSettings", () => {
  const mfd = (o: Record<string, string>) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(o)) f.set(k, v)
    return f
  }

  it("rejects non-admin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "1", role: "OFFICE_ADMIN" } })
    await expect(updateMembershipSettings(undefined, mfd({}))).resolves.toEqual({ error: "Unauthorized" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it("stores toggle true + min dues", async () => {
    const res = await updateMembershipSettings(undefined, mfd({ membershipParishFields: "on", membershipMinDues: "80" }))
    expect(res).toEqual({ success: "Membership settings saved" })
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "membershipParishFields" }, update: { value: "true" } }))
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "membershipMinDues" }, update: { value: "80" } }))
    expect(updateTag).toHaveBeenCalledWith("membership-settings")
  })

  it("unchecked toggle stores false; blank min stores blank", async () => {
    await updateMembershipSettings(undefined, mfd({ membershipMinDues: "" }))
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "membershipParishFields" }, update: { value: "false" } }))
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "membershipMinDues" }, update: { value: "" } }))
  })

  it("stores trimmed overseas-field labels", async () => {
    await updateMembershipSettings(undefined, mfd({ membershipMinDues: "", membershipHomeAddressLabel: " Address in India ", membershipArrivalDateLabel: "" }))
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "membershipHomeAddressLabel" }, update: { value: "Address in India" } }))
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "membershipArrivalDateLabel" }, update: { value: "" } }))
  })

  it("rejects an over-long overseas-field label", async () => {
    const res = await updateMembershipSettings(undefined, mfd({ membershipMinDues: "", membershipHomeAddressLabel: "x".repeat(81) }))
    expect(res).toHaveProperty("error")
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it.each(["-5", "abc", "100001", "1.234"])("rejects min dues %p", async (v) => {
    const res = await updateMembershipSettings(undefined, mfd({ membershipMinDues: v }))
    expect(res).toHaveProperty("error")
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

describe("updateLetterSettings — templates + fund labels", () => {
  const KEYS = [
    "bankGeneralBank", "bankGeneralBsb", "bankGeneralAccount", "bankGeneralAccountName",
    "bankBuildingBank", "bankBuildingBsb", "bankBuildingAccount", "bankBuildingAccountName",
    "letterSignerName", "letterSignerTitle",
    "letterIntro", "letterContributions", "letterClosing",
    "bankGeneralFundLabel", "bankBuildingFundLabel",
  ]
  const lfd = (over: Record<string, string> = {}) => {
    const f = new FormData()
    for (const k of KEYS) f.set(k, over[k] ?? "")
    return f
  }

  it("saves the letter templates", async () => {
    const res = await updateLetterSettings(undefined, lfd({ letterIntro: "Welcome to {churchName}." }))
    expect(res).toEqual({ success: "Welcome letter settings saved" })
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "letterIntro" }, update: { value: "Welcome to {churchName}." } }))
    expect(updateTag).toHaveBeenCalledWith("letter-settings")
  })

  it("rejects an oversized template", async () => {
    const res = await updateLetterSettings(undefined, lfd({ letterIntro: "x".repeat(4001) }))
    expect(res).toHaveProperty("error")
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

describe("upsertSetting — letter keys have a dedicated action", () => {
  it.each(["letterIntro", "bankBuildingFundLabel", "bankGeneralBsb"])("rejects %s (must go through updateLetterSettings)", async (key) => {
    const res = await upsertSetting(undefined, fd(key, "x".repeat(5000)))
    expect(res).toEqual({ error: "Invalid setting key" })
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})
