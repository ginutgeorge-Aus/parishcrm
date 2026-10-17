/** @jest-environment node */
jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: { findMany: jest.fn() },
    brandingAsset: { findFirst: jest.fn() },
    person: { findFirst: jest.fn() },
    account: { findFirst: jest.fn() },
    paymentAccount: { findFirst: jest.fn() },
  },
}))
jest.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }))
jest.mock("@/lib/logger", () => ({ logger: { error: jest.fn() } }))

import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { getSetupChecklist } from "@/lib/setupChecklist"

const m = prisma as unknown as Record<string, { findFirst: jest.Mock; findMany: jest.Mock }>
const rowModels = ["brandingAsset", "person", "account", "paymentAccount"]

/** Prime every existence check; `done` lists the models that have a row. */
function prime(done: string[], settings: { key: string; value: string }[] = []) {
  for (const k of rowModels) m[k].findFirst.mockResolvedValue(done.includes(k) ? { id: 1 } : null)
  m.appSetting.findMany.mockResolvedValue(settings)
}

const churchStep = async () => (await getSetupChecklist("ADMIN"))!.find((s) => s.id === "church")!.done

const ABN = { key: "churchABN", value: "11 222 333 444" }
const OLD = { name: process.env.CHURCH_NAME, address: process.env.CHURCH_ADDRESS, abn: process.env.CHURCH_ABN }

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.CHURCH_NAME
  delete process.env.CHURCH_ADDRESS
  delete process.env.CHURCH_ABN
})
afterAll(() => {
  if (OLD.name === undefined) delete process.env.CHURCH_NAME
  else process.env.CHURCH_NAME = OLD.name
  if (OLD.address === undefined) delete process.env.CHURCH_ADDRESS
  else process.env.CHURCH_ADDRESS = OLD.address
  if (OLD.abn === undefined) delete process.env.CHURCH_ABN
  else process.env.CHURCH_ABN = OLD.abn
})

describe("getSetupChecklist", () => {
  it("returns null without querying for non-admin roles", async () => {
    for (const role of ["PASTOR", "OFFICE_ADMIN", "AUDITOR", "VIEWER", "EVENT_ORGANISER", undefined] as const) {
      expect(await getSetupChecklist(role)).toBeNull()
    }
    for (const k of rowModels) expect(m[k].findFirst).not.toHaveBeenCalled()
    expect(m.appSetting.findMany).not.toHaveBeenCalled()
  })

  it("lists every step as not done on an empty install, each with a link", async () => {
    prime([])
    const steps = await getSetupChecklist("ADMIN")
    expect(steps).not.toBeNull()
    expect(steps!.map((s) => s.id)).toEqual(["church", "branding", "people", "categories", "paymentAccounts"])
    expect(steps!.every((s) => !s.done && s.href.startsWith("/"))).toBe(true)
  })

  it("marks steps done from existing rows", async () => {
    prime(["brandingAsset", "person"])
    const steps = await getSetupChecklist("ADMIN")
    const done = Object.fromEntries(steps!.map((s) => [s.id, s.done]))
    expect(done).toEqual({ church: false, branding: true, people: true, categories: false, paymentAccounts: false })
  })

  it("needs a church name, address and ABN (as receipts do)", async () => {
    prime([], [{ key: "churchName", value: "Example Parish" }])
    expect(await churchStep()).toBe(false)
    prime([], [
      { key: "churchName", value: "Example Parish" },
      { key: "churchAddress", value: "1 Example St" },
    ])
    expect(await churchStep()).toBe(false)
    prime([], [
      { key: "churchName", value: "Example Parish" },
      { key: "churchAddress", value: "1 Example St" },
      ABN,
    ])
    expect(await churchStep()).toBe(true)
  })

  it("accepts the env fallbacks", async () => {
    process.env.CHURCH_NAME = "Example Parish"
    process.env.CHURCH_ADDRESS = "1 Example St"
    process.env.CHURCH_ABN = "11 222 333 444"
    prime([])
    expect(await churchStep()).toBe(true)
  })

  it("does not count the shipped placeholder name or whitespace", async () => {
    process.env.CHURCH_ADDRESS = "1 Example St"
    process.env.CHURCH_ABN = "11 222 333 444"
    process.env.CHURCH_NAME = "Your Church"
    prime([])
    expect(await churchStep()).toBe(false)
    prime([], [{ key: "churchName", value: "  Your Church " }])
    expect(await churchStep()).toBe(false)
    delete process.env.CHURCH_NAME
    prime([], [{ key: "churchName", value: "   " }])
    expect(await churchStep()).toBe(false)
  })

  it("only counts usable rows: LOGO slot, active income/expense (not XFER), active BANK account", async () => {
    prime(rowModels)
    await getSetupChecklist("ADMIN")
    expect(m.brandingAsset.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { slot: "LOGO" } }))
    expect(m.account.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, type: { in: ["INCOME", "EXPENSE"] }, code: { not: "XFER" } } })
    )
    expect(m.paymentAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, kind: "BANK" } })
    )
  })

  it("returns null once every step is done", async () => {
    prime(rowModels, [
      { key: "churchName", value: "Example Parish" },
      { key: "churchAddress", value: "1 Example St" },
      ABN,
    ])
    expect(await getSetupChecklist("ADMIN")).toBeNull()
  })

  it("re-checks on every call (no in-process memo)", async () => {
    prime(rowModels, [
      { key: "churchName", value: "Example Parish" },
      { key: "churchAddress", value: "1 Example St" },
      ABN,
    ])
    await getSetupChecklist("ADMIN")
    await getSetupChecklist("ADMIN")
    expect(m.account.findFirst).toHaveBeenCalledTimes(2)
  })

  it("logs and returns null when a query fails", async () => {
    prime([])
    m.person.findFirst.mockRejectedValue(new Error("db down"))
    expect(await getSetupChecklist("ADMIN")).toBeNull()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("setupChecklist"), { error: "Error" })
  })

  it("logs the Prisma error code but not the message", async () => {
    prime([])
    m.person.findFirst.mockRejectedValue(Object.assign(new Error("secret@example.com"), { code: "P1001" }))
    expect(await getSetupChecklist("ADMIN")).toBeNull()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("setupChecklist"), {
      error: "Error",
      code: "P1001",
    })
  })
})
