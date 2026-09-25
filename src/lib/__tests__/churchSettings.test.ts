import { getChurchSettings, getChurchSettingsStrict } from "@/lib/churchSettings"

jest.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock("@/lib/prisma", () => ({
  prisma: { appSetting: { findMany: jest.fn() } },
}))
import { prisma } from "@/lib/prisma"
const findMany = prisma.appSetting.findMany as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CHURCH_NAME
  delete process.env.CHURCH_WEBSITE
})

test("returns churchWebsite from an AppSetting row", async () => {
  findMany.mockResolvedValue([{ key: "churchWebsite", value: "https://demo.example.com" }])
  const s = await getChurchSettings()
  expect(s.website).toBe("https://demo.example.com")
})

test("website falls back to CHURCH_WEBSITE env then empty string", async () => {
  findMany.mockResolvedValue([])
  process.env.CHURCH_WEBSITE = "https://env.example.com"
  expect((await getChurchSettings()).website).toBe("https://env.example.com")
  delete process.env.CHURCH_WEBSITE
  expect((await getChurchSettings()).website).toBe("")
})

test("an explicitly-saved blank website row overrides the env fallback (leave-blank-to-hide)", async () => {
  findMany.mockResolvedValue([{ key: "churchWebsite", value: "" }])
  process.env.CHURCH_WEBSITE = "https://env.example.com"
  expect((await getChurchSettings()).website).toBe("")
})

test("name falls back to the neutral default when nothing is set", async () => {
  findMany.mockResolvedValue([])
  expect((await getChurchSettings()).name).toBe("Your Church")
})

test("getChurchSettings swallows a DB error and returns env/default fallbacks", async () => {
  findMany.mockRejectedValue(new Error("DB down"))
  process.env.CHURCH_NAME = "Env Church"
  const s = await getChurchSettings()
  expect(s.name).toBe("Env Church")
})

test("getChurchSettingsStrict propagates a DB error (no silent placeholder receipt)", async () => {
  findMany.mockRejectedValue(new Error("DB down"))
  await expect(getChurchSettingsStrict()).rejects.toThrow("DB down")
})

test("getChurchSettingsStrict returns fully-configured rows when the DB is healthy", async () => {
  findMany.mockResolvedValue([
    { key: "churchName", value: "Real Church" },
    { key: "churchAddress", value: "1 Real St" },
    { key: "churchABN", value: "12 345 678 901" },
  ])
  const s = await getChurchSettingsStrict()
  expect(s.name).toBe("Real Church")
  expect(s.abn).toBe("12 345 678 901")
})

test("getChurchSettingsStrict throws when receipt-required identity is missing (DB healthy but unconfigured)", async () => {
  // name defaults to neutral, address + ABN blank → not a valid receipt identity
  findMany.mockResolvedValue([])
  await expect(getChurchSettingsStrict()).rejects.toThrow(/not configured/)
})

test("getChurchSettingsStrict throws listing only the missing fields", async () => {
  findMany.mockResolvedValue([
    { key: "churchName", value: "Real Church" },
    { key: "churchAddress", value: "1 Real St" },
    // ABN missing
  ])
  await expect(getChurchSettingsStrict()).rejects.toThrow(/ABN/)
})
